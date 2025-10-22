// app/src/lib/api.ts
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

export async function getJSON(res: Response) {
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json();
}

/* ────────────────────────────── Types ────────────────────────────── */
export type Shipment = {
  id: string;
  artwork_id: string;
  owner_id: string;
  status: string;                 // 'pending' | 'packed' | 'in_transit' | 'delivered' | 'returned' | 'cancelled'
  carrier: string | null;
  tracking_no: string | null;
  destination: string | null;
  last_location: string | null;
  last_scan_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type NotificationRow = {
  id: number;
  recipient_id: string;
  kind: string;
  title?: string | null;
  body?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  is_read: boolean;
  created_at: string;
};

/* ────────────────────────────── Shipments ────────────────────────────── */

/** List shipments for an artwork (matches server: GET /shipments?artwork_id=...) */
export async function apiListShipments(artworkId: string, token?: string) {
  const res = await apiFetch(
    `/shipments?artwork_id=${encodeURIComponent(artworkId)}`,
    {},
    token
  );
  // { shipments: Shipment[] }
  return getJSON(res) as Promise<{ shipments: Shipment[] }>;
}

/** Create or update a shipment (matches server: POST /shipments) */
export async function apiUpsertShipment(partial: Partial<Shipment>, token?: string) {
  const res = await apiFetch(`/shipments`, { method: "POST", body: JSON.stringify(partial) }, token);
  // { shipment: Shipment }
  return getJSON(res) as Promise<{ shipment: Shipment }>;
}

/** Create a scan event for a shipment (matches server: POST /scan-events) */
export async function apiCreateScanEvent(
  payload: { shipment_id: string; artwork_id: string; location?: string | null; notes?: string | null },
  token?: string
) {
  const res = await apiFetch(`/scan-events`, { method: "POST", body: JSON.stringify(payload) }, token);
  // { scan: any }
  return getJSON(res) as Promise<{ scan: any }>;
}

/* ────────────────────────────── Notifications (poll) ────────────────────────────── */
/** Poll notifications for the current user (server expected to expose /me/notifications) */
export async function apiListNotifications(since: string | undefined, token?: string) {
  const url = since ? `/me/notifications?since=${encodeURIComponent(since)}` : `/me/notifications`;
  const res = await apiFetch(url, {}, token);
  // keep the original shape you were using: { rows: NotificationRow[] }
  return getJSON(res) as Promise<{ rows: NotificationRow[] }>;
}
