import React from "react";

type ProjectionTrend = "up" | "down" | "flat";

type Projection = {
  trend: ProjectionTrend;
  changePct30d: number; // -100..100
  lowUsd30d: number;
  highUsd30d: number;
  growthConfidence: number; // 0..1
  narrative?: string | null;
} | null;

type Props = {
  lowUsd: number | null;
  highUsd: number | null;
  confidence: number | null; // 0..1
  momentumScore: number | null; // 0..100
  skyrocket: boolean | null;

  uscoRecommendation: boolean | null;
  uscoReason: string | null;

  // NEW
  projection?: Projection;
  notes?: string[] | null;
  disclaimer?: string | null;

  lastEvaluatedAt: string | null;

  refreshBusy?: boolean;
  refreshErr?: string | null;
  onRefresh?: () => void;
};

function InfoBar({
  tone = "default",
  children,
}: {
  tone?: "default" | "warning" | "success";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    default: "bg-white/[0.03] border-white/10 text-white/80",
    warning: "bg-amber-400/10 border-amber-300/30 text-amber-200",
    success: "bg-emerald-400/10 border-emerald-300/30 text-emerald-200",
  };
  return <div className={`text-xs rounded-lg px-3 py-2 border ${tones[tone]}`}>{children}</div>;
}

function fmtUsd(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

function trendLabel(t: ProjectionTrend) {
  if (t === "up") return "Up";
  if (t === "down") return "Down";
  return "Flat";
}

export default function AiEvaluationCard(props: Props) {
  const hasAny =
    props.lowUsd != null ||
    props.highUsd != null ||
    props.confidence != null ||
    props.momentumScore != null ||
    props.skyrocket != null ||
    props.uscoRecommendation != null ||
    props.uscoReason != null ||
    props.lastEvaluatedAt != null ||
    (props.projection != null) ||
    (Array.isArray(props.notes) && props.notes.length > 0);

  const last = props.lastEvaluatedAt ? new Date(props.lastEvaluatedAt).toLocaleString() : null;

  const proj = props.projection ?? null;
  const projChange = proj?.changePct30d ?? null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">AI Valuation & Signals</div>
          <div className="text-xs text-white/60">
            Saved on-chain guidance is not a thing — this is saved in your DB for this artwork.
          </div>
        </div>

        {props.onRefresh && (
          <button
            className="btn bg-white/0 border border-white/20 hover:bg-white/10"
            onClick={props.onRefresh}
            disabled={!!props.refreshBusy}
            type="button"
          >
            {props.refreshBusy ? "Refreshing…" : hasAny ? "Refresh AI" : "Run AI"}
          </button>
        )}
      </div>

      {props.refreshErr && (
        <div className="mt-3">
          <InfoBar tone="warning">{props.refreshErr}</InfoBar>
        </div>
      )}

      {!hasAny ? (
        <div className="mt-4">
          <InfoBar tone="warning">No AI evaluation saved yet. Click “Run AI” to generate and store it.</InfoBar>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="text-sm text-white/70">Estimated value range</div>
          <div className="text-3xl font-semibold">
            {props.lowUsd == null || props.highUsd == null
              ? "—"
              : `${fmtUsd(props.lowUsd)} — ${fmtUsd(props.highUsd)}`}
          </div>

          {/* Projection analytics (optional) */}
          {proj && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[11px] text-white/60">Projection analytics</div>

              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="text-sm">
                  <div className="font-medium">
                    Trend: {trendLabel(proj.trend)}{" "}
                    {projChange == null ? null : (
                      <span className="text-white/60">• {projChange >= 0 ? "+" : ""}{Math.round(projChange)}%</span>
                    )}
                  </div>
                  <div className="text-xs text-white/60 mt-1">
                    Projected 30d range:{" "}
                    {proj.lowUsd30d != null && proj.highUsd30d != null
                      ? `${fmtUsd(proj.lowUsd30d)} — ${fmtUsd(proj.highUsd30d)}`
                      : "—"}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs text-white/60">Growth confidence</div>
                  <div className="text-lg font-semibold">
                    {proj.growthConfidence == null ? "—" : `${Math.round(proj.growthConfidence * 100)}%`}
                  </div>
                </div>
              </div>

              {proj.narrative ? (
                <div className="mt-2 text-xs text-white/70 leading-relaxed">
                  {proj.narrative}
                </div>
              ) : null}
            </div>
          )}

          <div className="grid sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[11px] text-white/60">Confidence</div>
              <div className="text-lg font-semibold">
                {props.confidence == null ? "—" : `${Math.round(props.confidence * 100)}%`}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[11px] text-white/60">Momentum score</div>
              <div className="text-lg font-semibold">
                {props.momentumScore == null ? "—" : `${Math.round(props.momentumScore)}/100`}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[11px] text-white/60">Skyrocket potential</div>
              <div className="text-lg font-semibold">
                {props.skyrocket == null ? "—" : props.skyrocket ? "Yes" : "No"}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[11px] text-white/60">USCO suggestion</div>
            <div className="text-sm mt-1">
              {props.uscoRecommendation == null ? (
                <span className="text-white/70">—</span>
              ) : props.uscoRecommendation ? (
                <span className="text-emerald-200">Consider registering</span>
              ) : (
                <span className="text-white/70">Not urgent (based on current signals)</span>
              )}
            </div>
            {props.uscoReason && <div className="text-xs text-white/60 mt-2">{props.uscoReason}</div>}
          </div>

          {Array.isArray(props.notes) && props.notes.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[11px] text-white/60">Notes</div>
              <ul className="mt-2 text-sm text-white/80 list-disc pl-5 space-y-1">
                {props.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="text-[11px] text-white/50">
            {last ? `Last evaluated: ${last}` : "Last evaluated: —"}
            <div className="mt-1">{props.disclaimer ?? "AI estimates are speculative — not financial or legal advice."}</div>
          </div>
        </div>
      )}
    </div>
  );
}
