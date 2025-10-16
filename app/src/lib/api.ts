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
