import React from "react";

function isSafeHttpUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function splitIntoParts(text: string): Array<{ kind: "text" | "url"; value: string }> {
  const re = /\bhttps?:\/\/[^\s<>()"]+/gi;
  const parts: Array<{ kind: "text" | "url"; value: string }> = [];

  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const raw = m[0];

    if (start > last) parts.push({ kind: "text", value: text.slice(last, start) });

    // strip trailing punctuation from URL itself
    const cleaned = raw.replace(/[),.;!?]+$/g, "");
    parts.push({ kind: "url", value: cleaned });

    last = start + raw.length;
  }

  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

function parsePayLink(u: string): null | { amount?: string; currency?: string; label: string } {
  try {
    const url = new URL(u);
    const pay = url.searchParams.get("pay");
    if (pay !== "1") return null;

    const amount = url.searchParams.get("amount") ?? undefined;
    const currency = url.searchParams.get("currency") ?? url.searchParams.get("mode") ?? undefined;

    let label = "Pay now";
    if (amount) label = "Pay now";

    return { amount, currency, label };
  } catch {
    return null;
  }
}

export default function LinkifyText({ text }: { text: string }) {
  const parts = splitIntoParts(text);

  return (
    <span>
      {parts.map((p, idx) => {
        if (p.kind === "text") return <React.Fragment key={idx}>{p.value}</React.Fragment>;

        if (!isSafeHttpUrl(p.value)) return <React.Fragment key={idx}>{p.value}</React.Fragment>;

        const pay = parsePayLink(p.value);

        // ✅ Render payment CTA as a button-like chip instead of raw URL
        if (pay) {
          return (
            <a
              key={idx}
              href={p.value}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-400/15 px-3 py-1.5 text-emerald-100 hover:bg-emerald-400/20 transition no-underline break-words"
              title="Open payment"
            >
              <span className="text-sm">💳</span>
              <span className="text-sm font-medium">{pay.label}</span>
              {pay.amount ? (
                <span className="text-xs text-emerald-200/80">
                  {pay.currency ? `${pay.currency.toUpperCase()} ` : ""}
                  {pay.amount}
                </span>
              ) : null}
            </a>
          );
        }

        // normal links
        return (
          <a
            key={idx}
            href={p.value}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 text-sky-200 hover:text-sky-100 break-words"
          >
            {p.value}
          </a>
        );
      })}
    </span>
  );
}
