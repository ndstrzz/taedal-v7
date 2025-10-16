import { useState } from "react";

export default function TagsInput({
  value,
  onChange,
  placeholder = "Add tag and press Enter",
  max = 20,
}: {
  value?: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const [text, setText] = useState("");
  const tags = value || [];

  function add(tag: string) {
    const t = tag.trim();
    if (!t) return;
    if (tags.includes(t)) return;
    if (tags.length >= max) return;
    onChange([...tags, t]);
    setText("");
  }
  function remove(i: number) {
    const next = tags.slice();
    next.splice(i, 1);
    onChange(next);
  }

  return (
    <div className="rounded-md border border-neutral-700 bg-neutral-900 p-2">
      <div className="flex flex-wrap gap-2">
        {tags.map((t, i) => (
          <span
            key={`${t}-${i}`}
            className="px-2 py-0.5 text-xs rounded-full bg-neutral-800"
          >
            {t}{" "}
            <button
              type="button"
              onClick={() => remove(i)}
              className="ml-1 text-neutral-400 hover:text-white"
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="flex-1 bg-transparent outline-none px-1 py-0.5"
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(text);
            }
          }}
        />
      </div>
    </div>
  );
}
