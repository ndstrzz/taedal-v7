// contracts/scripts/export-abi.js
// Export ABI(s) to both /contracts/abi and /app/src/abi

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts", "contracts", "TaedalNFT.sol", "TaedalNFT.json");
const OUT_CONTRACTS = path.join(ROOT, "abi", "NFT.json");
const OUT_APP = path.join(ROOT, "..", "app", "src", "abi", "NFT.json");

function ensureDir(p) {
  const d = path.dirname(p);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function main() {
  if (!fs.existsSync(ARTIFACTS)) {
    console.error("Artifact not found. Run `npm run compile` in /contracts.");
    process.exit(1);
  }
  const artifact = JSON.parse(fs.readFileSync(ARTIFACTS, "utf8"));
  const out = JSON.stringify(artifact.abi, null, 2);

  ensureDir(OUT_CONTRACTS);
  ensureDir(OUT_APP);
  fs.writeFileSync(OUT_CONTRACTS, out);
  fs.writeFileSync(OUT_APP, out);

  console.log("✓ ABI exported:");
  console.log("  -", OUT_CONTRACTS);
  console.log("  -", OUT_APP);
}

main();
