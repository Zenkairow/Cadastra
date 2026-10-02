const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("==========================================================");
  console.log("Milestone M2: Deploying Complete 4-Contract Architecture");
  console.log("==========================================================");
  console.log("Deployer Address:", deployer.address);

  // 1. IdentityRegistry
  const IdentityRegistry = await hre.ethers.getContractFactory("IdentityRegistry");
  const identityRegistry = await IdentityRegistry.deploy(deployer.address);
  await identityRegistry.waitForDeployment();
  const identityRegistryAddress = await identityRegistry.getAddress();
  console.log("1. IdentityRegistry: ", identityRegistryAddress);

  // 2. InspectorRegistry
  const InspectorRegistry = await hre.ethers.getContractFactory("InspectorRegistry");
  const inspectorRegistry = await InspectorRegistry.deploy(deployer.address);
  await inspectorRegistry.waitForDeployment();
  const inspectorRegistryAddress = await inspectorRegistry.getAddress();
  console.log("2. InspectorRegistry:", inspectorRegistryAddress);

  // 3. LandRegistry
  const LandRegistry = await hre.ethers.getContractFactory("LandRegistry");
  const landRegistry = await LandRegistry.deploy(
    deployer.address,
    identityRegistryAddress,
    inspectorRegistryAddress
  );
  await landRegistry.waitForDeployment();
  const landRegistryAddress = await landRegistry.getAddress();
  console.log("3. LandRegistry:     ", landRegistryAddress);

  // 4. TransferEscrow
  const TransferEscrow = await hre.ethers.getContractFactory("TransferEscrow");
  const transferEscrow = await TransferEscrow.deploy(
    deployer.address,
    identityRegistryAddress,
    inspectorRegistryAddress,
    landRegistryAddress
  );
  await transferEscrow.waitForDeployment();
  const transferEscrowAddress = await transferEscrow.getAddress();
  console.log("4. TransferEscrow:   ", transferEscrowAddress);

  // 5. Wire TransferEscrow into LandRegistry
  console.log("\nWiring TransferEscrow as authorized escrow in LandRegistry...");
  const tx = await landRegistry.setEscrowContract(transferEscrowAddress);
  await tx.wait();
  console.log("Wiring completed successfully.");

  console.log("\n==========================================================");
  console.log("Environment Variables (.env snippet):");
  console.log("==========================================================");
  console.log(`IDENTITY_REGISTRY_ADDRESS="${identityRegistryAddress}"`);
  console.log(`INSPECTOR_REGISTRY_ADDRESS="${inspectorRegistryAddress}"`);
  console.log(`LAND_REGISTRY_ADDRESS="${landRegistryAddress}"`);
  console.log(`TRANSFER_ESCROW_ADDRESS="${transferEscrowAddress}"`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
