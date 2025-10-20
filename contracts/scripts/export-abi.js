// Writes the compiled ABI to contracts/abi/NFT.json
const fs = require("fs");
const path = require("path");

const artifactsDir = path.join(__dirname, "..", "artifacts", "contracts", "TaedalNFT.sol");
const artifactPath = path.join(artifactsDir, "TaedalNFT.json");

const outDir = path.join(__dirname, "..", "abi");
const outPath = path.join(outDir, "NFT.json");

function main() {
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const abi = artifact.abi;

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(abi, null, 2));
  console.log("ABI exported to:", outPath);
}

main();
