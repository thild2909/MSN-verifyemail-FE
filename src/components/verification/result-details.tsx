import { Check, X, Minus } from "lucide-react";
import type { CheckResult, VerificationResult } from "@/lib/types";
import { cn } from "@/lib/utils";

function CheckIcon({ result }: { result: CheckResult }) {
  if (result === "pass") return <Check className="size-4 text-[hsl(var(--valid))]" />;
  if (result === "fail") return <X className="size-4 text-[hsl(var(--invalid))]" />;
  return <Minus className="size-4 text-muted-foreground" />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-medium">{children}</span>
    </div>
  );
}

/** Boolean-flag row: a "good" flag (false = clean) shows a green check. */
function FlagRow({ label, flag, goodWhenFalse = true }: { label: string; flag: boolean; goodWhenFalse?: boolean }) {
  const good = goodWhenFalse ? !flag : flag;
  return (
    <Row label={label}>
      {good ? (
        <Check className="size-4 text-[hsl(var(--valid))]" />
      ) : (
        <X className="size-4 text-[hsl(var(--risky))]" />
      )}
      <span className={cn(good ? "text-foreground" : "text-[hsl(var(--risky))]")}>{flag ? "Yes" : "No"}</span>
    </Row>
  );
}

export function ResultDetails({ result }: { result: VerificationResult }) {
  const c = result.checks;
  return (
    <div className="divide-y">
      <div className="pb-1">
        <p className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Core checks
        </p>
        <Row label="Syntax"><CheckIcon result={c.syntax} /></Row>
        <Row label="Domain"><CheckIcon result={c.domain} /></Row>
        <Row label="DNS"><CheckIcon result={c.dns} /></Row>
        <Row label="MX record"><CheckIcon result={c.mx} /></Row>
      </div>

      <div className="py-1">
        <p className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Deliverability {!result.deepScanned && <span className="font-normal normal-case">(run Deep Scan for SMTP)</span>}
        </p>
        <Row label="SMTP"><CheckIcon result={c.smtp} /></Row>
        <Row label="Mailbox"><CheckIcon result={c.mailbox} /></Row>
        <FlagRow label="Catch-all" flag={c.catchAll} />
        <FlagRow label="Greylisted" flag={c.greylisted} />
      </div>

      <div className="pt-1">
        <p className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Signals
        </p>
        <FlagRow label="Disposable" flag={c.disposable} />
        <FlagRow label="Role-based" flag={c.roleBased} />
        <FlagRow label="Free provider" flag={c.freeProvider} />
        {result.domainAgeYears != null && (
          <Row label="Domain age">
            <span className="text-foreground">{result.domainAgeYears} yrs</span>
          </Row>
        )}
      </div>

      {(result.provider || (result.mxRecords && result.mxRecords.length > 0)) && (
        <div className="pt-1">
          <p className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Mail server
          </p>
          {result.provider && (
            <Row label="Email provider (ESP)">
              <span className="text-foreground">{result.provider}</span>
            </Row>
          )}
          {result.mxRecords && result.mxRecords.length > 0 && (
            <Row label="MX server">
              <span
                className="max-w-[190px] truncate font-mono text-xs text-foreground"
                title={result.mxRecords.join(", ")}
              >
                {result.mxRecords[0]}
                {result.mxRecords.length > 1 ? ` +${result.mxRecords.length - 1}` : ""}
              </span>
            </Row>
          )}
        </div>
      )}
    </div>
  );
}
