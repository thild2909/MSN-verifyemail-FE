/**
 * Server-side data store for the application backend.
 *
 * This is the "BE" for lists, records, verification results and credits —
 * everything that the email-verification microservice (check-if-email-exists)
 * intentionally does NOT own. It runs inside the Next.js Node server, persists
 * to a JSON file, and is the single source of truth these route handlers read
 * and mutate. Actual email checking is delegated to the Rust engine by the
 * verification job runner.
 */
import "server-only";
import fs from "fs";
import path from "path";
import {
  MOCK_LISTS,
  MOCK_CREDITS,
  MOCK_TRANSACTIONS,
  generateRecordsForList,
} from "@/lib/mock/data";
import { statusBucket } from "@/lib/mock/verification-engine";
import { CREDIT_COSTS } from "@/lib/credit-config";
import type {
  CreditBalance,
  CreditTransaction,
  EmailList,
  EmailRecord,
  ListSummary,
  VerificationResult,
} from "@/lib/types";

export const MAX_LIST_EMAILS = Number(process.env.APP_MAX_LIST_EMAILS ?? 500);

interface StoreData {
  lists: EmailList[];
  records: Record<string, EmailRecord[]>;
  credits: CreditBalance;
  transactions: CreditTransaction[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

/* ------------------------- singleton bootstrap --------------------------- */

declare global {
  // eslint-disable-next-line no-var
  var __appStore: StoreData | undefined;
}

function seed(): StoreData {
  // Seed lists become server-owned demo data with pre-computed results.
  // Records are generated up-front and the summary/progress are derived from
  // them so nothing is left in a stuck "processing" state.
  const lists: EmailList[] = [];
  const records: Record<string, EmailRecord[]> = {};
  for (const base of MOCK_LISTS) {
    const list: EmailList = { ...base, summary: { ...base.summary } };
    const recs = generateRecordsForList(list, list.uniqueEmails);
    records[list.id] = recs;

    const s: ListSummary = { total: recs.length, valid: 0, invalid: 0, risky: 0, unknown: 0, duplicates: list.summary.duplicates };
    for (const r of recs) if (r.result) s[statusBucket(r.result.status)]++;
    list.summary = s;
    list.uniqueEmails = recs.length;
    list.progress = 100;
    list.status = "completed";
    list.completedAt = list.completedAt ?? list.createdAt;
    lists.push(list);
  }
  return {
    lists,
    records,
    credits: { ...MOCK_CREDITS },
    transactions: [...MOCK_TRANSACTIONS],
  };
}

function load(): StoreData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as StoreData;
    }
  } catch {
    // fall through to seed on corrupt file
  }
  const seeded = seed();
  persistNow(seeded);
  return seeded;
}

function getStore(): StoreData {
  if (!globalThis.__appStore) globalThis.__appStore = load();
  return globalThis.__appStore;
}

/* ----------------------------- persistence ------------------------------- */

let saveTimer: NodeJS.Timeout | null = null;

function persistNow(data: StoreData) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data));
  } catch {
    // best-effort; keep serving from memory if disk write fails
  }
}

/** Throttled save — coalesces rapid updates during a verification job. */
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistNow(getStore());
  }, 1500);
}

/* ------------------------------- lists ----------------------------------- */

export function listAll(): EmailList[] {
  return getStore()
    .lists.slice()
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export function getList(id: string): EmailList | undefined {
  return getStore().lists.find((l) => l.id === id);
}

export interface RecordsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}

export function getRecords(listId: string, query: RecordsQuery = {}) {
  const all = getStore().records[listId] ?? [];
  const { page = 1, pageSize = 12, search = "", status = "all" } = query;

  let filtered = all;
  const q = search.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(
      (r) =>
        r.email.includes(q) ||
        r.firstName?.toLowerCase().includes(q) ||
        r.lastName?.toLowerCase().includes(q) ||
        r.company?.toLowerCase().includes(q),
    );
  }
  if (status !== "all") {
    filtered = filtered.filter((r) => r.result?.status === status);
  }

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return { records: filtered.slice(start, start + pageSize), total, page, pageSize };
}

/** Raw records (used by the job runner). */
export function rawRecords(listId: string): EmailRecord[] {
  return getStore().records[listId] ?? [];
}

export interface NewContact {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  custom?: Record<string, string>;
}

export interface CreateListInput {
  name: string;
  fileName: string;
  columns: string[];
  emailColumn: string;
  contacts: NewContact[];
}

export class CreditsError extends Error {
  code = "INSUFFICIENT_CREDITS" as const;
  constructor(
    public required: number,
    public available: number,
  ) {
    super("Not enough credits to start this verification.");
  }
}

