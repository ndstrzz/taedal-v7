// app/src/lib/licensing.ts
import { supabase } from "./supabase";

/* ------------------------------- Types ------------------------------- */

export type LicenseTerms = {
  purpose: string;
  term_months: number;
  territory: string | string[];
  media: string[];
  exclusivity: "exclusive" | "non-exclusive" | "category-exclusive";
  start_date?: string;
  deliverables?: string;
  credit_required?: boolean;
  usage_notes?: string;
  fee?: { amount: number; currency: string };
  sublicense?: boolean;
  derivative_edits?: string[];
};

export type LicenseRequest = {
  id: string;
  artwork_id: string;
  requester_id: string;
  owner_id: string;
  requested: LicenseTerms;
  status: "open" | "negotiating" | "accepted" | "declined" | "withdrawn";
  accepted_terms: LicenseTerms | null;

  // NEW: execution record
  executed_pdf_url: string | null;
  executed_pdf_sha256: string | null;
  signed_at: string | null;
  signer_name: string | null;
  signer_title: string | null;

  created_at: string;
  updated_at: string;
};

export type LicenseThreadMsg = {
  id: string;
  request_id: string;
  author_id: string;
  body: string;
  patch?: Partial<LicenseTerms> | null;
  created_at: string;
};

export type LicenseApproval = {
  id: string;
  request_id: string;
  approver_id: string;
  stage: "legal" | "finance" | "brand";
  decision: "pending" | "approved" | "rejected";
  note?: string | null;
  decided_at?: string | null;
  created_at: string;
};

/* ----------------------------- Templates ---------------------------- */

export const LICENSE_TEMPLATES = [
  {
    id: "social-promo",
    title: "Social Promo (non-exclusive, WW, 6m)",
    terms: {
      purpose: "Advertising - Social & Web",
      term_months: 6,
      territory: "Worldwide",
      media: ["Web", "Social"],
      exclusivity: "non-exclusive",
      credit_required: true,
      deliverables: "Use on social/web creatives.",
      usage_notes: "Link back to creator.",
      fee: { amount: 1200, currency: "USD" },
      sublicense: false,
      derivative_edits: ["resize", "crop"]
    } as LicenseTerms
  },
  {
    id: "paid-ads",
    title: "Paid Ads (US+CA, 12m)",
    terms: {
      purpose: "Advertising - Paid Media",
      term_months: 12,
      territory: ["US", "CA"],
      media: ["Web", "Social", "Display"],
      exclusivity: "non-exclusive",
      fee: { amount: 2500, currency: "USD" }
    } as LicenseTerms
  }
];

/* ----------------------------- Utilities ---------------------------- */

export function mergeTerms<T extends object>(base: T, patch?: Partial<T> | null): T {
  if (!patch) return base;
  const out: any = { ...base };
  for (const k of Object.keys(patch)) out[k] = (patch as any)[k];
  return out as T;
}

export type TermDiff = { key: keyof LicenseTerms; before: any; after: any };
export function diffTerms(a: LicenseTerms, b: LicenseTerms): TermDiff[] {
  const keys: (keyof LicenseTerms)[] = [
    "purpose","term_months","territory","media","exclusivity","start_date",
    "deliverables","credit_required","usage_notes","fee","sublicense","derivative_edits"
  ];
  const diffs: TermDiff[] = [];
  for (const k of keys) {
    const sa = JSON.stringify((a as any)[k] ?? null);
    const sb = JSON.stringify((b as any)[k] ?? null);
    if (sa !== sb) diffs.push({ key: k, before: (a as any)[k], after: (b as any)[k] });
  }
  return diffs;
}

export function stringifyTerritory(t: LicenseTerms["territory"]) {
  return Array.isArray(t) ? t.join(", ") : (t ?? "");
}

/* ------------------------------- Queries ------------------------------ */

export async function getRequestWithThread(requestId: string) {
  const { data: req, error: e1 } = await supabase
    .from("license_requests")
    .select("*")
    .eq("id", requestId)
    .single<LicenseRequest>();
  if (e1) throw e1;

  const { data: msgs, error: e2 } = await supabase
    .from("license_threads")
    .select("*")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true });
  if (e2) throw e2;

  return { request: req!, messages: (msgs ?? []) as LicenseThreadMsg[] };
}

