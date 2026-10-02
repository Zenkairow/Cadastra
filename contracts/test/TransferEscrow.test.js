const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TransferEscrow Contract & Test Cases TC01-TC10", function () {
  let identityRegistry, inspectorRegistry, landRegistry, transferEscrow;
  let admin, registrarPune, seniorInspectorPune, fieldInspectorPune, citizenAlice, citizenBob, citizenCharlie, unauthorized;

  const JURISDICTION_PUNE = 101;

  const aliceIdentityId = ethers.keccak256(ethers.toUtf8Bytes("ALICE_ID"));
  const bobIdentityId = ethers.keccak256(ethers.toUtf8Bytes("BOB_ID"));
  const charlieIdentityId = ethers.keccak256(ethers.toUtf8Bytes("CHARLIE_ID"));

  const parcelKey1 = ethers.keccak256(ethers.toUtf8Bytes("MH|PUNE|HAVELI|KOTHRUD|100|0"));
  const geometryHash1 = ethers.keccak256(ethers.toUtf8Bytes("GEO_1"));
  const manifestHash1 = ethers.keccak256(ethers.toUtf8Bytes("MAN_1"));

  const STANDARD_PRICE = ethers.parseEther("1.0");
  const HIGH_PRICE = ethers.parseEther("6.0"); // >= 5 ETH threshold
  const TRANSFER_DURATION = 7 * 24 * 60 * 60; // 7 days

  let oneYearFromNow;

  beforeEach(async function () {
    [
      admin,
      registrarPune,
      seniorInspectorPune,
      fieldInspectorPune,
      citizenAlice, // Seller
      citizenBob,   // Buyer
      citizenCharlie,
      unauthorized
    ] = await ethers.getSigners();

    const block = await ethers.provider.getBlock("latest");
    oneYearFromNow = block.timestamp + 365 * 24 * 60 * 60;

    // 1. IdentityRegistry
    const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
    identityRegistry = await IdentityRegistry.deploy(admin.address);
    await identityRegistry.waitForDeployment();

    // 2. InspectorRegistry
    const InspectorRegistry = await ethers.getContractFactory("InspectorRegistry");
    inspectorRegistry = await InspectorRegistry.deploy(admin.address);
    await inspectorRegistry.waitForDeployment();

    // 3. LandRegistry
    const LandRegistry = await ethers.getContractFactory("LandRegistry");
    landRegistry = await LandRegistry.deploy(
      admin.address,
      await identityRegistry.getAddress(),
      await inspectorRegistry.getAddress()
    );
    await landRegistry.waitForDeployment();

    // 4. TransferEscrow
    const TransferEscrow = await ethers.getContractFactory("TransferEscrow");
    transferEscrow = await TransferEscrow.deploy(
      admin.address,
      await identityRegistry.getAddress(),
      await inspectorRegistry.getAddress(),
      await landRegistry.getAddress()
    );
    await transferEscrow.waitForDeployment();

    // Wire Escrow to LandRegistry
    await landRegistry.setEscrowContract(await transferEscrow.getAddress());

    // Register Identities
    await identityRegistry.verifyAndBindIdentity(aliceIdentityId, citizenAlice.address);
    await identityRegistry.verifyAndBindIdentity(bobIdentityId, citizenBob.address);
    await identityRegistry.verifyAndBindIdentity(charlieIdentityId, citizenCharlie.address);

    // Register Inspectors
    await inspectorRegistry.addInspector(registrarPune.address, 1, JURISDICTION_PUNE, oneYearFromNow);
    await inspectorRegistry.connect(registrarPune).addInspector(seniorInspectorPune.address, 2, JURISDICTION_PUNE, oneYearFromNow);
    await inspectorRegistry.connect(registrarPune).addInspector(fieldInspectorPune.address, 3, JURISDICTION_PUNE, oneYearFromNow);

    // Register & Verify Land #1 (Owned by Alice)
    await landRegistry
      .connect(fieldInspectorPune)
      .registerLand(parcelKey1, aliceIdentityId, JURISDICTION_PUNE, geometryHash1, manifestHash1);
    await landRegistry.connect(fieldInspectorPune).verifyLand(1);
  });

  describe("TC01: Correct Deposit (Exact Funding Success)", function () {
    it("should successfully create request, lock land, and fund exact price", async function () {
      // Bob requests transfer
      await expect(transferEscrow.connect(citizenBob).requestTransfer(1, bobIdentityId, STANDARD_PRICE, TRANSFER_DURATION))
        .to.emit(transferEscrow, "TransferRequested");

      // Verify land is locked
      const land = await landRegistry.getLand(1);
      expect(land.status).to.equal(2); // LOCKED_IN_TRANSFER

      // Bob funds exact deposit
      await expect(transferEscrow.connect(citizenBob).fundEscrow(1, { value: STANDARD_PRICE }))
        .to.emit(transferEscrow, "EscrowFunded")
        .withArgs(1, citizenBob.address, STANDARD_PRICE, (t) => t > 0);

      const req = await transferEscrow.getRequest(1);
      expect(req.state).to.equal(1); // FUNDED
      expect(req.depositAmount).to.equal(STANDARD_PRICE);
    });
  });

  describe("TC02 & TC03: Exact Payment Rule (Underpayment & Overpayment Rejection)", function () {
    beforeEach(async function () {
      await transferEscrow.connect(citizenBob).requestTransfer(1, bobIdentityId, STANDARD_PRICE, TRANSFER_DURATION);
    });

    it("TC02: should REVERT on underpayment", async function () {
      const underpayment = ethers.parseEther("0.5");
      await expect(
        transferEscrow.connect(citizenBob).fundEscrow(1, { value: underpayment })
      ).to.be.revertedWithCustomError(transferEscrow, "IncorrectFundingAmount");
    });

    it("TC03: should REVERT on overpayment", async function () {
      const overpayment = ethers.parseEther("1.5");
      await expect(
        transferEscrow.connect(citizenBob).fundEscrow(1, { value: overpayment })
      ).to.be.revertedWithCustomError(transferEscrow, "IncorrectFundingAmount");
    });
  });

  describe("TC04, TC05, TC06: Settlement & Release Controls", function () {
    beforeEach(async function () {
      await transferEscrow.connect(citizenBob).requestTransfer(1, bobIdentityId, STANDARD_PRICE, TRANSFER_DURATION);
      await transferEscrow.connect(citizenBob).fundEscrow(1, { value: STANDARD_PRICE });
    });

    it("TC05: should REVERT unauthorized release (settling before inspector approval)", async function () {
      // Attempting to settle while only FUNDED (not APPROVED)
      await expect(
        transferEscrow.settleTransfer(1)
      ).to.be.revertedWithCustomError(transferEscrow, "InvalidState");
    });

    it("should settle successfully after authorized inspector approval and disburse via pull-payment", async function () {
      // Inspector approves
      await transferEscrow.connect(fieldInspectorPune).approveTransfer(1);
      let req = await transferEscrow.getRequest(1);
      expect(req.state).to.equal(3); // APPROVED

      // Settle
      await expect(transferEscrow.settleTransfer(1))
        .to.emit(transferEscrow, "TransferSettled")
        .withArgs(1, 1, bobIdentityId, aliceIdentityId, STANDARD_PRICE, (t) => t > 0);

      // Ownership updated on LandRegistry
      const land = await landRegistry.getLand(1);
      expect(land.ownerIdentityId).to.equal(bobIdentityId);
      expect(land.status).to.equal(1); // VERIFIED
      expect(await landRegistry.isCallerLandOwner(1, citizenBob.address)).to.be.true;

      // Seller has claimable balance
      expect(await transferEscrow.getPendingWithdrawal(citizenAlice.address)).to.equal(STANDARD_PRICE);

      // Seller withdraws proceeds
      const initialBalance = await ethers.provider.getBalance(citizenAlice.address);
      const tx = await transferEscrow.connect(citizenAlice).withdrawFunds();
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(citizenAlice.address);

      expect(finalBalance).to.equal(initialBalance + STANDARD_PRICE - gasCost);
    });

    it("TC06: should REVERT double release", async function () {
      await transferEscrow.connect(fieldInspectorPune).approveTransfer(1);
      await transferEscrow.settleTransfer(1);

      // Attempt second settlement
      await expect(
        transferEscrow.settleTransfer(1)
      ).to.be.revertedWithCustomError(transferEscrow, "InvalidState");
    });
  });

  describe("TC07 & TC08: Refund Paths (Cancellation & Expiry)", function () {
    it("TC07: should allow buyer to cancel unfunded request and unlock land", async function () {
      await transferEscrow.connect(citizenBob).requestTransfer(1, bobIdentityId, STANDARD_PRICE, TRANSFER_DURATION);

      await expect(transferEscrow.connect(citizenBob).cancelRequest(1))
        .to.emit(transferEscrow, "TransferCancelled");

      const land = await landRegistry.getLand(1);
      expect(land.status).to.equal(1); // UNLOCKED (VERIFIED)
    });

    it("TC08: should refund buyer on expired request and unlock land", async function () {
      await transferEscrow.connect(citizenBob).requestTransfer(1, bobIdentityId, STANDARD_PRICE, 100); // 100s duration
      await transferEscrow.connect(citizenBob).fundEscrow(1, { value: STANDARD_PRICE });

      // Fast forward time past expiry
      await ethers.provider.send("evm_increaseTime", [150]);
      await ethers.provider.send("evm_mine");

      await expect(transferEscrow.refundExpiredRequest(1))
        .to.emit(transferEscrow, "TransferExpired");

      // Land unlocked
      const land = await landRegistry.getLand(1);
      expect(land.status).to.equal(1);

      // Buyer has claimable refund
      expect(await transferEscrow.getPendingWithdrawal(citizenBob.address)).to.equal(STANDARD_PRICE);

      // Buyer pulls refund
      await expect(transferEscrow.connect(citizenBob).withdrawFunds())
        .to.emit(transferEscrow, "FundsWithdrawn")
        .withArgs(citizenBob.address, STANDARD_PRICE, (t) => t > 0);
    });
  });

  describe("High-Value Transfer Governance (Senior Inspector Threshold)", function () {
    it("should require Senior Inspector approval when price >= 5 ETH", async function () {
      // Bob requests high-value transfer (6 ETH)
      await transferEscrow.connect(citizenBob).requestTransfer(1, bobIdentityId, HIGH_PRICE, TRANSFER_DURATION);
      await transferEscrow.connect(citizenBob).fundEscrow(1, { value: HIGH_PRICE });

      // Field Inspector (Level 3) approves
      await transferEscrow.connect(fieldInspectorPune).approveTransfer(1);
      let req = await transferEscrow.getRequest(1);
      // Still UNDER_REVIEW / not APPROVED because Senior Inspector is required!
      expect(req.state).to.not.equal(3); // Not yet APPROVED

      // Settle fails
      await expect(transferEscrow.settleTransfer(1)).to.be.revertedWithCustomError(
        transferEscrow,
        "InvalidState"
      );

      // Senior Inspector (Level 2) approves
      await transferEscrow.connect(seniorInspectorPune).approveTransfer(1);
      req = await transferEscrow.getRequest(1);
      expect(req.state).to.equal(3); // Now APPROVED!

      // Settle succeeds
      await expect(transferEscrow.settleTransfer(1)).to.emit(transferEscrow, "TransferSettled");
    });
  });

  describe("Escrow Balance Invariant Test", function () {
    it("should guarantee contract balance equals sum of active deposits and pending withdrawals", async function () {
      // 1. Bob requests and funds 1 ETH
      await transferEscrow.connect(citizenBob).requestTransfer(1, bobIdentityId, STANDARD_PRICE, TRANSFER_DURATION);
      await transferEscrow.connect(citizenBob).fundEscrow(1, { value: STANDARD_PRICE });

      let contractBalance = await ethers.provider.getBalance(await transferEscrow.getAddress());
      expect(contractBalance).to.equal(STANDARD_PRICE);

      // 2. Reject transfer (credits refund to Bob)
      await transferEscrow.connect(fieldInspectorPune).rejectTransfer(1, "Inspection failed");
      contractBalance = await ethers.provider.getBalance(await transferEscrow.getAddress());
      expect(contractBalance).to.equal(STANDARD_PRICE); // Balance remains intact before withdrawal

      // 3. Bob pulls refund
      await transferEscrow.connect(citizenBob).withdrawFunds();
      contractBalance = await ethers.provider.getBalance(await transferEscrow.getAddress());
      expect(contractBalance).to.equal(0);
    });
  });
});
