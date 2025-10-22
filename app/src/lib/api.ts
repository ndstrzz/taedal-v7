export const API_URL = import.meta.env.VITE_API_URL;

/** Adds Authorization header if a Supabase access token is provided */
export async function apiFetch(path: string, opts: RequestInit = {}, token?: string) {
  return fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export async function getJSON<T = any>(res: Response): Promise<T> {
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/* ───────────────── Shipments API (client) ───────────────── */

export type Shipment = {
  id: string;
  artwork_id: string;
  owner_id: string;
  status: string;
  carrier: string | null;
  tracking_no: string | null;
  destination: string | null;
  last_location: string | null;
  last_scan_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // optional extra fields your API may include:
  eta?: string | null;
  legs?: Array<{ time?: string; location?: string; note?: string }>;
};

export async function apiListShipments(artworkId: string, token?: string) {
  const r = await apiFetch(`/shipments?artwork_id=${encodeURIComponent(artworkId)}`, {}, token);
  return getJSON<{ shipments: Shipment[] }>(r);
}

export async function apiUpsertShipment(partial: Partial<Shipment>, token?: string) {
  const r = await apiFetch(`/shipments`, { method: "POST", body: JSON.stringify(partial) }, token);
  return getJSON<{ shipment: Shipment }>(r);
}

export async function apiCreateScanEvent(
  payload: { shipment_id: string; artwork_id: string; location?: string | null; notes?: string | null },
  token?: string
) {
  const r = await apiFetch(`/scan-events`, { method: "POST", body: JSON.stringify(payload) }, token);
  return getJSON<{ scan: any }>(r);
}

/* ───────────────── Notifications (poll) ───────────────── */

export async function apiListNotifications(since: string | undefined, token?: string) {
  const url = since ? `/me/notifications?since=${encodeURIComponent(since)}` : `/me/notifications`;
  const res = await apiFetch(url, {}, token);
  return getJSON<{ rows: any[] }>(res);
}
