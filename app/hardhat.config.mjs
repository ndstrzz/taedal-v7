import dotenv from "dotenv";
import "@nomicfoundation/hardhat-ethers";

dotenv.config({ path: ".env.hardhat" });

const { PRIVATE_KEY = "", SEPOLIA_RPC_URL = "" } = process.env;
const accounts = PRIVATE_KEY ? [PRIVATE_KEY.trim()] : [];

export default {
  solidity: "0.8.20",
  networks: {
    sepolia: {
      type: "http",
      url: SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      chainId: 11155111,
      accounts,
    },
  },
};
