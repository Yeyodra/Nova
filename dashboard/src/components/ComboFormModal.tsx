import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Plus, X, AlertCircle, Check, ChevronDown, Search } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { cn } from "@/lib/utils";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;
const MAX_MODELS = 10;
const MIN_STICKY_LIMIT = 1;
const MAX_STICKY_LIMIT = 1000;

export interface Combo {
  id: number;
  name: string;
  models: string[];
  strategy: "fallback" | "round-robin" | null;
  stickyLimit: number | null;
  createdAt: string;
  updatedAt: string | null;
}

export type ComboFormModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  combo?: Combo | null;
  onSaved: () => void;
};

type StrategyValue = "" | "fallback" | "round-robin";

interface FieldErrors {
  name?: string;
  models?: string;
  modelAt?: Record<number, string>;
  stickyLimit?: string;
}

interface AvailableModel {
  id: string;
  owned_by: string;
}

interface ModelsResponse {
  data?: { id: string; owned_by: string; object?: string }[];
}

// ---------------------------------------------------------------------------
// Searchable Model Selector
// ---------------------------------------------------------------------------

interface ModelSelectorProps {
  value: string;
  onChange: (next: string) => void;
  options: AvailableModel[];
  fallbackToTextInput: boolean;
  hasError?: boolean;
  placeholder?: string;
}

