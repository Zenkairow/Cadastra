const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  console.log("==========================================================");
  console.log(`Deploying Cadastra 4-Contract Architecture to '${network}' (Chain ID: ${chainId})`);
  console.log("==========================================================");
  console.log("Deployer Address:", deployer.address);

  // 1. IdentityRegistry
  const IdentityRegistry = await hre.ethers.getContractFactory("IdentityRegistry");
  const identityRegistry = await IdentityRegistry.deploy(deployer.address);
  await identityRegistry.waitForDeployment();
  const identityRegistryAddress = await identityRegistry.getAddress();
  const idDeployTx = identityRegistry.deploymentTransaction();
  console.log("1. IdentityRegistry: ", identityRegistryAddress);

  // 2. InspectorRegistry
  const InspectorRegistry = await hre.ethers.getContractFactory("InspectorRegistry");
  const inspectorRegistry = await InspectorRegistry.deploy(deployer.address);
  await inspectorRegistry.waitForDeployment();
  const inspectorRegistryAddress = await inspectorRegistry.getAddress();
  const inspDeployTx = inspectorRegistry.deploymentTransaction();
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
  const landDeployTx = landRegistry.deploymentTransaction();
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
  const escrowDeployTx = transferEscrow.deploymentTransaction();
  console.log("4. TransferEscrow:   ", transferEscrowAddress);

  // 5. Wire TransferEscrow into LandRegistry
  console.log("\nWiring TransferEscrow as authorized escrow in LandRegistry...");
  const tx = await landRegistry.setEscrowContract(transferEscrowAddress);
  await tx.wait();
  console.log("Wiring completed successfully.");

  // 6. Save deployment record
  const deploymentDir = path.join(__dirname, "..", "..", "deployments");
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  const deploymentData = {
    network: network,
    chainId: chainId,
    contracts: {
      IdentityRegistry: {
        address: identityRegistryAddress,
        transactionHash: idDeployTx ? idDeployTx.hash : null,
        blockNumber: idDeployTx ? idDeployTx.blockNumber : null,
        verified: false
      },
      InspectorRegistry: {
        address: inspectorRegistryAddress,
        transactionHash: inspDeployTx ? inspDeployTx.hash : null,
        blockNumber: inspDeployTx ? inspDeployTx.blockNumber : null,
        verified: false
      },
      LandRegistry: {
        address: landRegistryAddress,
        transactionHash: landDeployTx ? landDeployTx.hash : null,
        blockNumber: landDeployTx ? landDeployTx.blockNumber : null,
        verified: false
      },
      TransferEscrow: {
        address: transferEscrowAddress,
        transactionHash: escrowDeployTx ? escrowDeployTx.hash : null,
        blockNumber: escrowDeployTx ? escrowDeployTx.blockNumber : null,
        verified: false
      }
    },
    lastUpdated: new Date().toISOString()
  };

  const outFile = path.join(deploymentDir, `${network}.json`);
  fs.writeFileSync(outFile, JSON.stringify(deploymentData, null, 2));
  console.log(`\nDeployment details written to: ${outFile}`);

  console.log("\n==========================================================");
  console.log("Environment Variables Configuration:");
  console.log("==========================================================");
  console.log(`IDENTITY_REGISTRY_ADDRESS="${identityRegistryAddress}"`);
  console.log(`INSPECTOR_REGISTRY_ADDRESS="${inspectorRegistryAddress}"`);
  console.log(`LAND_REGISTRY_ADDRESS="${landRegistryAddress}"`);
  console.log(`TRANSFER_ESCROW_ADDRESS="${transferEscrowAddress}"`);
  console.log("==========================================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
