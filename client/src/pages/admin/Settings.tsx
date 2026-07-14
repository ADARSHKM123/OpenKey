import { useEffect, useState, type FormEvent } from "react";
import { PageBody, PageHeader } from "../../components/layout/AppShell";
import { Button } from "../../components/ui/button";
import { Card, CardBody, CardHeader } from "../../components/ui/card";
import { Input, Label } from "../../components/ui/input";
import { invalidateQueries, useQuery } from "../../hooks/useQuery";
import { api } from "../../lib/api";
import { useToast } from "../../context/ToastContext";

interface Org {
  id: string;
  name: string;
  monthlyBudgetUsd: string | null;
  settings: {
    adminCanViewPrompts?: boolean;
    storeRawPrompts?: boolean;
    logRetentionDays?: number;
    redactPii?: boolean;
    detectInjection?: boolean;
    alertWebhookUrl?: string | null;
  };
}

export function AdminSettings() {
  const { data: org, loading, refetch } = useQuery<Org>("/api/org");
  const toast = useToast();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [retention, setRetention] = useState("90");
  const [adminPrompts, setAdminPrompts] = useState(true);
  const [redactPii, setRedactPii] = useState(false);
  const [detectInjection, setDetectInjection] = useState(false);
  const [webhook, setWebhook] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!org) return;
    setName(org.name);
    setBudget(org.monthlyBudgetUsd ?? "");
    setRetention(String(org.settings.logRetentionDays ?? 90));
    setAdminPrompts(org.settings.adminCanViewPrompts !== false);
    setRedactPii(org.settings.redactPii === true);
    setDetectInjection(org.settings.detectInjection === true);
    setWebhook(org.settings.alertWebhookUrl ?? "");
  }, [org]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/org", {
        method: "PATCH",
        body: {
          name,
          monthlyBudgetUsd: budget.trim() === "" ? null : budget.trim(),
          settings: {
            logRetentionDays: Number(retention) || 90,
            adminCanViewPrompts: adminPrompts,
            redactPii,
            detectInjection,
            alertWebhookUrl: webhook.trim() === "" ? null : webhook.trim(),
          },
        },
      });
      toast("success", "Org settings saved — live in <5s");
      invalidateQueries("/api/org");
      void refetch();
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" description="Org-wide policies" />
      <PageBody className="max-w-2xl">
        {loading ? (
          <div className="h-64 animate-pulse rounded-lg bg-surface" />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Card>
              <CardHeader title="Organization" />
              <CardBody className="space-y-3">
                <div>
                  <Label htmlFor="org-name">Name</Label>
                  <Input id="org-name" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="org-budget">Org monthly budget (USD)</Label>
                  <Input id="org-budget" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="empty = unlimited" inputMode="decimal" />
                  <p className="mt-1 text-2xs text-zinc-600">
                    The outermost ceiling. Team, user and key budgets can only tighten it, never widen it.
                  </p>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Privacy & retention" />
              <CardBody className="space-y-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={adminPrompts}
                    onChange={(e) => setAdminPrompts(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-emerald-500"
                  />
                  <span>
                    <span className="block text-sm text-zinc-200">Admins may view prompt content</span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      When off, admins see costs and metadata but never the text of employee prompts. The flip itself is
                      audit-logged.
                    </span>
                  </span>
                </label>
                <div>
                  <Label htmlFor="org-retention">Log retention (days)</Label>
                  <Input id="org-retention" value={retention} onChange={(e) => setRetention(e.target.value)} inputMode="numeric" className="w-32" />
                  <p className="mt-1 text-2xs text-zinc-600">
                    Whole monthly partitions older than this are dropped — cheap at any volume.
                  </p>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Guardrails" description="Applied before any request leaves your network" />
              <CardBody className="space-y-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={redactPii}
                    onChange={(e) => setRedactPii(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-emerald-500"
                  />
                  <span>
                    <span className="block text-sm text-zinc-200">Redact PII before sending upstream</span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      Emails, phone numbers, credit cards (Luhn-checked), SSN/Aadhaar/PAN, AWS keys and private keys are
                      replaced before the request exits the network. The model sees the redacted text.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={detectInjection}
                    onChange={(e) => setDetectInjection(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-emerald-500"
                  />
                  <span>
                    <span className="block text-sm text-zinc-200">Flag prompt-injection attempts</span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      Advisory only — suspicious requests are flagged in server logs, never blocked.
                    </span>
                  </span>
                </label>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Alerts" description="Fired at 50%, 80% and 100% of any budget, once per month each" />
              <CardBody>
                <Label htmlFor="org-webhook">Webhook URL (Slack-compatible)</Label>
                <Input
                  id="org-webhook"
                  type="url"
                  value={webhook}
                  onChange={(e) => setWebhook(e.target.value)}
                  placeholder="https://hooks.slack.com/services/…"
                />
                <p className="mt-1 text-2xs text-zinc-600">
                  The only outbound call OpenKey ever makes — and it goes to a URL you configured.
                </p>
              </CardBody>
            </Card>

            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={busy}>
                Save settings
              </Button>
            </div>
          </form>
        )}
      </PageBody>
    </>
  );
}
