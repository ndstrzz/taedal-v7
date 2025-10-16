// scripts/deploy-raw.mjs  (ESM, no HRE, no JSON import assertions)
import dotenv from "dotenv";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { JsonRpcProvider, Wallet, ContractFactory } from "ethers";

dotenv.config({ path: ".env.hardhat" });

const { SEPOLIA_RPC_URL, PRIVATE_KEY } = process.env;
if (!SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL missing in .env.hardhat");
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY missing in .env.hardhat");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hardhat artifact produced by `npx hardhat compile`
const artifactPath = path.resolve(
  __dirname,
  "../artifacts/contracts/TaedalNFT.sol/TaedalNFT.json"
);

const artifactJson = JSON.parse(await readFile(artifactPath, "utf8"));
const { abi, bytecode } = artifactJson;
if (!abi || !bytecode) throw new Error("Artifact missing abi/bytecode. Run `npx hardhat compile` first.");

async function main() {
  console.log("Deploying TaedalNFT to Sepolia (raw ethers)…");

  const provider = new JsonRpcProvider(SEPOLIA_RPC_URL, 11155111);
  const wallet = new Wallet(PRIVATE_KEY, provider);

  const factory = new ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  const tx = contract.deploymentTransaction();
  console.log("  tx:", tx?.hash);

  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log("TaedalNFT deployed at:", addr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
