// app/src/lib/licensing.ts
import { supabase } from "./supabase";

/* ------------------------------- Types ------------------------------- */

export type PaymentTerms = {
  due_days: number;
  late_fee_pct?: number;
  method?: "bank" | "card" | "crypto";
};

export type TaxTerms = {
  responsible_party: "owner" | "licensee";
  vat_registered?: boolean;
};

export type InvoicingInfo = {
  entity_name: string;
  email?: string;
  address?: string;
};

export type DeliverySpecs = {
  format: string;
  width?: number;
  height?: number;
  color?: string; // e.g., "sRGB", "CMYK"
  dpi?: number;
};

export type LiabilityCap =
  | { type: "fees_paid" }
  | { type: "fixed"; amount: number };

export type TerminationTerms = {
  for_convenience?: boolean;
  notice_days?: number;
  breach_cure_days?: number;
  takedown_days?: number;
};

export type DisputesTerms = {
  mode: "courts" | "arbitration";
  law: string;      // e.g., "Singapore"
  venue?: string;   // court venue
  arb_rules?: string; // e.g., "SIAC", "AAA", "ICC"
  seat?: string;      // arbitration seat
};

export type OnchainBlock = {
  chain?: string;               // "Ethereum" | "Sepolia" | ...
  contract_address?: string;
  token_id?: string;
  pay_gas_party?: "owner" | "licensee";
};

export type Royalties = {
  rate_bps: number; // 500 = 5%
  receiver?: string;
};

export type MetadataBlock = {
  image_cid?: string;
  metadata_cid?: string;
  mutable?: boolean;
};

export type LicenseTerms = {
  purpose: string;
  term_months: number;
  territory: string | string[];
  media: string[];
  exclusivity: "exclusive" | "non-exclusive" | "category-exclusive";
  start_date?: string;

  // Existing/basic bits
  deliverables?: string;
  credit_required?: boolean;
  usage_notes?: string;
  fee?: { amount: number; currency: string };
  sublicense?: boolean;
  derivative_edits?: string[];

  // New — admin & payment
  effective_date?: string;
  credit_line?: string;
  payment_terms?: PaymentTerms;
  tax?: TaxTerms;
  invoicing?: InvoicingInfo;

  // New — brand/usage
  brand_guidelines_url?: string;
  preapproval_required?: boolean;
  approval_sla_days?: number;
  prohibited_uses?: string[];
  usage_restrictions?: string[];
  delivery_specs?: DeliverySpecs;

  // New — legal & risk
  confidentiality_term_months?: number;
  liability_cap?: LiabilityCap;
  termination?: TerminationTerms;
  disputes?: DisputesTerms;
  injunctive_relief?: boolean;

  // Optional — on-chain/NFT
  onchain?: OnchainBlock;
  royalties?: Royalties;
  metadata?: MetadataBlock;
};

export type LicenseRequest = {
  id: string;
  artwork_id: string;
  requester_id: string;
  owner_id: string;
  requested: LicenseTerms;
  status: "open" | "negotiating" | "accepted" | "declined" | "withdrawn";
  accepted_terms: LicenseTerms | null;

  // execution record (optional)
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
      credit_line: "© Creator Name / Taedal",
      preapproval_required: true,
      approval_sla_days: 2,
      prohibited_uses: [
        "Hate, violence or illegal content",
        "Political advertising",
        "AI training or model ingestion",
        "Watermark removal"
      ],
      deliverables: "Use on social/web creatives.",
      usage_notes: "Link back to creator.",
      fee: { amount: 1200, currency: "USD" },
      payment_terms: { due_days: 14, method: "bank" },
      tax: { responsible_party: "licensee" },
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
      fee: { amount: 2500, currency: "USD" },
      payment_terms: { due_days: 30, method: "bank" },
      tax: { responsible_party: "licensee" },
      preapproval_required: true
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
    "deliverables","credit_required","usage_notes","fee","sublicense","derivative_edits",
    "effective_date","credit_line","payment_terms","tax","invoicing",
    "brand_guidelines_url","preapproval_required","approval_sla_days",
    "prohibited_uses","usage_restrictions","delivery_specs",
    "confidentiality_term_months","liability_cap","termination","disputes","injunctive_relief",
    "onchain","royalties","metadata"
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

export function formatMoney(f?: { amount: number; currency: string }) {
  return f ? `${f.amount.toLocaleString()} ${f.currency}` : "—";
}

export async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------- CRUD ------------------------------- */

export async function createLicenseRequest(params: {
  artwork_id: string;
  owner_id: string;
  requested: LicenseTerms;
}): Promise<LicenseRequest> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("license_requests")
    .insert({
      artwork_id: params.artwork_id,
      owner_id: params.owner_id,
      requester_id: uid,
      requested: params.requested as any,
    })
    .select("*")
    .single<LicenseRequest>();

  if (error) throw error;
  return data!;
}

export async function listRequestsForArtwork(artworkId: string) {
  const { data, error } = await supabase
    .from("license_requests")
    .select("*")
    .eq("artwork_id", artworkId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as LicenseRequest[];
}

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
  patch: Partial<Pick<LicenseRequest,
    "status" | "accepted_terms" | "requested" |
    "executed_pdf_url" | "executed_pdf_sha256" |
    "signed_at" | "signer_name" | "signer_title">>
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

/* --------------------- Approvals (internal, optional) --------------------- */

export async function listApprovals(requestId: string): Promise<LicenseApproval[]> {
  const { data, error } = await supabase
    .from("license_approvals")
    .select("*")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LicenseApproval[];
}

export async function upsertApproval(requestId: string, stage: LicenseApproval["stage"], decision: LicenseApproval["decision"], note?: string) {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) throw new Error("Not signed in");

  const { data: existing, error: e1 } = await supabase
    .from("license_approvals")
    .select("*")
    .eq("request_id", requestId)
    .eq("approver_id", uid)
    .eq("stage", stage)
    .maybeSingle<LicenseApproval>();
  if (e1) throw e1;

  if (existing) {
    const { data, error } = await supabase
      .from("license_approvals")
      .update({ decision, note: note ?? null, decided_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("*")
      .single<LicenseApproval>();
    if (error) throw error;
    return data!;
  } else {
    const { data, error } = await supabase
      .from("license_approvals")
      .insert({
        request_id: requestId,
        approver_id: uid,
        stage,
        decision,
        note: note ?? null,
        decided_at: decision === "pending" ? null : new Date().toISOString(),
      })
      .select("*")
      .single<LicenseApproval>();
    if (error) throw error;
    return data!;
  }
}

/* ------------------------- Document generation ------------------------- */

export async function generateContractPdf(requestId: string) {
  const { data, error } = await supabase.functions.invoke("generate-contract-pdf", {
    body: { request_id: requestId },
  });
  if (error) throw error;
  // returns { path: string; url?: string | null; html: string }
  return data as { path: string; url?: string | null; html: string };
}

/* ----------------------------- Attachments ----------------------------- */

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

  const updated = await updateLicenseRequest(requestId, {
    executed_pdf_url: pub?.signedUrl ?? null,
    executed_pdf_sha256: hash,
    signed_at: new Date().toISOString(),
    signer_name: signer.name,
    signer_title: signer.title ?? null,
  });

  return { updated, path, url: pub?.signedUrl, sha256: hash };
}

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
