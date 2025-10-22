// Thin wallet utilities the UI can call.

import { defaultChain } from "./chains";
import { ensureChain, requestAccounts, sendEthTx } from "./provider";

function toWeiHex(ethAmount: string | number): `0x${string}` {
  const s = String(ethAmount);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Invalid ETH amount");
  const [ints, decs = ""] = s.split(".");
  const d = (decs + "000000000000000000").slice(0, 18);
  const wei = BigInt(ints) * 10n ** 18n + BigInt(d);
  return ("0x" + wei.toString(16)) as `0x${string}`;
}

export async function connectMetaMask() {
  const accounts = await requestAccounts();
  if (!accounts?.length) throw new Error("No account authorized");
  return accounts[0];
}

export async function ensureWalletOnDefaultChain() {
  await ensureChain(defaultChain);
}

export async function payInEth(to: string, from: string, amountEth: number | string) {
  const valueHex = toWeiHex(amountEth);
  return sendEthTx({ from, to, valueHex });
}
