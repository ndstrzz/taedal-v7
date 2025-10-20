const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const TaedalNFT = await hre.ethers.getContractFactory("TaedalNFT");
  const nft = await TaedalNFT.deploy();
  await nft.waitForDeployment();

  const address = await nft.getAddress();
  console.log("TaedalNFT deployed to:", address);

  if (hre.network.name === "sepolia") {
    console.log("Waiting a few blocks before verify…");
    await nft.deploymentTransaction().wait(5);
    try {
      await hre.run("verify:verify", { address, constructorArguments: [] });
      console.log("Verified ✅");
    } catch (e) {
      console.log("Verify skipped/failed:", e.message || e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
