// app/scripts/deploy.mjs
import "@nomicfoundation/hardhat-ethers"; // ensure plugin registers
import hre from "hardhat";

async function main() {
  console.log("Deploying TaedalNFT to Sepolia...");

  // Universal (works across hardhat-ethers versions):
  const Factory = await hre.ethers.getContractFactory("TaedalNFT");
  const nft = await Factory.deploy();
  await nft.waitForDeployment();

  const addr = await nft.getAddress();
  console.log("TaedalNFT deployed at:", addr);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
