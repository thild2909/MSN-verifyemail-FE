import { ShieldCheck, Zap, Search } from "lucide-react";
import { BrandLockup } from "@/components/brand/brand-logo";
import { ThemeToggle } from "@/components/theme/theme-provider";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] bg-background">
      {/* Brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden border-r border-border bg-card p-12 lg:flex">
        <BrandLockup size="md" />

        <div className="relative z-10 max-w-md">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand/5 px-2.5 py-1 text-xs font-medium text-brand">
            <span className="size-1.5 rounded-full bg-brand" /> Lead Finder
          </span>
          <h1 className="mt-5 text-[2rem] font-semibold leading-tight tracking-tight">
            Clean lists. Confident sends. Better deliverability.
          </h1>
          <p className="mt-4 text-muted-foreground">
            Verify emails at scale, discover professional contacts, and protect your sender
            reputation, all from one workspace.
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            {[
              { icon: ShieldCheck, text: "Multi-signal verification (syntax, MX, SMTP, catch-all)", tone: "bg-[hsl(var(--valid)/0.12)] text-[hsl(var(--valid))]" },
              { icon: Zap, text: "Bulk validation for millions of records", tone: "bg-[hsl(var(--risky)/0.12)] text-[hsl(var(--risky))]" },
              { icon: Search, text: "Email Finder with deliverability scoring", tone: "bg-brand/10 text-brand" },
            ].map(({ icon: Icon, text, tone }) => (
              <li key={text} className="flex items-center gap-3">
                <span className={`flex size-8 items-center justify-center rounded-lg ${tone}`}>
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-xs text-muted-foreground">© 2026 Mind Supernova. All rights reserved.</p>

        <div className="pointer-events-none absolute -right-32 -top-32 size-[28rem] rounded-full bg-brand/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-[hsl(280_70%_60%/0.08)] blur-3xl" />
      </div>

      {/* Form panel */}
      <div className="relative flex w-full items-center justify-center px-6 py-10 pb-safe pt-safe lg:w-1/2 lg:py-12">
        <ThemeToggle className="absolute right-5 top-5" />
        <div className="w-full max-w-sm">
          {/* Compact brand for mobile, where the brand panel is hidden. */}
          <BrandLockup className="mb-8 lg:hidden" size="md" />
          {children}
        </div>
      </div>
    </div>
  );
}