function ModelSelector({
  value,
  onChange,
  options,
  fallbackToTextInput,
  hasError,
  placeholder = "Select a model",
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Focus search input when opened
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // If the current value is not in the option list, append it as "(unknown)"
  // so the user's data is preserved even if the upstream list lost it.
  const augmented = useMemo<AvailableModel[]>(() => {
    if (!value) return options;
    if (options.some((o) => o.id === value)) return options;
    return [{ id: value, owned_by: "unknown" }, ...options];
  }, [options, value]);

  // Group by owned_by, then sort within each group
  const grouped = useMemo(() => {
    const filtered = query
      ? augmented.filter(
          (m) =>
            m.id.toLowerCase().includes(query.toLowerCase()) ||
            m.owned_by.toLowerCase().includes(query.toLowerCase())
        )
      : augmented;
    const map = new Map<string, AvailableModel[]>();
    for (const m of filtered) {
      const k = m.owned_by || "other";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    const groups = Array.from(map.entries()).map(([k, list]) => ({
      provider: k,
      items: list.sort((a, b) => a.id.localeCompare(b.id)),
    }));
    // Stable provider ordering: "unknown" first if present, then alphabetical
    groups.sort((a, b) => {
      if (a.provider === "unknown") return -1;
      if (b.provider === "unknown") return 1;
      return a.provider.localeCompare(b.provider);
    });
    return groups;
  }, [augmented, query]);

  const totalMatches = grouped.reduce((s, g) => s + g.items.length, 0);

  // Fallback: plain text input when /api/models is unavailable.
  if (fallbackToTextInput) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="model id, e.g. claude-sonnet-4-5"
        className={cn(
          "font-mono text-xs",
          hasError && "border-[var(--destructive)] focus-visible:ring-[var(--destructive)]"
        )}
      />
    );
  }

  const display = value || placeholder;
  const isPlaceholder = !value;

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-left text-xs font-mono text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]",
          hasError && "border-[var(--destructive)] focus-visible:ring-[var(--destructive)]",
          isPlaceholder && "text-[var(--muted-foreground)]"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{display}</span>
        <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full min-w-[280px] rounded-md border border-[var(--border)] bg-[var(--card)] shadow-lg"
          role="listbox"
        >
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models..."
              className="h-7 w-full bg-transparent text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none"
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto py-1">
            {totalMatches === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
                No models match "{query}"
              </div>
            ) : (
              grouped.map((g) => (
                <div key={g.provider}>
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {g.provider}
                  </div>
                  {g.items.map((m) => {
                    const selected = m.id === value;
                    const isUnknown = g.provider === "unknown";
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onChange(m.id);
                          setOpen(false);
                          setQuery("");
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-mono transition-colors hover:bg-[var(--secondary)]",
                          selected && "bg-[var(--secondary)]"
                        )}
                      >
                        <Check
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 text-[var(--primary)]",
                            !selected && "opacity-0"
                          )}
                        />
                        <span className="truncate text-[var(--foreground)]">{m.id}</span>
                        {isUnknown && (
                          <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">
                            (unknown)
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export default function ComboFormModal({
  open,
  onOpenChange,
  combo,
  onSaved,
}: ComboFormModalProps) {
  const isEdit = !!combo;
  const [name, setName] = useState("");
  const [models, setModels] = useState<string[]>([""]);
  const [strategy, setStrategy] = useState<StrategyValue>("");
  const [stickyLimit, setStickyLimit] = useState<string>("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Available models for the selector — fetched once when the modal opens
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [modelsFailed, setModelsFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setModelsFailed(false);
    fetchApi<ModelsResponse>("/api/models")
      .then((res) => {
        if (cancelled) return;
        const list = (res.data ?? [])
          .filter((m) => m.owned_by !== "combo")
          .map((m) => ({ id: m.id, owned_by: m.owned_by }));
        if (list.length === 0) {
          setModelsFailed(true);
        } else {
          setAvailableModels(list);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setModelsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Reset form whenever the modal opens/changes target
  useEffect(() => {
    if (!open) return;
    if (combo) {
      setName(combo.name);
      setModels(combo.models.length > 0 ? [...combo.models] : [""]);
      setStrategy(combo.strategy ?? "");
      setStickyLimit(combo.stickyLimit != null ? String(combo.stickyLimit) : "");
    } else {
      setName("");
      setModels([""]);
      setStrategy("");
      setStickyLimit("");
    }
    setErrors({});
    setServerError(null);
    setSubmitting(false);
  }, [open, combo]);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!isEdit) {
      const trimmed = name.trim();
      if (!trimmed) {
        next.name = "Name is required";
      } else if (trimmed.length > 100) {
        next.name = "Name must be 100 characters or fewer";
      } else if (!VALID_NAME_REGEX.test(trimmed)) {
        next.name = "Allowed: letters, digits, underscore, dot, hyphen";
      }
    }

    const modelAt: Record<number, string> = {};
    const cleaned = models.map((m) => m.trim());
    cleaned.forEach((value, idx) => {
      if (!value) modelAt[idx] = "Model name cannot be empty";
    });
    if (Object.keys(modelAt).length > 0) next.modelAt = modelAt;

    if (cleaned.filter((m) => m.length > 0).length === 0) {
      next.models = "At least one model is required";
    } else if (cleaned.length > MAX_MODELS) {
      next.models = `Maximum ${MAX_MODELS} models`;
    }

    if (strategy === "round-robin" && stickyLimit.trim() !== "") {
      const n = Number(stickyLimit);
      if (!Number.isInteger(n) || n < MIN_STICKY_LIMIT || n > MAX_STICKY_LIMIT) {
        next.stickyLimit = `Must be an integer between ${MIN_STICKY_LIMIT} and ${MAX_STICKY_LIMIT}`;
      }
    }

    return next;
  }

  function updateModelAt(idx: number, value: string) {
    setModels((prev) => prev.map((m, i) => (i === idx ? value : m)));
  }

  function addModel() {
    if (models.length >= MAX_MODELS) return;
    setModels((prev) => [...prev, ""]);
  }

  function removeModelAt(idx: number) {
    setModels((prev) => {
      if (prev.length <= 1) return [""];
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function handleSubmit() {
    setServerError(null);
    const validation = validate();
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;

    const cleanedModels = models.map((m) => m.trim()).filter((m) => m.length > 0);
    const payload: Record<string, unknown> = {
      models: cleanedModels,
      strategy: strategy === "" ? null : strategy,
      stickyLimit:
        strategy === "round-robin" && stickyLimit.trim() !== ""
          ? Number(stickyLimit)
          : null,
    };

    if (!isEdit) {
      payload.name = name.trim();
    }

    setSubmitting(true);
    try {
      if (isEdit && combo) {
        await fetchApi(`/api/combos/${combo.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await fetchApi(`/api/combos`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      setServerError(e?.message || "Failed to save combo");
    } finally {
      setSubmitting(false);
    }
  }

  const filledCount = models.filter((m) => m.trim().length > 0).length;
  const useFallback = modelsFailed || availableModels.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit Combo: ${combo?.name}` : "Create Combo"}</DialogTitle>
          <DialogDescription>
            Combos route requests to a list of upstream models using either fallback or round-robin strategy.
          </DialogDescription>
        </DialogHeader>

        {serverError && (
          <div className="flex items-start gap-2 rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="break-words">{serverError}</span>
          </div>
        )}

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
              Name {isEdit && <span className="text-[var(--muted-foreground)]">(read-only)</span>}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isEdit}
              placeholder="e.g. fast-coding-combo"
              maxLength={100}
            />
            {errors.name && <p className="mt-1 text-xs text-[var(--destructive)]">{errors.name}</p>}
          </div>

          {/* Models */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">Models</label>
              <span className="text-xs text-[var(--muted-foreground)]">
                {filledCount} / {MAX_MODELS} models
              </span>
            </div>
            <div className="space-y-2">
              {models.map((model, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--muted-foreground)] w-5 text-right shrink-0">
                      {idx + 1}.
                    </span>
                    <ModelSelector
                      value={model}
                      onChange={(v) => updateModelAt(idx, v)}
                      options={availableModels}
                      fallbackToTextInput={useFallback}
                      hasError={!!errors.modelAt?.[idx]}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeModelAt(idx)}
                      disabled={models.length <= 1}
                      title="Remove model"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  {errors.modelAt?.[idx] && (
                    <p className="ml-7 text-xs text-[var(--destructive)]">{errors.modelAt[idx]}</p>
                  )}
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addModel}
              disabled={models.length >= MAX_MODELS}
              className="mt-2"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Model
            </Button>
            {errors.models && <p className="mt-2 text-xs text-[var(--destructive)]">{errors.models}</p>}
          </div>

          {/* Strategy */}
          <div>
            <label className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
              Strategy override
            </label>
            <Select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as StrategyValue)}
            >
              <option value="">Use global default</option>
              <option value="fallback">Fallback</option>
              <option value="round-robin">Round-robin</option>
            </Select>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Leave blank to inherit the global default strategy.
            </p>
          </div>

          {/* Sticky limit (round-robin only) */}
          {strategy === "round-robin" && (
            <div>
              <label className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
                Sticky limit override
              </label>
              <Input
                type="number"
                min={MIN_STICKY_LIMIT}
                max={MAX_STICKY_LIMIT}
                step={1}
                value={stickyLimit}
                onChange={(e) => setStickyLimit(e.target.value)}
                placeholder="leave empty to inherit global"
              />
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                How many requests stick to the same upstream before rotating (1-1000).
              </p>
              {errors.stickyLimit && (
                <p className="mt-1 text-xs text-[var(--destructive)]">{errors.stickyLimit}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create Combo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