export async function postLicenseMessage(requestId: string, body: string, patch?: Partial<LicenseTerms> | null) {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("license_threads")
    .insert({ request_id: requestId, author_id: uid, body, patch: patch ?? null })
    .select("*")
    .single<LicenseThreadMsg>();
  if (error) throw error;
  return data!;
}

export async function acceptPatch(requestId: string, patch: Partial<LicenseTerms>) {
  const { data: cur, error: e1 } = await supabase
    .from("license_requests")
    .select("requested,status")
    .eq("id", requestId)
    .single<{ requested: LicenseTerms; status: LicenseRequest["status"] }>();
  if (e1) throw e1;
  const next = mergeTerms(cur!.requested, patch);
  const nextStatus = cur!.status === "open" ? "negotiating" : cur!.status;
  const { data, error } = await supabase
    .from("license_requests")
    .update({ requested: next as any, status: nextStatus })
    .eq("id", requestId)
    .select("*")
    .single<LicenseRequest>();
  if (error) throw error;
  return data!;
}

export async function acceptOffer(requestId: string) {
  const { data: cur, error: e1 } = await supabase
    .from("license_requests")
    .select("requested")
    .eq("id", requestId)
    .single<{ requested: LicenseTerms }>();
  if (e1) throw e1;

  const { data, error } = await supabase
    .from("license_requests")
    .update({ accepted_terms: cur!.requested as any, status: "accepted" })
    .eq("id", requestId)
    .select("*")
    .single<LicenseRequest>();
  if (error) throw error;
  return data!;
}

export async function updateLicenseRequest(
  requestId: string,
  patch: Partial<Pick<LicenseRequest, "status" | "accepted_terms" | "requested" | "executed_pdf_url" | "executed_pdf_sha256" | "signed_at" | "signer_name" | "signer_title">>
) {
  const { data, error } = await supabase
    .from("license_requests")
    .update(patch as any)
    .eq("id", requestId)
    .select("*")
    .single<LicenseRequest>();
  if (error) throw error;
  return data!;
}

/* ------------------------- PDF generation & upload ------------------------- */

export async function generateContractPdf(requestId: string) {
  const { data, error } = await supabase.functions.invoke("generate-contract-pdf", {
    body: { request_id: requestId },
  });
  if (error) throw error;
  return data as { path: string; url?: string };
}

export async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function uploadExecutedPdf(requestId: string, file: File, signer: { name: string; title?: string }) {
  if (file.type !== "application/pdf") throw new Error("Please upload a PDF.");
  const hash = await sha256(file);
  const path = `requests/${requestId}/executed-${Date.now()}.pdf`;

  const { error: e1 } = await supabase.storage.from("contracts").upload(path, file, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (e1) throw e1;

  const { data: pub } = await supabase.storage.from("contracts").createSignedUrl(path, 60 * 60 * 24 * 7);

  // store execution record
  const updated = await updateLicenseRequest(requestId, {
    executed_pdf_url: pub?.signedUrl ?? null,
    executed_pdf_sha256: hash,
    signed_at: new Date().toISOString(),
    signer_name: signer.name,
    signer_title: signer.title ?? null,
  });

  return { updated, path, url: pub?.signedUrl, sha256: hash };
}

/* ----------------------------- Attachments ----------------------------- */

export async function uploadAttachment(requestId: string, file: File, kind?: string) {
  const key = `requests/${requestId}/${Date.now()}-${file.name}`;
  const { error: e1 } = await supabase.storage.from("license_attachments").upload(key, file, {
    upsert: true,
  });
  if (e1) throw e1;
  const { data } = await supabase.from("license_attachments").insert({
    request_id: requestId,
    path: key,
    kind: kind ?? null,
  }).select("*");
  return data;
}

/* -------------------------- Small helpers for UI -------------------------- */

export function formatMoney(f?: { amount: number; currency: string }) {
  return f ? `${f.amount.toLocaleString()} ${f.currency}` : "—";
}
