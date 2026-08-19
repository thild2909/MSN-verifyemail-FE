"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (t: Omit<Toast, "id">) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

let counter = 0;

const ICONS: Record<ToastVariant, React.ElementType> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const ACCENT: Record<ToastVariant, string> = {
  success: "text-[hsl(var(--valid))]",
  error: "text-[hsl(var(--invalid))]",
  warning: "text-[hsl(var(--risky))]",
  info: "text-primary",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const remove = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (t: Omit<Toast, "id">) => {
      const id = `t_${counter++}`;
      setToasts((prev) => [...prev, { ...t, id }]);
      setTimeout(() => remove(id), 5000);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {mounted &&
        createPortal(
          <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
            {toasts.map((t) => {
              const Icon = ICONS[t.variant];
              return (
                <div
                  key={t.id}
                  className="pointer-events-auto flex animate-fade-in items-start gap-3 rounded-xl border bg-card p-4 shadow-lg"
                >
                  <Icon className={cn("mt-0.5 size-5 shrink-0", ACCENT[t.variant])} />
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{t.title}</p>
                    {t.description && (
                      <p className="mt-0.5 text-sm text-muted-foreground">{t.description}</p>
                    )}
                    {t.action && (
                      <button
                        onClick={() => {
                          t.action!.onClick();
                          remove(t.id);
                        }}
                        className="mt-2 text-sm font-medium text-primary hover:underline"
                      >
                        {t.action.label}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => remove(t.id)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Dismiss"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
