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
  // optional extras we referenced
  sublicense?: boolean;
  derivative_edits?: string[]; // e.g. ["resize","crop"]
};

export type LicenseRequest = {
  id: string;
  artwork_id: string;
  requester_id: string;
  owner_id: string;
  requested: LicenseTerms;            // working terms during negotiation
  status: "open" | "negotiating" | "accepted" | "declined" | "withdrawn";
  accepted_terms: LicenseTerms | null; // final snapshot when accepted
  created_at: string;
  updated_at: string;
};

export type LicenseThreadMsg = {
  id: string;
  request_id: string;
  author_id: string;
  body: string;
  patch?: Partial<LicenseTerms> | null; // NEW: structured change
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

export const LICENSE_TEMPLATES: { id: string; title: string; terms: LicenseTerms }[] = [
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
      deliverables: "Right to use artwork image in campaign creatives on social and web.",
      usage_notes: "No logo lockups; link back to creator profile.",
      fee: { amount: 1200, currency: "USD" },
      sublicense: false,
      derivative_edits: ["resize", "crop"]
    }
  },
  {
    id: "paid-ads",
    title: "Paid Ads (non-exclusive, US+CA, 12m)",
    terms: {
      purpose: "Advertising - Paid Media",
      term_months: 12,
      territory: ["US", "CA"],
      media: ["Web", "Social", "Display"],
      exclusivity: "non-exclusive",
      fee: { amount: 2500, currency: "USD" },
      credit_required: false,
      usage_notes: "No political/controversial adjacency.",
      sublicense: false,
      derivative_edits: ["resize", "crop", "color-correct"]
    }
  },
  {
    id: "print-run",
    title: "Print Run (category-exclusive, 12m)",
    terms: {
      purpose: "Merchandise / Print",
      term_months: 12,
      territory: "Worldwide",
      media: ["Print", "Packaging", "POS"],
      exclusivity: "category-exclusive",
      fee: { amount: 5000, currency: "USD" },
      credit_required: false,
      deliverables: "Use for product packaging + retail POS.",
      sublicense: false
    }
  }
];

/* ----------------------------- Utilities ---------------------------- */

export function mergeTerms<T extends object>(base: T, patch?: Partial<T> | null): T {
  if (!patch) return base;
  // shallow merge + array replacement for deterministic behavior
  const out: any = { ...base };
  for (const k of Object.keys(patch)) {
    (out as any)[k] = (patch as any)[k];
  }
  return out as T;
}

// Produce human-friendly diffs for UI
export type TermDiff = { key: keyof LicenseTerms; before: any; after: any };
export function diffTerms(a: LicenseTerms, b: LicenseTerms): TermDiff[] {
  const keys = new Set<keyof LicenseTerms>([
    "purpose","term_months","territory","media","exclusivity","start_date",
    "deliverables","credit_required","usage_notes","fee","sublicense","derivative_edits"
  ] as (keyof LicenseTerms)[]);
  const diffs: TermDiff[] = [];
  keys.forEach((k) => {
    const va = (a as any)[k];
    const vb = (b as any)[k];
    const sa = JSON.stringify(va ?? null);
    const sb = JSON.stringify(vb ?? null);
    if (sa !== sb) diffs.push({ key: k, before: va, after: vb });
  });
  return diffs;
}

/* ------------------------------- Queries ------------------------------ */

export async function createLicenseRequest(params: {
  artwork_id: string;
  owner_id: string;        // usually artwork.creator_id
  requested: LicenseTerms;
}): Promise<LicenseRequest> {
  const { data, error } = await supabase
    .from("license_requests")
    .insert({
      artwork_id: params.artwork_id,
      owner_id: params.owner_id,
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

  return {
    request: req!,
    messages: (msgs ?? []) as (LicenseThreadMsg[]),
  };
}

/* ------------------------------ Messages ------------------------------ */

export async function postLicenseMessage(
  requestId: string,
  body: string,
  patch?: Partial<LicenseTerms> | null
) {
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

/* -------------------------- Negotiation actions ------------------------- */

// Merge the patch into the working terms (license_requests.requested)
export async function acceptPatch(requestId: string, patch: Partial<LicenseTerms>) {
  // Load current working terms
  const { data: cur, error: e1 } = await supabase
    .from("license_requests")
    .select("requested,status")
    .eq("id", requestId)
    .single<{ requested: LicenseTerms; status: LicenseRequest["status"] }>();
  if (e1) throw e1;

  const nextTerms = mergeTerms(cur!.requested, patch);
  const nextStatus: LicenseRequest["status"] =
    cur!.status === "open" ? "negotiating" : cur!.status;

  const { data, error } = await supabase
    .from("license_requests")
    .update({ requested: nextTerms as any, status: nextStatus })
    .eq("id", requestId)
    .select("*")
    .single<LicenseRequest>();
  if (error) throw error;
  return data!;
}

// Finalize the deal: copy working → accepted_terms, set accepted
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
  patch: Partial<Pick<LicenseRequest, "status" | "accepted_terms" | "requested">>
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

/* ------------------------------- Approvals ------------------------------ */

export async function listApprovals(requestId: string) {
  const { data, error } = await supabase
    .from("license_approvals")
    .select("*")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LicenseApproval[];
}

export async function upsertApproval(params: {
  request_id: string;
  stage: LicenseApproval["stage"];
  decision: LicenseApproval["decision"];
  note?: string;
}) {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) throw new Error("Not signed in");

  // If you want strict “one row per stage+approver”, we can use upsert with unique index later.
  const { data, error } = await supabase
    .from("license_approvals")
    .insert({
      request_id: params.request_id,
      approver_id: uid,
      stage: params.stage,
      decision: params.decision,
      note: params.note ?? null,
      decided_at: params.decision === "pending" ? null : new Date().toISOString(),
    })
    .select("*")
    .single<LicenseApproval>();
  if (error) throw error;
  return data!;
}

/* -------------------------- Quick helpers for UI ------------------------- */

export function asArrayTerritory(t: LicenseTerms["territory"]) {
  return Array.isArray(t) ? t : (t ? [t] : []);
}

export function stringifyTerritory(t: LicenseTerms["territory"]) {
  return Array.isArray(t) ? t.join(", ") : (t ?? "");
}
