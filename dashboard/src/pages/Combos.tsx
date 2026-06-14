import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Layers, Plus, Pencil, Trash2 } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { useTimedMessage } from "@/hooks/useTimedMessage";
import { useWsEvent } from "@/hooks/useWebSocket";
import ComboFormModal, { type Combo } from "@/components/ComboFormModal";

interface CombosListResponse {
  combos: Combo[];
}

function formatDate(value: string): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function describeStrategy(combo: Combo): string {
  if (!combo.strategy) return "Global default";
  if (combo.strategy === "round-robin") {
    return combo.stickyLimit != null
      ? `Round-robin (sticky ${combo.stickyLimit})`
      : "Round-robin";
  }
  return "Fallback";
}

function modelsPreview(models: string[]): string {
  if (models.length === 0) return "-";
  const first = models.slice(0, 2).join(", ");
  return models.length > 2 ? `${first}, +${models.length - 2} more` : first;
}

export default function Combos() {
  const [combos, setCombos] = useState<Combo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCombo, setEditingCombo] = useState<Combo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Combo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { message, setMessage } = useTimedMessage<string>(null, 3000);

  const load = useCallback(async () => {
    try {
      const res = await fetchApi<CombosListResponse>("/api/combos");
      setCombos(res.combos || []);
    } catch {
      setCombos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useWsEvent(["combos_updated"], load);

  function handleCreate() {
    setEditingCombo(null);
    setModalOpen(true);
  }

  function handleEdit(combo: Combo) {
    setEditingCombo(combo);
    setModalOpen(true);
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await fetchApi(`/api/combos/${confirmDelete.id}`, { method: "DELETE" });
      setMessage(`Combo "${confirmDelete.name}" deleted`);
      setConfirmDelete(null);
      load();
    } catch (e: any) {
      setMessage(e?.message || "Failed to delete combo");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Combos</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Group multiple upstream models behind a single virtual model name with fallback or round-robin routing.
          </p>
        </div>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="w-3 h-3 mr-1" />
          Create Combo
        </Button>
      </div>

      {message && (
        <div className="px-4 py-2 rounded-md bg-[var(--secondary)] text-sm text-[var(--foreground)]">
          {message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Combos ({combos.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--primary)]" />
            </div>
          ) : combos.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--secondary)]">
                <Layers className="w-5 h-5 text-[var(--muted-foreground)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">No combos yet</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Create your first combo to route a virtual model to a list of upstreams.
                </p>
              </div>
              <Button size="sm" onClick={handleCreate}>
                <Plus className="w-3 h-3 mr-1" />
                Create Combo
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Models</th>
                    <th className="px-3 py-2 font-medium">Strategy</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {combos.map((combo) => (
                    <tr
                      key={combo.id}
                      className="border-b border-[var(--border)]/40 last:border-b-0 hover:bg-[var(--secondary)]/40"
                    >
                      <td className="px-3 py-3 align-top">
                        <span className="font-mono text-xs font-medium text-[var(--foreground)]">
                          {combo.name}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 rounded bg-[var(--primary)]/10 text-[10px] font-semibold text-[var(--primary)]">
                            {combo.models.length}
                          </span>
                          <span
                            className="font-mono text-xs text-[var(--muted-foreground)] truncate max-w-[280px]"
                            title={combo.models.join(", ")}
                          >
                            {modelsPreview(combo.models)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span className="text-xs text-[var(--foreground)]">
                          {describeStrategy(combo)}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-[var(--muted-foreground)]">
                        {formatDate(combo.createdAt)}
                      </td>
                      <td className="px-3 py-3 align-top text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(combo)}
                            title="Edit combo"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setConfirmDelete(combo)}
                            title="Delete combo"
                          >
                            <Trash2 className="w-4 h-4 text-[var(--destructive)]" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ComboFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        combo={editingCombo}
        onSaved={() => {
          load();
          setMessage(editingCombo ? "Combo updated" : "Combo created");
        }}
      />

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete combo?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-mono font-semibold text-[var(--foreground)]">
                {confirmDelete?.name}
              </span>
              ? This cannot be undone. Requests targeting this combo name will start
              returning a not-found error.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
