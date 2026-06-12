import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { fetchAccounts } from "@/lib/api";

type Provider = "kiro" | "kiro-pro" | "codebuddy" | "canva" | "codex" | "qoder";

interface Account {
  id: number;
  email: string;
  provider: Provider;
  status: string;
  enabled: boolean;
  quotaLimit?: number;
  quotaRemaining?: number;
}

const providers: Provider[] = ["kiro", "kiro-pro", "codebuddy", "canva", "codex", "qoder"];

function labelProvider(provider: string) {
  if (provider === "kiro-pro") return "Kiro Pro";
  if (provider === "codebuddy") return "CodeBuddy";
  if (provider === "codex") return "Codex";
  if (provider === "qoder") return "Qoder";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function normalizeInput(input: string) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const line of input.split(/\r?\n/)) {
    const email = line.split("|")[0]?.trim().toLowerCase() ?? "";
    if (!email || seen.has(email)) continue;
    seen.add(email);
    normalized.push(email);
  }

  return normalized;
}

function groupAccountsByProvider(accounts: Account[]) {
  const grouped = new Map<Provider, Set<string>>();

  for (const provider of providers) {
    grouped.set(provider, new Set<string>());
  }

  for (const account of accounts) {
    if (account.status !== "active" || account.enabled !== true) continue;
    grouped.get(account.provider)?.add(account.email.trim().toLowerCase());
  }

  return grouped;
}

export default function EmailProviderFilter() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [selectedProviders, setSelectedProviders] = useState<Provider[]>(providers);
  const loadingRef = useRef(false);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    };
  }, []);

  useEffect(() => {
    async function load() {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);

      try {
        const result = await (fetchAccounts() as Promise<{ data: Account[] }>);
        setAccounts(result.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    }

    load();
  }, []);

  function showMessage(text: string) {
    setMessage(text);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(null), 2000);
  }

  function toggleProvider(provider: Provider) {
    setSelectedProviders((current) =>
      current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider]
    );
  }

  const normalizedEmails = useMemo(() => normalizeInput(input), [input]);
  const accountEmailsByProvider = useMemo(() => groupAccountsByProvider(accounts), [accounts]);

  const providerResults = useMemo(
    () =>
      selectedProviders.map((provider) => {
        const existingEmails = accountEmailsByProvider.get(provider) ?? new Set<string>();
        const missingEmails = normalizedEmails.filter((email) => !existingEmails.has(email));

        return {
          provider,
          missingEmails,
          missingCount: missingEmails.length,
          totalInputCount: normalizedEmails.length,
          existingCount: existingEmails.size,
        };
      }),
    [accountEmailsByProvider, normalizedEmails, selectedProviders]
  );

  async function copyMissingEmails(provider: Provider, missingEmails: string[]) {
    try {
      await navigator.clipboard.writeText(missingEmails.join("\n"));
      showMessage(`${labelProvider(provider)} missing list copied`);
    } catch {
      showMessage(`Failed to copy ${labelProvider(provider)} list`);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Email Provider Filter</CardTitle>
          <CardDescription>
            Compare a pasted email list against existing accounts per provider and see which emails are still missing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Email input</p>
                <p className="text-sm text-[var(--muted-foreground)]">
                  One email per line. Input is normalized with trim and lowercase, then deduped by first occurrence.
                </p>
              </div>
              <Badge variant="outline">{normalizedEmails.length} unique</Badge>
            </div>
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Paste one email per line"
              className="min-h-[240px]"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Providers</p>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Select which providers should be checked for missing accounts.
                </p>
              </div>
              <Badge variant="outline">{selectedProviders.length} selected</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {providers.map((provider) => {
                const selected = selectedProviders.includes(provider);
                return (
                  <Button
                    key={provider}
                    type="button"
                    variant={selected ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleProvider(provider)}
                  >
                    {labelProvider(provider)}
                  </Button>
                );
              })}
            </div>
          </div>

          {message ? (
            <div className="rounded-md border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm">
              {message}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
              Loading accounts...
            </div>
          ) : error ? (
            <div className="rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-4 py-3 text-sm text-[var(--destructive)]">
              Failed to load accounts: {error}
            </div>
          ) : normalizedEmails.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--muted-foreground)]">
              Paste email addresses above to compare them against each provider.
            </div>
          ) : selectedProviders.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--muted-foreground)]">
              Select at least one provider to show missing-email results.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {providerResults.map((result) => (
                <Card key={result.provider} className="h-full">
                  <CardHeader className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <CardTitle>{labelProvider(result.provider)}</CardTitle>
                        <CardDescription>
                          {result.missingCount === 0
                            ? "All input emails already exist for this provider."
                            : "Emails from the input list that do not exist for this provider yet."}
                        </CardDescription>
                      </div>
                      <Badge variant={result.missingCount === 0 ? "success" : "warning"}>
                        {result.missingCount} missing
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{result.totalInputCount} input</Badge>
                      <Badge variant="outline">{result.existingCount} existing</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => copyMissingEmails(result.provider, result.missingEmails)}
                    >
                      Copy missing list
                    </Button>

                    {result.missingCount === 0 ? (
                      <div className="rounded-md border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--muted-foreground)]">
                        No missing emails for {labelProvider(result.provider)}.
                      </div>
                    ) : (
                      <div className="max-h-80 overflow-auto rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
                        <ul className="space-y-2 text-sm">
                          {result.missingEmails.map((email) => (
                            <li key={`${result.provider}-${email}`} className="break-all rounded-sm bg-[var(--secondary)] px-2 py-1">
                              {email}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
