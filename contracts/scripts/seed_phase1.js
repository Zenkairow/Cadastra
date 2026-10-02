const hre = require("hardhat");

async function main() {
  const [
    admin,
    registrarPune,
    registrarNashik,
    seniorInspectorPune,
    fieldInspectorPune,
    citizenAlice,
    citizenBob
  ] = await hre.ethers.getSigners();

  console.log("==========================================");
  console.log("Seeding Phase 1 Governance & Identity State");
  console.log("==========================================");
  console.log("Admin Address:", admin.address);

  // 1. Deploy IdentityRegistry
  const IdentityRegistry = await hre.ethers.getContractFactory("IdentityRegistry");
  const identityRegistry = await IdentityRegistry.deploy(admin.address);
  await identityRegistry.waitForDeployment();
  const identityRegistryAddress = await identityRegistry.getAddress();
  console.log("IdentityRegistry:", identityRegistryAddress);

  // 2. Deploy InspectorRegistry
  const InspectorRegistry = await hre.ethers.getContractFactory("InspectorRegistry");
  const inspectorRegistry = await InspectorRegistry.deploy(admin.address);
  await inspectorRegistry.waitForDeployment();
  const inspectorRegistryAddress = await inspectorRegistry.getAddress();
  console.log("InspectorRegistry:", inspectorRegistryAddress);

  const block = await hre.ethers.provider.getBlock("latest");
  const oneYearFromNow = block.timestamp + 365 * 24 * 60 * 60;
  const JURISDICTION_PUNE = 101;
  const JURISDICTION_NASHIK = 102;

  // 3. Admin appoints Regional Registrars
  console.log("\n[1/3] Appointing Regional Registrars...");
  await (await inspectorRegistry.addInspector(registrarPune.address, 1, JURISDICTION_PUNE, oneYearFromNow)).wait();
  console.log(`- Registrar Pune (Level 1, Jurisdiction ${JURISDICTION_PUNE}): ${registrarPune.address}`);

  await (await inspectorRegistry.addInspector(registrarNashik.address, 1, JURISDICTION_NASHIK, oneYearFromNow)).wait();
  console.log(`- Registrar Nashik (Level 1, Jurisdiction ${JURISDICTION_NASHIK}): ${registrarNashik.address}`);

  // 4. Regional Registrar appoints Senior & Field Inspectors
  console.log("\n[2/3] Appointing Regional Inspectors...");
  await (await inspectorRegistry.connect(registrarPune).addInspector(seniorInspectorPune.address, 2, JURISDICTION_PUNE, oneYearFromNow)).wait();
  console.log(`- Senior Inspector Pune (Level 2, Jurisdiction ${JURISDICTION_PUNE}): ${seniorInspectorPune.address}`);

  await (await inspectorRegistry.connect(registrarPune).addInspector(fieldInspectorPune.address, 3, JURISDICTION_PUNE, oneYearFromNow)).wait();
  console.log(`- Field Inspector Pune (Level 3, Jurisdiction ${JURISDICTION_PUNE}): ${fieldInspectorPune.address}`);

  // 5. Seed Citizen Identities
  console.log("\n[3/3] Binding Citizen Platform Identities...");
  const aliceIdentityId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("CITIZEN_ALICE_UUID"));
  const bobIdentityId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("CITIZEN_BOB_UUID"));

  await (await identityRegistry.verifyAndBindIdentity(aliceIdentityId, citizenAlice.address)).wait();
  console.log(`- Alice (Identity: ${aliceIdentityId.slice(0, 10)}...): Wallet ${citizenAlice.address}`);

  await (await identityRegistry.verifyAndBindIdentity(bobIdentityId, citizenBob.address)).wait();
  console.log(`- Bob (Identity: ${bobIdentityId.slice(0, 10)}...): Wallet ${citizenBob.address}`);

  console.log("\nSeed completed successfully!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
