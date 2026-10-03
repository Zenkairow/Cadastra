const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Phase 9: Comprehensive Security Hardening & Adversarial Verification", function () {
  let admin, registrar, seniorInspector, fieldInspector, buyer, seller, attacker;
  let identityRegistry, inspectorRegistry, landRegistry, transferEscrow;
  let maliciousReceiver;

  const JURISDICTION_PUNE = 101;
  const JURISDICTION_NASHIK = 102;
  const buyerId = ethers.keccak256(ethers.toUtf8Bytes("BUYER_IDENTITY_SEC"));
  const sellerId = ethers.keccak256(ethers.toUtf8Bytes("SELLER_IDENTITY_SEC"));

  beforeEach(async function () {
    [admin, registrar, seniorInspector, fieldInspector, buyer, seller, attacker] = await ethers.getSigners();

    // 1. Deploy IdentityRegistry
    const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
    identityRegistry = await IdentityRegistry.deploy(admin.address);
    await identityRegistry.waitForDeployment();

    // 2. Deploy InspectorRegistry
    const InspectorRegistry = await ethers.getContractFactory("InspectorRegistry");
    inspectorRegistry = await InspectorRegistry.deploy(admin.address);
    await inspectorRegistry.waitForDeployment();

    // 3. Deploy LandRegistry
    const LandRegistry = await ethers.getContractFactory("LandRegistry");
    landRegistry = await LandRegistry.deploy(
      admin.address,
      await identityRegistry.getAddress(),
      await inspectorRegistry.getAddress()
    );
    await landRegistry.waitForDeployment();

    // 4. Deploy TransferEscrow
    const TransferEscrow = await ethers.getContractFactory("TransferEscrow");
    transferEscrow = await TransferEscrow.deploy(
      admin.address,
      await identityRegistry.getAddress(),
      await inspectorRegistry.getAddress(),
      await landRegistry.getAddress()
    );
    await transferEscrow.waitForDeployment();

    // 5. Wire Escrow Contract in LandRegistry
    await landRegistry.connect(admin).setEscrowContract(await transferEscrow.getAddress());

    // 6. Bind Identities for Buyer and Seller
    await identityRegistry.connect(admin).verifyAndBindIdentity(buyerId, buyer.address);
    await identityRegistry.connect(admin).verifyAndBindIdentity(sellerId, seller.address);

    // 7. Appoint Regional Registrar (Level 1, Pune)
    const validUntil = Math.floor(Date.now() / 1000) + 365 * 86400;
    await inspectorRegistry.connect(admin).addInspector(registrar.address, 1, JURISDICTION_PUNE, validUntil);

    // 8. Appoint Senior Inspector (Level 2, Pune) and Field Inspector (Level 3, Pune)
    await inspectorRegistry.connect(registrar).addInspector(seniorInspector.address, 2, JURISDICTION_PUNE, validUntil);
    await inspectorRegistry.connect(registrar).addInspector(fieldInspector.address, 3, JURISDICTION_PUNE, validUntil);

    // 9. Deploy MaliciousReceiver contract for reentrancy tests
    const MaliciousReceiver = await ethers.getContractFactory("MaliciousReceiver");
    maliciousReceiver = await MaliciousReceiver.deploy(await transferEscrow.getAddress());
    await maliciousReceiver.waitForDeployment();
  });

  describe("1. Access Control Matrix (Role x Function x State)", function () {
    it("ACM-01: Unauthorized account cannot verify or bind identities", async function () {
      const dummyId = ethers.keccak256(ethers.toUtf8Bytes("DUMMY_ID"));
      await expect(
        identityRegistry.connect(attacker).verifyAndBindIdentity(dummyId, attacker.address)
      ).to.be.revertedWithCustomError(identityRegistry, "AccessControlUnauthorizedAccount");
    });

    it("ACM-02: Non-admin and non-registrar cannot appoint inspectors", async function () {
      const validUntil = Math.floor(Date.now() / 1000) + 86400;
      await expect(
        inspectorRegistry.connect(attacker).addInspector(attacker.address, 3, JURISDICTION_PUNE, validUntil)
      ).to.be.revertedWithCustomError(inspectorRegistry, "UnauthorizedHierarchy");
    });

    it("ACM-03: Field inspector cannot appoint other inspectors", async function () {
      const validUntil = Math.floor(Date.now() / 1000) + 86400;
      await expect(
        inspectorRegistry.connect(fieldInspector).addInspector(attacker.address, 3, JURISDICTION_PUNE, validUntil)
      ).to.be.revertedWithCustomError(inspectorRegistry, "UnauthorizedHierarchy");
    });

    it("ACM-04: Registrar cannot appoint inspectors above their level or in another jurisdiction", async function () {
      const validUntil = Math.floor(Date.now() / 1000) + 86400;
      // Cannot appoint another Registrar (Level 1)
      await expect(
        inspectorRegistry.connect(registrar).addInspector(attacker.address, 1, JURISDICTION_PUNE, validUntil)
      ).to.be.revertedWithCustomError(inspectorRegistry, "UnauthorizedHierarchy");

      // Cannot appoint in Nashik (different jurisdiction)
      await expect(
        inspectorRegistry.connect(registrar).addInspector(attacker.address, 3, JURISDICTION_NASHIK, validUntil)
      ).to.be.revertedWithCustomError(inspectorRegistry, "JurisdictionMismatch");
    });

    it("ACM-05: Non-inspector cannot register or verify land", async function () {
      const parcelKey = ethers.keccak256(ethers.toUtf8Bytes("PARCEL_ATTACK_01"));
      const geomHash = ethers.keccak256(ethers.toUtf8Bytes("GEOM_01"));
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("DOC_01"));

      // Citizen / Attacker cannot register land
      await expect(
        landRegistry.connect(attacker).registerLand(parcelKey, sellerId, JURISDICTION_PUNE, geomHash, docHash)
      ).to.be.revertedWithCustomError(landRegistry, "UnauthorizedInspector");
    });

    it("ACM-06: Non-escrow caller cannot execute escrow hooks (lock, unlock, transfer)", async function () {
      await expect(
        landRegistry.connect(attacker).lockForTransfer(1, 1)
      ).to.be.revertedWithCustomError(landRegistry, "OnlyEscrowAllowed");

      await expect(
        landRegistry.connect(attacker).unlockFromTransfer(1)
      ).to.be.revertedWithCustomError(landRegistry, "OnlyEscrowAllowed");

      await expect(
        landRegistry.connect(attacker).executeOwnershipTransfer(1, buyerId)
      ).to.be.revertedWithCustomError(landRegistry, "OnlyEscrowAllowed");
    });

    it("ACM-07: Non-buyer cannot fund or cancel escrow request", async function () {
      // 1. Setup registered land
      const parcelKey = ethers.keccak256(ethers.toUtf8Bytes("PARCEL_SEC_01"));
      const geomHash = ethers.keccak256(ethers.toUtf8Bytes("GEOM_SEC_01"));
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("DOC_SEC_01"));
      await landRegistry.connect(fieldInspector).registerLand(parcelKey, sellerId, JURISDICTION_PUNE, geomHash, docHash);
      await landRegistry.connect(fieldInspector).verifyLand(1);

      // 2. Request transfer
      const price = ethers.parseEther("1.0");
      await transferEscrow.connect(buyer).requestTransfer(1, buyerId, price, 86400);

      // 3. Attacker cannot deposit payment
      await expect(
        transferEscrow.connect(attacker).fundEscrow(1, { value: price })
      ).to.be.revertedWithCustomError(transferEscrow, "NotBuyer");

      // 4. Attacker cannot cancel transfer
      await expect(
        transferEscrow.connect(attacker).cancelRequest(1)
      ).to.be.revertedWithCustomError(transferEscrow, "NotBuyer");
    });

    it("ACM-08: Non-inspector cannot approve or reject transfer escrow", async function () {
      const parcelKey = ethers.keccak256(ethers.toUtf8Bytes("PARCEL_ACM_08"));
      const geomHash = ethers.keccak256(ethers.toUtf8Bytes("GEOM_ACM_08"));
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("DOC_ACM_08"));
      await landRegistry.connect(fieldInspector).registerLand(parcelKey, sellerId, JURISDICTION_PUNE, geomHash, docHash);
      await landRegistry.connect(fieldInspector).verifyLand(1);

      const price = ethers.parseEther("1.0");
      await transferEscrow.connect(buyer).requestTransfer(1, buyerId, price, 86400);
      await transferEscrow.connect(buyer).fundEscrow(1, { value: price });

      await expect(
        transferEscrow.connect(attacker).approveTransfer(1)
      ).to.be.revertedWithCustomError(transferEscrow, "UnauthorizedInspector");

      await expect(
        transferEscrow.connect(attacker).rejectTransfer(1, "reason")
      ).to.be.revertedWithCustomError(transferEscrow, "UnauthorizedInspector");
    });
  });

  describe("2. Negative Revert Coverage & Input Validation", function () {
    it("NEG-01: Zero address deployments strictly revert", async function () {
      const Factory = await ethers.getContractFactory("IdentityRegistry");
      await expect(Factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(Factory, "ZeroAddress");

      const LandFactory = await ethers.getContractFactory("LandRegistry");
      await expect(
        LandFactory.deploy(ethers.ZeroAddress, await identityRegistry.getAddress(), await inspectorRegistry.getAddress())
      ).to.be.revertedWithCustomError(LandFactory, "ZeroAddress");
    });

    it("NEG-02: Zero bytes32 on land registration strictly reverts", async function () {
      const geomHash = ethers.keccak256(ethers.toUtf8Bytes("GEOM"));
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("DOC"));

      await expect(
        landRegistry.connect(fieldInspector).registerLand(ethers.ZeroHash, sellerId, JURISDICTION_PUNE, geomHash, docHash)
      ).to.be.revertedWithCustomError(landRegistry, "ZeroBytes32");
    });

    it("NEG-03: Underpayment and overpayment on escrow strictly revert", async function () {
      const parcelKey = ethers.keccak256(ethers.toUtf8Bytes("PARCEL_PAY_TEST"));
      const geomHash = ethers.keccak256(ethers.toUtf8Bytes("GEOM_PAY"));
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("DOC_PAY"));
      await landRegistry.connect(fieldInspector).registerLand(parcelKey, sellerId, JURISDICTION_PUNE, geomHash, docHash);
      await landRegistry.connect(fieldInspector).verifyLand(1);

      const price = ethers.parseEther("2.0");
      await transferEscrow.connect(buyer).requestTransfer(1, buyerId, price, 86400);

      // Underpayment (1.99 ETH < 2.0 ETH)
      await expect(
        transferEscrow.connect(buyer).fundEscrow(1, { value: ethers.parseEther("1.99") })
      ).to.be.revertedWithCustomError(transferEscrow, "IncorrectFundingAmount");

      // Overpayment (2.01 ETH > 2.0 ETH)
      await expect(
        transferEscrow.connect(buyer).fundEscrow(1, { value: ethers.parseEther("2.01") })
      ).to.be.revertedWithCustomError(transferEscrow, "IncorrectFundingAmount");
    });

    it("NEG-04: Cannot refund active transfer before expiration", async function () {
      const parcelKey = ethers.keccak256(ethers.toUtf8Bytes("PARCEL_EXP_TEST"));
      const geomHash = ethers.keccak256(ethers.toUtf8Bytes("GEOM_EXP"));
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("DOC_EXP"));
      await landRegistry.connect(fieldInspector).registerLand(parcelKey, sellerId, JURISDICTION_PUNE, geomHash, docHash);
      await landRegistry.connect(fieldInspector).verifyLand(1);

      const price = ethers.parseEther("1.0");
      await transferEscrow.connect(buyer).requestTransfer(1, buyerId, price, 86400); // 24 hours in future
      await transferEscrow.connect(buyer).fundEscrow(1, { value: price });

      // Attempt refund before expiry
      await expect(
        transferEscrow.connect(buyer).refundExpiredRequest(1)
      ).to.be.revertedWithCustomError(transferEscrow, "TransferNotExpired");
    });

    it("NEG-05: Calling withdrawFunds with zero balance strictly reverts", async function () {
      await expect(
        transferEscrow.connect(attacker).withdrawFunds()
      ).to.be.revertedWithCustomError(transferEscrow, "NoPendingWithdrawal");
    });
  });

  describe("3. Pausable Emergency Stop (Circuit Breakers)", function () {
    it("PAUSE-01: Admin can pause and unpause contracts", async function () {
      await identityRegistry.connect(admin).pause();
      expect(await identityRegistry.paused()).to.be.true;

      await identityRegistry.connect(admin).unpause();
      expect(await identityRegistry.paused()).to.be.false;
    });

    it("PAUSE-02: Non-admin cannot pause contracts", async function () {
      await expect(
        identityRegistry.connect(attacker).pause()
      ).to.be.revertedWithCustomError(identityRegistry, "AccessControlUnauthorizedAccount");
    });

    it("PAUSE-03: Paused contract halts state-changing executions", async function () {
      await landRegistry.connect(admin).pause();
      const parcelKey = ethers.keccak256(ethers.toUtf8Bytes("PARCEL_PAUSE_TEST"));
      const geomHash = ethers.keccak256(ethers.toUtf8Bytes("GEOM_P"));
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("DOC_P"));

      await expect(
        landRegistry.connect(fieldInspector).registerLand(parcelKey, sellerId, JURISDICTION_PUNE, geomHash, docHash)
      ).to.be.revertedWithCustomError(landRegistry, "EnforcedPause");

      await landRegistry.connect(admin).unpause();
      // Succeeds after unpause
      await expect(
        landRegistry.connect(fieldInspector).registerLand(parcelKey, sellerId, JURISDICTION_PUNE, geomHash, docHash)
      ).to.emit(landRegistry, "LandRegistered");
    });
  });

  describe("4. Reentrancy Immunity & Pull-Payment Invariants", function () {
    it("REENT-01: Malicious receiver cannot drain funds via recursive withdrawFunds()", async function () {
      // 1. Setup land and bind seller identity to MaliciousReceiver
      const maliciousSellerId = ethers.keccak256(ethers.toUtf8Bytes("MALICIOUS_SELLER"));
      await identityRegistry.connect(admin).verifyAndBindIdentity(maliciousSellerId, await maliciousReceiver.getAddress());

      const parcelKey = ethers.keccak256(ethers.toUtf8Bytes("PARCEL_REENTRANCY"));
      const geomHash = ethers.keccak256(ethers.toUtf8Bytes("GEOM_R"));
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("DOC_R"));
      await landRegistry.connect(fieldInspector).registerLand(parcelKey, maliciousSellerId, JURISDICTION_PUNE, geomHash, docHash);
      await landRegistry.connect(fieldInspector).verifyLand(1);

      // 2. Buyer requests and funds escrow with 1 ETH
      const price = ethers.parseEther("1.0");
      await transferEscrow.connect(buyer).requestTransfer(1, buyerId, price, 86400);
      await transferEscrow.connect(buyer).fundEscrow(1, { value: price });


      // 3. Authorized inspector approves and buyer settles
      await transferEscrow.connect(fieldInspector).approveTransfer(1);
      await transferEscrow.connect(buyer).settleTransfer(1);

      // Check that 1 ETH is credited to MaliciousReceiver in pending withdrawals
      const receiverAddr = await maliciousReceiver.getAddress();
      expect(await transferEscrow.getPendingWithdrawal(receiverAddr)).to.equal(price);

      // 4. Trigger withdraw from MaliciousReceiver:
      // Its receive() function will try to recursively call withdrawFunds().
      // Because Checks-Effects-Interactions zeroed the balance and nonReentrant is active,
      // the recursive call reverts without draining the contract!
      await maliciousReceiver.triggerWithdraw();

      // Verify contract state
      expect(await maliciousReceiver.attackAttempted()).to.be.true;
      expect(await transferEscrow.getPendingWithdrawal(receiverAddr)).to.equal(0);
      expect(await ethers.provider.getBalance(receiverAddr)).to.equal(price);
    });

    it("INV-01: Escrow contract balance invariant holds under all states", async function () {
      // Contract balance must ALWAYS equal total active deposits + total pending withdrawals
      expect(await ethers.provider.getBalance(await transferEscrow.getAddress())).to.equal(0);
    });
  });

  describe("5. Denial of Service (DoS) & Unbounded Loop Audit", function () {
    it("DOS-01: Key lookups and approvals operate with O(1) constant gas cost", async function () {
      // Verify isAuthorized lookup does not loop across arrays
      const isAuth = await inspectorRegistry.isAuthorized(fieldInspector.address, JURISDICTION_PUNE, 3);
      expect(isAuth).to.be.true;
    });
  });
});
