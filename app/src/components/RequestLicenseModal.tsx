// app/src/components/RequestLicenseModal.tsx
import { useEffect, useState } from "react";
import { createLicenseRequest, type LicenseTerms } from "../lib/licensing";
import { supabase } from "../lib/supabase";
import { DEFAULT_LICENSE_TERMS } from "../constants/licenseTemplates";

type Props = {
  open: boolean;
  onClose: () => void;
  artworkId: string;
  ownerId: string; // rights holder (creator for now)
  seed?: Partial<LicenseTerms>; // optional prefill from DB template
};

export default function RequestLicenseModal({ open, onClose, artworkId, ownerId, seed }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [terms, setTerms] = useState<LicenseTerms>(() => ({ ...DEFAULT_LICENSE_TERMS, ...(seed || {}) }));

  useEffect(() => {
    if (open) setErr(null);
  }, [open]);

  if (!open) return null;

  const update = <K extends keyof LicenseTerms>(k: K, v: LicenseTerms[K]) =>
    setTerms((t) => ({ ...t, [k]: v }));

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.user?.id) throw new Error("Please sign in to request a license.");

      await createLicenseRequest({
        artwork_id: artworkId,
        owner_id: ownerId,
        requested: {
          ...terms,
          territory: Array.isArray(terms.territory) ? terms.territory : terms.territory,
        },
      });

      onClose();
    } catch (e: any) {
      setErr(e?.message || "Failed to submit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-neutral-900 text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <h2 className="text-lg font-semibold">Request a License</h2>
          <button className="rounded-lg px-2 py-1 hover:bg-white/10" onClick={onClose}>✕</button>
        </div>

        <div className="grid gap-4 p-4">
          <label className="grid gap-1">
            <span className="text-sm text-white/70">Purpose</span>
            <input
              className="rounded-lg bg-neutral-800 px-3 py-2 outline-none ring-1 ring-transparent focus:ring-white/20"
              value={terms.purpose}
              onChange={(e) => update("purpose", e.target.value)}
              placeholder="e.g., Advertising - Social & Web"
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1">
              <span className="text-sm text-white/70">Term (months)</span>
              <input
                type="number"
                min={1}
                className="rounded-lg bg-neutral-800 px-3 py-2 outline-none ring-1 ring-transparent focus:ring-white/20"
                value={terms.term_months}
                onChange={(e) => update("term_months", Number(e.target.value || 0))}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-white/70">Start date</span>
              <input
                type="date"
                className="rounded-lg bg-neutral-800 px-3 py-2 outline-none ring-1 ring-transparent focus:ring-white/20"
                value={terms.start_date || ""}
                onChange={(e) => update("start_date", e.target.value || undefined)}
              />
            </label>
          </div>

          <label className="grid gap-1">
            <span className="text-sm text-white/70">Territory</span>
            <input
              className="rounded-lg bg-neutral-800 px-3 py-2 outline-none ring-1 ring-transparent focus:ring-white/20"
              value={Array.isArray(terms.territory) ? terms.territory.join(", ") : terms.territory}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw.includes(",")) {
                  update("territory", raw.split(",").map((s) => s.trim()).filter(Boolean));
                } else {
                  update("territory", raw);
                }
              }}
              placeholder='e.g., Worldwide or "US, EU"'
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm text-white/70">Media (comma-separated)</span>
            <input
              className="rounded-lg bg-neutral-800 px-3 py-2 outline-none ring-1 ring-transparent focus:ring-white/20"
              value={terms.media.join(", ")}
              onChange={(e) =>
                update("media", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
              }
              placeholder="Web, Social, Email"
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1">
              <span className="text-sm text-white/70">Exclusivity</span>
              <select
                className="rounded-lg bg-neutral-800 px-3 py-2 outline-none ring-1 ring-transparent focus:ring-white/20"
                value={terms.exclusivity}
                onChange={(e) => update("exclusivity", e.target.value as any)}
              >
                <option value="non-exclusive">non-exclusive</option>
                <option value="exclusive">exclusive</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="text-sm text-white/70">Fee (amount)</span>
                <input
                  type="number"
                  min={0}
                  className="rounded-lg bg-neutral-800 px-3 py-2 outline-none ring-1 ring-transparent focus:ring-white/20"
                  value={terms.fee?.amount ?? 0}
                  onChange={(e) =>
                    update("fee", { amount: Number(e.target.value || 0), currency: terms.fee?.currency || "USD" })
                  }
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm text-white/70">Currency</span>
                <input
                  className="rounded-lg bg-neutral-800 px-3 py-2 outline-none ring-1 ring-transparent focus:ring-white/20"
                  value={terms.fee?.currency ?? "USD"}
                  onChange={(e) =>
                    update("fee", { amount: terms.fee?.amount ?? 0, currency: e.target.value || "USD" })
                  }
                />
              </label>
            </div>
          </div>

          <label className="grid gap-1">
            <span className="text-sm text-white/70">Deliverables</span>
            <textarea
              className="min-h-[72px] rounded-lg bg-neutral-800 px-3 py-2 outline-none ring-1 ring-transparent focus:ring-white/20"
              value={terms.deliverables || ""}
              onChange={(e) => update("deliverables", e.target.value || undefined)}
            />
          </label>

          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!terms.credit_required}
              onChange={(e) => update("credit_required", e.target.checked)}
            />
            <span className="text-sm text-white/70">Credit required</span>
          </label>

          <label className="grid gap-1">
            <span className="text-sm text-white/70">Usage notes</span>
            <textarea
              className="min-h-[64px] rounded-lg bg-neutral-800 px-3 py-2 outline-none ring-1 ring-transparent focus:ring-white/20"
              value={terms.usage_notes || ""}
              onChange={(e) => update("usage_notes", e.target.value || undefined)}
              placeholder="Any constraints or reminders"
            />
          </label>

          {err && <p className="text-sm text-rose-400">{err}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/10 p-4">
          <button className="rounded-lg px-4 py-2 hover:bg-white/10" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="rounded-lg bg-white/10 px-4 py-2 hover:bg-white/20 disabled:opacity-60"
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Submitting..." : "Submit request"}
          </button>
        </div>
      </div>
    </div>
  );
}
