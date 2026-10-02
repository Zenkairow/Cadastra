const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("================================================");
  console.log("Deploying Phase 2 Contracts (Identity + Inspector + Land)");
  console.log("================================================");
  console.log("Deployer Address:", deployer.address);

  // 1. Deploy IdentityRegistry
  const IdentityRegistry = await hre.ethers.getContractFactory("IdentityRegistry");
  const identityRegistry = await IdentityRegistry.deploy(deployer.address);
  await identityRegistry.waitForDeployment();
  const identityRegistryAddress = await identityRegistry.getAddress();
  console.log("1. IdentityRegistry deployed to:", identityRegistryAddress);

  // 2. Deploy InspectorRegistry
  const InspectorRegistry = await hre.ethers.getContractFactory("InspectorRegistry");
  const inspectorRegistry = await InspectorRegistry.deploy(deployer.address);
  await inspectorRegistry.waitForDeployment();
  const inspectorRegistryAddress = await inspectorRegistry.getAddress();
  console.log("2. InspectorRegistry deployed to:", inspectorRegistryAddress);

  // 3. Deploy LandRegistry
  const LandRegistry = await hre.ethers.getContractFactory("LandRegistry");
  const landRegistry = await LandRegistry.deploy(
    deployer.address,
    identityRegistryAddress,
    inspectorRegistryAddress
  );
  await landRegistry.waitForDeployment();
  const landRegistryAddress = await landRegistry.getAddress();
  console.log("3. LandRegistry deployed to:", landRegistryAddress);

  console.log("\nDeployment Summary:");
  console.log("-------------------");
  console.log(`IDENTITY_REGISTRY_ADDRESS="${identityRegistryAddress}"`);
  console.log(`INSPECTOR_REGISTRY_ADDRESS="${inspectorRegistryAddress}"`);
  console.log(`LAND_REGISTRY_ADDRESS="${landRegistryAddress}"`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
