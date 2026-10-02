const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying Phase 1 contracts with account:", deployer.address);

  // 1. Deploy IdentityRegistry
  const IdentityRegistry = await hre.ethers.getContractFactory("IdentityRegistry");
  const identityRegistry = await IdentityRegistry.deploy(deployer.address);
  await identityRegistry.waitForDeployment();
  const identityRegistryAddress = await identityRegistry.getAddress();
  console.log("IdentityRegistry deployed to:", identityRegistryAddress);

  // 2. Deploy InspectorRegistry
  const InspectorRegistry = await hre.ethers.getContractFactory("InspectorRegistry");
  const inspectorRegistry = await InspectorRegistry.deploy(deployer.address);
  await inspectorRegistry.waitForDeployment();
  const inspectorRegistryAddress = await inspectorRegistry.getAddress();
  console.log("InspectorRegistry deployed to:", inspectorRegistryAddress);

  console.log("\nDeployment summary:");
  console.log("-------------------");
  console.log(`IDENTITY_REGISTRY_ADDRESS="${identityRegistryAddress}"`);
  console.log(`INSPECTOR_REGISTRY_ADDRESS="${inspectorRegistryAddress}"`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
