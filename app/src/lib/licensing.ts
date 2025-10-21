// app/src/lib/licensing.ts
import { supabase } from "./supabase";

export type LicenseTerms = {
  purpose: string;
  term_months: number;
  territory: string | string[];
  media: string[];
  exclusivity: "exclusive" | "non-exclusive";
  start_date?: string;
  deliverables?: string;
  credit_required?: boolean;
  usage_notes?: string;
  fee?: { amount: number; currency: string };
};

export type LicenseRequest = {
  id: string;
  artwork_id: string;
  requester_id: string;
  owner_id: string;
  requested: LicenseTerms;
  status: "open" | "negotiating" | "accepted" | "declined" | "withdrawn";
  accepted_terms: LicenseTerms | null;
  created_at: string;
  updated_at: string;
};

export type LicenseThreadMsg = {
  id: string;
  request_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

/** Create a license request (RLS-safe) */
export async function createLicenseRequest(params: {
  artwork_id: string;
  owner_id: string;        // usually artwork.creator_id
  requested: LicenseTerms;
}): Promise<LicenseRequest> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) throw new Error("Please sign in to request a license.");

  const { data, error } = await supabase
    .from("license_requests")
    .insert({
      artwork_id: params.artwork_id,
      owner_id: params.owner_id,
      requester_id: uid,              // 🔐 required by RLS
      requested: params.requested as any,
    })
    .select("*")
    .single<LicenseRequest>();

  if (error) throw error;
  return data!;
}

/** List requests for an artwork (visible to either party) */
export async function listRequestsForArtwork(artworkId: string) {
  const { data, error } = await supabase
    .from("license_requests")
    .select("*")
    .eq("artwork_id", artworkId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as LicenseRequest[];
}

/** Get a single request with its thread */
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

/** Post a message in the request thread */
export async function postLicenseMessage(requestId: string, body: string) {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("license_threads")
    .insert({ request_id: requestId, author_id: uid, body })
    .select("*")
    .single<LicenseThreadMsg>();
  if (error) throw error;
  return data!;
}

/** Update request status or accept terms (MVP) */
export async function updateLicenseRequest(
  requestId: string,
  patch: Partial<Pick<LicenseRequest, "status" | "accepted_terms">>
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
