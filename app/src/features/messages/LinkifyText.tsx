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

export default function LinkifyText({ text }: { text: string }) {
  const parts = splitIntoParts(text);

  return (
    <span>
      {parts.map((p, idx) => {
        if (p.kind === "text") return <React.Fragment key={idx}>{p.value}</React.Fragment>;

        if (!isSafeHttpUrl(p.value)) return <React.Fragment key={idx}>{p.value}</React.Fragment>;

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
