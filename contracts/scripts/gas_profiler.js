const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const JURISDICTION_PUNE = 101;
const JURISDICTION_NASHIK = 102;

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function mean(values) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

async function main() {
  console.log("================================================================================");
  console.log(" CADASTRA SMART CONTRACT GAS PROFILER (PHASE 10 EMPIRICAL MEASUREMENT)");
  console.log(" Target EVM: Cancun | Solidity: 0.8.24 | Target Network: Ethereum Sepolia");
  console.log("================================================================================\n");

  const [admin, registrar, seniorInspector, fieldInspector, buyer, seller, claimant] = await ethers.getSigners();
  const gasResults = [];

  async function recordOp(category, operation, txPromise) {
    const tx = await txPromise;
    const receipt = await tx.wait();
    const gasUsed = Number(receipt.gasUsed);
    return gasUsed;
  }

  // --- 1. DEPLOYMENT GAS COSTS ---
  console.log("--> Profiling Contract Deployments...");
  const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
  const idDeployTx = await IdentityRegistry.deploy(admin.address);
  const idReceipt = await idDeployTx.deploymentTransaction().wait();
  const identityRegistry = idDeployTx;
  const idDeployGas = Number(idReceipt.gasUsed);

  const InspectorRegistry = await ethers.getContractFactory("InspectorRegistry");
  const insDeployTx = await InspectorRegistry.deploy(admin.address);
  const insReceipt = await insDeployTx.deploymentTransaction().wait();
  const inspectorRegistry = insDeployTx;
  const insDeployGas = Number(insReceipt.gasUsed);

  const LandRegistry = await ethers.getContractFactory("LandRegistry");
  const landDeployTx = await LandRegistry.deploy(
    admin.address,
    await identityRegistry.getAddress(),
    await inspectorRegistry.getAddress()
  );
  const landReceipt = await landDeployTx.deploymentTransaction().wait();
  const landRegistry = landDeployTx;
  const landDeployGas = Number(landReceipt.gasUsed);

  const TransferEscrow = await ethers.getContractFactory("TransferEscrow");
  const escrowDeployTx = await TransferEscrow.deploy(
    admin.address,
    await identityRegistry.getAddress(),
    await inspectorRegistry.getAddress(),
    await landRegistry.getAddress()
  );
  const escrowReceipt = await escrowDeployTx.deploymentTransaction().wait();
  const transferEscrow = escrowDeployTx;
  const escrowDeployGas = Number(escrowReceipt.gasUsed);

  // Wire Escrow
  const wireTx = await landRegistry.connect(admin).setEscrowContract(await transferEscrow.getAddress());
  const wireGas = Number((await wireTx.wait()).gasUsed);

  gasResults.push(
    { category: "Deployment", operation: "IdentityRegistry.deploy()", gasUsed: [idDeployGas] },
    { category: "Deployment", operation: "InspectorRegistry.deploy()", gasUsed: [insDeployGas] },
    { category: "Deployment", operation: "LandRegistry.deploy()", gasUsed: [landDeployGas] },
    { category: "Deployment", operation: "TransferEscrow.deploy()", gasUsed: [escrowDeployGas] },
    { category: "Configuration", operation: "LandRegistry.setEscrowContract()", gasUsed: [wireGas] }
  );

  // --- 2. IDENTITY REGISTRY OPERATIONS ---
  console.log("--> Profiling IdentityRegistry Operations (5 runs)...");
  const bindGas = [];
  const recoverGas = [];
  for (let i = 0; i < 5; i++) {
    const identityId = ethers.keccak256(ethers.toUtf8Bytes(`CITIZEN_BENCH_${i}`));
    const tempWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    
    // verifyAndBindIdentity
    const gas1 = await recordOp("Identity", "verifyAndBindIdentity()",
      identityRegistry.connect(admin).verifyAndBindIdentity(identityId, tempWallet.address)
    );
    bindGas.push(gas1);

    // recoverWallet
    const newWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    const gas2 = await recordOp("Identity", "recoverWallet()",
      identityRegistry.connect(admin).recoverWallet(identityId, tempWallet.address, newWallet.address)
    );
    recoverGas.push(gas2);
  }
  gasResults.push(
    { category: "Identity", operation: "verifyAndBindIdentity()", gasUsed: bindGas },
    { category: "Identity", operation: "recoverWallet()", gasUsed: recoverGas }
  );

  // Setup benchmark actors
  const buyerId = ethers.keccak256(ethers.toUtf8Bytes("BENCH_BUYER"));
  const sellerId = ethers.keccak256(ethers.toUtf8Bytes("BENCH_SELLER"));
  await identityRegistry.connect(admin).verifyAndBindIdentity(buyerId, buyer.address);
  await identityRegistry.connect(admin).verifyAndBindIdentity(sellerId, seller.address);

  // --- 3. INSPECTOR REGISTRY OPERATIONS ---
  console.log("--> Profiling InspectorRegistry Operations (5 runs)...");
  const validUntil = Math.floor(Date.now() / 1000) + 365 * 86400;
  const addRegGas = [];
  const addSeniorGas = [];
  const addFieldGas = [];
  const revokeGas = [];

  for (let i = 0; i < 5; i++) {
    const regWallet = ethers.Wallet.createRandom();
    const senWallet = ethers.Wallet.createRandom();
    const fieldWallet = ethers.Wallet.createRandom();

    // Add Level 1 Registrar
    const g1 = await recordOp("Governance", "addInspector(Level 1 - Registrar)",
      inspectorRegistry.connect(admin).addInspector(regWallet.address, 1, JURISDICTION_PUNE, validUntil)
    );
    addRegGas.push(g1);

    // Add Level 2 Senior Inspector
    const g2 = await recordOp("Governance", "addInspector(Level 2 - Senior)",
      inspectorRegistry.connect(admin).addInspector(senWallet.address, 2, JURISDICTION_PUNE, validUntil)
    );
    addSeniorGas.push(g2);

    // Add Level 3 Field Inspector
    const g3 = await recordOp("Governance", "addInspector(Level 3 - Field)",
      inspectorRegistry.connect(admin).addInspector(fieldWallet.address, 3, JURISDICTION_PUNE, validUntil)
    );
    addFieldGas.push(g3);

    // Revoke
    const g4 = await recordOp("Governance", "revokeInspector()",
      inspectorRegistry.connect(admin).revokeInspector(fieldWallet.address)
    );
    revokeGas.push(g4);
  }

  // Appoint permanent benchmark inspectors
  await inspectorRegistry.connect(admin).addInspector(registrar.address, 1, JURISDICTION_PUNE, validUntil);
  await inspectorRegistry.connect(admin).addInspector(seniorInspector.address, 2, JURISDICTION_PUNE, validUntil);
  await inspectorRegistry.connect(admin).addInspector(fieldInspector.address, 3, JURISDICTION_PUNE, validUntil);

  gasResults.push(
    { category: "Governance", operation: "addInspector(Level 1 - Registrar)", gasUsed: addRegGas },
    { category: "Governance", operation: "addInspector(Level 2 - Senior)", gasUsed: addSeniorGas },
    { category: "Governance", operation: "addInspector(Level 3 - Field)", gasUsed: addFieldGas },
    { category: "Governance", operation: "revokeInspector()", gasUsed: revokeGas }
  );

  // --- 4. LAND REGISTRY OPERATIONS ---
  console.log("--> Profiling LandRegistry Operations (5 runs)...");
  const regLandGas = [];
  const verifyLandGas = [];
  const rejectLandGas = [];

  for (let i = 0; i < 5; i++) {
    const parcelKey = ethers.keccak256(ethers.toUtf8Bytes(`PARCEL_BENCH_REG_${i}`));
    const geomHash = ethers.keccak256(ethers.toUtf8Bytes(`GEOM_BENCH_${i}`));
    const docHash = ethers.keccak256(ethers.toUtf8Bytes(`DOC_BENCH_${i}`));

    // registerLand
    const g1 = await recordOp("LandRegistry", "registerLand()",
      landRegistry.connect(fieldInspector).registerLand(parcelKey, sellerId, JURISDICTION_PUNE, geomHash, docHash)
    );
    regLandGas.push(g1);

    const landId = i + 1;
    // verifyLand
    const g2 = await recordOp("LandRegistry", "verifyLand()",
      landRegistry.connect(fieldInspector).verifyLand(landId)
    );
    verifyLandGas.push(g2);
  }

  // Profiling rejectLand
  const rejParcelKey = ethers.keccak256(ethers.toUtf8Bytes("PARCEL_BENCH_REJECT"));
  const rejGeomHash = ethers.keccak256(ethers.toUtf8Bytes("GEOM_REJ"));
  const rejDocHash = ethers.keccak256(ethers.toUtf8Bytes("DOC_REJ"));
  await landRegistry.connect(fieldInspector).registerLand(rejParcelKey, sellerId, JURISDICTION_PUNE, rejGeomHash, rejDocHash);
  const rejectGas = await recordOp("LandRegistry", "rejectLand()",
    landRegistry.connect(fieldInspector).rejectLand(6, "Failed legal title boundary audit")
  );
  rejectLandGas.push(rejectGas);

  gasResults.push(
    { category: "LandRegistry", operation: "registerLand()", gasUsed: regLandGas },
    { category: "LandRegistry", operation: "verifyLand()", gasUsed: verifyLandGas },
    { category: "LandRegistry", operation: "rejectLand()", gasUsed: rejectLandGas }
  );

  // --- 5. TRANSFER ESCROW OPERATIONS (TC01 - TC10) ---
  console.log("--> Profiling TransferEscrow Operations (Complete Lifecycle)...");
  const reqTransferGas = [];
  const fundEscrowGas = [];
  const reviewGas = [];
  const approveStandardGas = [];
  const approveSeniorGas = [];
  const settleGas = [];
  const cancelGas = [];
  const refundGas = [];
  const withdrawGas = [];

  // Run 1: Standard Purchase Escrow (Agreed Price: 1 ETH)
  const price = ethers.parseEther("1.0");
  const duration = 86400; // 1 day

  // requestTransfer (Land 1)
  const gReq = await recordOp("TransferEscrow", "requestTransfer()",
    transferEscrow.connect(buyer).requestTransfer(1, buyerId, price, duration)
  );
  reqTransferGas.push(gReq);

  // fundEscrow (Exact 1 ETH)
  const gFund = await recordOp("TransferEscrow", "fundEscrow()",
    transferEscrow.connect(buyer).fundEscrow(1, { value: price })
  );
  fundEscrowGas.push(gFund);

  // reviewTransfer
  const gRev = await recordOp("TransferEscrow", "reviewTransfer()",
    transferEscrow.connect(fieldInspector).reviewTransfer(1)
  );
  reviewGas.push(gRev);

  // approveTransfer (Standard Field Inspector)
  const gApp = await recordOp("TransferEscrow", "approveTransfer() [Standard < 5 ETH]",
    transferEscrow.connect(fieldInspector).approveTransfer(1)
  );
  approveStandardGas.push(gApp);

  // settleTransfer
  const gSet = await recordOp("TransferEscrow", "settleTransfer()",
    transferEscrow.connect(buyer).settleTransfer(1)
  );
  settleGas.push(gSet);

  // withdrawFunds (Seller claims proceeds)
  const gWit = await recordOp("TransferEscrow", "withdrawFunds() [Pull-Payment]",
    transferEscrow.connect(seller).withdrawFunds()
  );
  withdrawGas.push(gWit);

  // Run 2: High-Value Transfer Governance (Agreed Price: 6 ETH >= 5 ETH Threshold)
  const highPrice = ethers.parseEther("6.0");
  await transferEscrow.connect(buyer).requestTransfer(2, buyerId, highPrice, duration);
  await transferEscrow.connect(buyer).fundEscrow(2, { value: highPrice });
  
  // Field approval
  await transferEscrow.connect(fieldInspector).approveTransfer(2);
  // Senior approval
  const gSenApp = await recordOp("TransferEscrow", "approveTransfer() [Senior >= 5 ETH]",
    transferEscrow.connect(seniorInspector).approveTransfer(2)
  );
  approveSeniorGas.push(gSenApp);
  await transferEscrow.connect(buyer).settleTransfer(2);
  await transferEscrow.connect(seller).withdrawFunds();

  // Run 3: Cancellation Flow (Land 3)
  await transferEscrow.connect(buyer).requestTransfer(3, buyerId, price, duration);
  const gCan = await recordOp("TransferEscrow", "cancelRequest() [Unfunded Cancel]",
    transferEscrow.connect(buyer).cancelRequest(3)
  );
  cancelGas.push(gCan);

  // Run 4: Expiration & Refund Flow (Land 4)
  const shortDuration = 2; // 2 seconds
  await transferEscrow.connect(buyer).requestTransfer(4, buyerId, price, shortDuration);
  await transferEscrow.connect(buyer).fundEscrow(4, { value: price });
  // Fast-forward EVM time by 10 seconds
  await ethers.provider.send("evm_increaseTime", [10]);
  await ethers.provider.send("evm_mine");

  const gRef = await recordOp("TransferEscrow", "refundExpiredRequest()",
    transferEscrow.connect(buyer).refundExpiredRequest(4)
  );
  refundGas.push(gRef);

  gasResults.push(
    { category: "TransferEscrow", operation: "requestTransfer()", gasUsed: reqTransferGas },
    { category: "TransferEscrow", operation: "fundEscrow()", gasUsed: fundEscrowGas },
    { category: "TransferEscrow", operation: "reviewTransfer()", gasUsed: reviewGas },
    { category: "TransferEscrow", operation: "approveTransfer() [Standard < 5 ETH]", gasUsed: approveStandardGas },
    { category: "TransferEscrow", operation: "approveTransfer() [Senior >= 5 ETH]", gasUsed: approveSeniorGas },
    { category: "TransferEscrow", operation: "settleTransfer()", gasUsed: settleGas },
    { category: "TransferEscrow", operation: "cancelRequest() [Unfunded Cancel]", gasUsed: cancelGas },
    { category: "TransferEscrow", operation: "refundExpiredRequest()", gasUsed: refundGas },
    { category: "TransferEscrow", operation: "withdrawFunds() [Pull-Payment]", gasUsed: withdrawGas }
  );

  // --- 6. CIRCUIT BREAKERS ---
  const pauseGas = await recordOp("CircuitBreaker", "pause()", landRegistry.connect(admin).pause());
  const unpauseGas = await recordOp("CircuitBreaker", "unpause()", landRegistry.connect(admin).unpause());
  gasResults.push(
    { category: "CircuitBreaker", operation: "pause()", gasUsed: [pauseGas] },
    { category: "CircuitBreaker", operation: "unpause()", gasUsed: [unpauseGas] }
  );

  // --- FORMATTED OUTPUT & METRICS CALCULATION ---
  console.log("\n================================================================================");
  console.log(" CADASTRA SMART CONTRACT GAS PROFILE RESULTS");
  console.log("================================================================================");
  console.log(
    "Category".padEnd(16) +
    "Operation".padEnd(42) +
    "Runs".padEnd(6) +
    "Min Gas".padEnd(10) +
    "Median Gas".padEnd(12) +
    "Max Gas".padEnd(10) +
    "Mean Gas"
  );
  console.log("-".repeat(102));

  const summaryData = [];

  for (const item of gasResults) {
    const minG = Math.min(...item.gasUsed);
    const maxG = Math.max(...item.gasUsed);
    const medG = median(item.gasUsed);
    const meanG = mean(item.gasUsed);

    console.log(
      item.category.padEnd(16) +
      item.operation.padEnd(42) +
      String(item.gasUsed.length).padEnd(6) +
      String(minG).padEnd(10) +
      String(medG).padEnd(12) +
      String(maxG).padEnd(10) +
      String(meanG)
    );

    summaryData.push({
      category: item.category,
      operation: item.operation,
      sampleSize: item.gasUsed.length,
      minGas: minG,
      medianGas: medG,
      maxGas: maxG,
      meanGas: meanG
    });
  }
  console.log("================================================================================\n");

  // Write JSON artifact
  const outJsonPath = path.resolve(__dirname, "../../docs/benchmark_gas_profile.json");
  fs.writeFileSync(outJsonPath, JSON.stringify(summaryData, null, 2), "utf-8");
  console.log(`[+] Wrote JSON benchmark report to: ${outJsonPath}`);

  // Write CSV artifact
  const outCsvPath = path.resolve(__dirname, "../../docs/benchmark_gas_profile.csv");
  const csvLines = ["Category,Operation,Sample_Size,Min_Gas,Median_Gas,Max_Gas,Mean_Gas"];
  for (const s of summaryData) {
    csvLines.push(`"${s.category}","${s.operation}",${s.sampleSize},${s.minGas},${s.medianGas},${s.maxGas},${s.meanGas}`);
  }
  fs.writeFileSync(outCsvPath, csvLines.join("\n"), "utf-8");
  console.log(`[+] Wrote CSV benchmark report to: ${outCsvPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[-] Gas Profiler Error:", err);
    process.exit(1);
  });
