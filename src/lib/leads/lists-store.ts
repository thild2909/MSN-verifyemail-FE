/**
 * Lightweight client-side lists for Find Leads (Save / Add to list).
 *
 * Apollo-style saved lists, persisted to localStorage — no backend. A list is a
 * named bag of company (or person) references. "Save" drops the selection into a
 * built-in "Saved" list; "Add to list" targets any named list. Kept intentionally
 * light: the real backend effort lives in the people/company crawlers.
 */
"use client";

export interface LeadListItem {
  refId: string; // CollectedCompany.id or CollectedPerson.id
  name: string;
  jobId: string;
  kind: "company" | "person";
}

export interface LeadList {
  id: string;
  name: string;
  createdAt: string;
  items: LeadListItem[];
}

const KEY = "msn.leadLists.v1";
const SAVED_ID = "saved";

function read(): LeadList[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as LeadList[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(lists: LeadList[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lists));
    window.dispatchEvent(new Event("leadlists:changed"));
  } catch { /* quota / disabled — best effort */ }
}

function uid(): string {
  return `list_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function getLists(): LeadList[] {
  return read().sort((a, b) => (a.id === SAVED_ID ? -1 : b.id === SAVED_ID ? 1 : +new Date(b.createdAt) - +new Date(a.createdAt)));
}

export function createList(name: string): LeadList {
  const lists = read();
  const list: LeadList = { id: uid(), name: name.trim() || `List ${lists.length + 1}`, createdAt: new Date().toISOString(), items: [] };
  lists.push(list);
  write(lists);
  return list;
}

/** Add items to a list (deduped by refId). Returns how many were newly added. */
export function addToList(listId: string, items: LeadListItem[]): { list: LeadList; added: number } {
  const lists = read();
  let list = lists.find((l) => l.id === listId);
  if (!list) {
    list = { id: listId, name: listId === SAVED_ID ? "Saved" : "List", createdAt: new Date().toISOString(), items: [] };
    lists.push(list);
  }
  const have = new Set(list.items.map((i) => i.refId));
  let added = 0;
  for (const it of items) {
    if (have.has(it.refId)) continue;
    list.items.push(it);
    have.add(it.refId);
    added++;
  }
  write(lists);
  return { list, added };
}

/** The built-in "Saved" list (created on first use). */
export function saveToSaved(items: LeadListItem[]): { added: number } {
  return { added: addToList(SAVED_ID, items).added };
}

export function deleteList(id: string) {
  write(read().filter((l) => l.id !== id));
}

export const SAVED_LIST_ID = SAVED_ID;
