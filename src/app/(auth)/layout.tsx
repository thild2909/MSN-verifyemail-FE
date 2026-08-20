import { MailCheck, ShieldCheck, Zap, Search } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-lg bg-sidebar-accent">
            <MailCheck className="size-6 text-white" />
          </div>
          <span className="text-lg font-bold">Verifly</span>
        </div>

        <div className="relative z-10 max-w-md">
          <h1 className="text-3xl font-bold leading-tight">
            Clean lists. Confident sends. Better deliverability.
          </h1>
          <p className="mt-4 text-sidebar-muted">
            Verify emails at scale, discover professional contacts, and protect your sender
            reputation — all from one workspace.
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            {[
              { icon: ShieldCheck, text: "Multi-signal verification (syntax, MX, SMTP, catch-all)" },
              { icon: Zap, text: "Bulk validation for millions of records" },
              { icon: Search, text: "Email Finder with deliverability scoring" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <Icon className="size-5 text-sidebar-accent" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-xs text-sidebar-muted">
          © 2026 Verifly. Demo interface — not affiliated with any existing brand.
        </p>

        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-sidebar-accent/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 size-80 rounded-full bg-sidebar-accent/10 blur-3xl" />
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center bg-background px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