/** Create a list, deduct credits, and return it (status: processing). */
export function createList(input: CreateListInput): { list: EmailList; truncated: number } {
  const store = getStore();

  // Dedupe by normalized email.
  const seen = new Set<string>();
  const unique: NewContact[] = [];
  for (const c of input.contacts) {
    const email = c.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    unique.push({ ...c, email });
  }

  const uploadedRows = input.contacts.length;
  const totalUnique = unique.length;
  const capped = unique.slice(0, MAX_LIST_EMAILS);
  const uniqueEmails = capped.length;
  const truncated = totalUnique - uniqueEmails;

  // Credit gate.
  const cost = CREDIT_COSTS.bulk_verification * uniqueEmails;
  if (cost > store.credits.totalRemaining) {
    throw new CreditsError(cost, store.credits.totalRemaining);
  }

  const id = `lst_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const now = new Date().toISOString();
  const summary: ListSummary = {
    total: uniqueEmails,
    valid: 0,
    invalid: 0,
    risky: 0,
    unknown: 0,
    duplicates: uploadedRows - totalUnique,
  };
  const list: EmailList = {
    id,
    name: input.name,
    fileName: input.fileName,
    status: "processing",
    uploadedRows,
    uniqueEmails,
    progress: 0,
    emailColumn: input.emailColumn,
    columns: input.columns,
    summary,
    createdAt: now,
  };

  store.records[id] = capped.map((c, i) => ({
    id: `${id}_${i}`,
    listId: id,
    email: c.email,
    firstName: c.firstName,
    lastName: c.lastName,
    company: c.company,
    jobTitle: c.jobTitle,
    custom: c.custom,
  }));
  store.lists.push(list);

  deduct(cost, "bulk_verification", `${input.name} — bulk verify`);
  scheduleSave();
  return { list, truncated };
}

/** Store one verification result and refresh the list's summary/progress. */
export function applyResult(listId: string, recordId: string, result: VerificationResult) {
  const store = getStore();
  const recs = store.records[listId];
  if (!recs) return;
  const rec = recs.find((r) => r.id === recordId);
  if (rec) rec.result = result;
  recompute(listId);
  scheduleSave();
}

export function finalizeList(listId: string) {
  const list = getList(listId);
  if (!list) return;
  recompute(listId);
  list.progress = 100;
  list.status = "completed";
  list.completedAt = new Date().toISOString();
  persistNow(getStore());
}

function recompute(listId: string) {
  const list = getList(listId);
  const recs = getStore().records[listId];
  if (!list || !recs) return;
  const s: ListSummary = { total: recs.length, valid: 0, invalid: 0, risky: 0, unknown: 0, duplicates: list.summary.duplicates };
  let scored = 0;
  for (const r of recs) {
    if (!r.result) continue;
    scored++;
    s[statusBucket(r.result.status)]++;
  }
  list.summary = s;
  list.progress = recs.length ? Math.round((scored / recs.length) * 100) : 100;
  if (scored >= recs.length && list.status === "processing") {
    list.status = "completed";
    list.completedAt = new Date().toISOString();
  }
}

/* --------------------------- list mutations ------------------------------ */

export function deleteList(id: string): boolean {
  const s = getStore();
  const before = s.lists.length;
  s.lists = s.lists.filter((l) => l.id !== id);
  delete s.records[id];
  if (s.lists.length < before) {
    persistNow(s);
    return true;
  }
  return false;
}

export function renameList(id: string, name: string): EmailList | undefined {
  const list = getList(id);
  if (!list) return undefined;
  list.name = name;
  scheduleSave();
  return list;
}

/** Clear results and re-queue a list for verification (charges credits). */
export function reprocessList(id: string): EmailList {
  const store = getStore();
  const list = getList(id);
  const recs = store.records[id];
  if (!list || !recs) throw new Error("List not found");

  const cost = CREDIT_COSTS.bulk_verification * recs.length;
  if (cost > store.credits.totalRemaining) {
    throw new CreditsError(cost, store.credits.totalRemaining);
  }

  for (const r of recs) r.result = undefined;
  list.status = "processing";
  list.progress = 0;
  list.completedAt = undefined;
  list.summary = { total: recs.length, valid: 0, invalid: 0, risky: 0, unknown: 0, duplicates: list.summary.duplicates };

  deduct(cost, "bulk_verification", `${list.name} — reprocess`);
  persistNow(store);
  return list;
}

/* ------------------------------ credits ---------------------------------- */

export function getCredits(): CreditBalance {
  return getStore().credits;
}

export function getTransactions(): CreditTransaction[] {
  return getStore()
    .transactions.slice()
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

function deduct(amount: number, operation: CreditTransaction["operation"], label: string) {
  const c = getStore().credits;
  c.totalRemaining = Math.max(0, c.totalRemaining - amount);
  c.verificationRemaining = Math.max(0, c.verificationRemaining - amount);
  getStore().transactions.unshift({
    id: `tx_${Date.now().toString(36)}`,
    date: new Date().toISOString(),
    operation,
    label,
    credits: -amount,
    balance: c.totalRemaining,
    user: "labs@mindsupernova.com",
  });
}

/** Charge credits for an ad-hoc operation (e.g. a per-record deep scan). */
export function charge(amount: number, operation: CreditTransaction["operation"], label: string) {
  deduct(amount, operation, label);
  scheduleSave();
}
