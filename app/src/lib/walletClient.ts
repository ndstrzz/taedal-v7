// C:\Users\User\Downloads\taedal-v7\app\src\lib\walletClient.ts

export type CreatedWallet = {
  address: string;
  wallet_id?: string; // optional provider id
};

// Base URL for the backend API.
// Dev: talk directly to the Express server on port 5000.
const API_BASE = "http://localhost:5000";

export async function createWallet(): Promise<CreatedWallet> {
  const base = API_BASE.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/wallets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    // no cookies / auth needed for the dev stub
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    let msg = "Failed to create wallet";
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      if (res.statusText) msg = res.statusText;
    }
    throw new Error(msg);
  }

  return res.json();
}
