import { useMemo, useState } from "react";

type Props = {
  value: string;
  onChange: (code: string) => void;
  className?: string;
  disabled?: boolean;
  label?: string;
};

const CRYPTO: Array<[string, string]> = [
  ["ETH", "Ethereum"],
  ["BTC", "Bitcoin"],
  ["SOL", "Solana"],
  ["MATIC", "Polygon"],
  ["AVAX", "Avalanche"],
  ["BNB", "BNB Chain"],
  ["USDT", "Tether"],
  ["USDC", "USD Coin"],
  ["DAI", "Dai"],
];

const FIAT: Array<[string, string]> = [
  ["USD", "US Dollar"],
  ["EUR", "Euro"],
  ["GBP", "British Pound"],
  ["JPY", "Japanese Yen"],
  ["KRW", "South Korean Won"],
  ["CNY", "Chinese Yuan"],
  ["INR", "Indian Rupee"],
  ["AUD", "Australian Dollar"],
  ["CAD", "Canadian Dollar"],
  ["SGD", "Singapore Dollar"],
  ["MYR", "Malaysian Ringgit"],
  ["PHP", "Philippine Peso"],
  ["IDR", "Indonesian Rupiah"],
  ["THB", "Thai Baht"],
  ["BRL", "Brazilian Real"],
  ["ZAR", "South African Rand"],
];

function guessGroup(code: string) {
  const c = code?.toUpperCase?.() || "";
  if (CRYPTO.some(([k]) => k === c)) return "crypto";
  if (FIAT.some(([k]) => k === c)) return "fiat";
  return "crypto";
}

export default function CurrencyPicker({
  value,
  onChange,
  className = "",
  disabled = false,
  label,
}: Props) {
  const [group, setGroup] = useState<"crypto" | "fiat">(guessGroup(value));
  const [q, setQ] = useState("");

  const list = group === "crypto" ? CRYPTO : FIAT;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter(
      ([code, name]) =>
        code.toLowerCase().includes(s) || name.toLowerCase().includes(s)
    );
  }, [list, q]);

  return (
    <div className={className}>
      {label && <div className="text-xs text-white/70 mb-1">{label}</div>}

      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setGroup("crypto")}
          className={`px-3 py-1.5 rounded-lg text-sm border ${
            group === "crypto"
              ? "bg-white text-black border-white"
              : "bg-white/5 text-white/90 border-white/10 hover:bg-white/10"
          }`}
        >
          Crypto
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setGroup("fiat")}
          className={`px-3 py-1.5 rounded-lg text-sm border ${
            group === "fiat"
              ? "bg-white text-black border-white"
              : "bg-white/5 text-white/90 border-white/10 hover:bg-white/10"
          }`}
        >
          Fiat
        </button>

        <input
          className="input flex-1"
          placeholder="Search currency…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-auto rounded-lg border border-white/10 p-2 bg-white/5">
        {filtered.map(([code, name]) => {
          const active = value?.toUpperCase() === code;
          return (
            <button
              key={code}
              type="button"
              disabled={disabled}
              onClick={() => onChange(code)}
              className={`text-left px-3 py-2 rounded-md border text-sm transition ${
                active
                  ? "bg-white text-black border-white"
                  : "bg-white/0 text-white/90 border-white/10 hover:bg-white/10"
              }`}
              title={name}
            >
              <div className="font-semibold">{code}</div>
              <div className="text-[11px] text-white/70 truncate">{name}</div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full text-center text-sm text-white/60 py-6">
            No matches.
          </div>
        )}
      </div>

      <div className="text-[11px] text-white/60 mt-2">
        Selected: <code>{value || "—"}</code>
      </div>
    </div>
  );
}
