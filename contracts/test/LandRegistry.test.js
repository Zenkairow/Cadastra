const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LandRegistry Contract", function () {
  let identityRegistry, inspectorRegistry, landRegistry;
  let admin, registrarPune, fieldInspectorPune, fieldInspectorNashik, citizenAlice, citizenBob, fakeEscrow, unauthorized;

  const JURISDICTION_PUNE = 101;
  const JURISDICTION_NASHIK = 102;

  const aliceIdentityId = ethers.keccak256(ethers.toUtf8Bytes("ALICE_IDENTITY_UUID"));
  const bobIdentityId = ethers.keccak256(ethers.toUtf8Bytes("BOB_IDENTITY_UUID"));

  const parcelKey1 = ethers.keccak256(ethers.toUtf8Bytes("MH|PUNE|HAVELI|KOTHRUD|45|0"));
  const parcelKey2 = ethers.keccak256(ethers.toUtf8Bytes("MH|PUNE|HAVELI|KOTHRUD|46|0"));

  const geometryHash1 = ethers.keccak256(ethers.toUtf8Bytes("GEOJSON_POLYGON_1"));
  const manifestHash1 = ethers.keccak256(ethers.toUtf8Bytes("DOCUMENT_MANIFEST_1"));

  let oneYearFromNow;

  beforeEach(async function () {
    [
      admin,
      registrarPune,
      fieldInspectorPune,
      fieldInspectorNashik,
      citizenAlice,
      citizenBob,
      fakeEscrow,
      unauthorized
    ] = await ethers.getSigners();

    const block = await ethers.provider.getBlock("latest");
    oneYearFromNow = block.timestamp + 365 * 24 * 60 * 60;

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

    // Set escrow contract
    await landRegistry.setEscrowContract(fakeEscrow.address);

    // Setup Identities
    await identityRegistry.verifyAndBindIdentity(aliceIdentityId, citizenAlice.address);
    await identityRegistry.verifyAndBindIdentity(bobIdentityId, citizenBob.address);

    // Setup Inspector Hierarchy
    await inspectorRegistry.addInspector(registrarPune.address, 1, JURISDICTION_PUNE, oneYearFromNow);
    await inspectorRegistry
      .connect(registrarPune)
      .addInspector(fieldInspectorPune.address, 3, JURISDICTION_PUNE, oneYearFromNow);

    // Inspector in Nashik
    await inspectorRegistry.addInspector(fieldInspectorNashik.address, 3, JURISDICTION_NASHIK, oneYearFromNow);
  });

  describe("Deployment & Configuration", function () {
    it("should initialize with correct dependencies and escrow address", async function () {
      expect(await landRegistry.identityRegistry()).to.equal(await identityRegistry.getAddress());
      expect(await landRegistry.inspectorRegistry()).to.equal(await inspectorRegistry.getAddress());
      expect(await landRegistry.escrowContract()).to.equal(fakeEscrow.address);
    });

    it("should reject non-admin setting the escrow contract", async function () {
      await expect(
        landRegistry.connect(unauthorized).setEscrowContract(unauthorized.address)
      ).to.be.revertedWithCustomError(landRegistry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Land Registration & Duplicate Prevention (RQ2 - Layer 1)", function () {
    it("should allow an authorized inspector to register land in their jurisdiction", async function () {
      await expect(
        landRegistry
          .connect(fieldInspectorPune)
          .registerLand(parcelKey1, aliceIdentityId, JURISDICTION_PUNE, geometryHash1, manifestHash1)
      )
        .to.emit(landRegistry, "LandRegistered")
        .withArgs(1, parcelKey1, aliceIdentityId, JURISDICTION_PUNE, geometryHash1, manifestHash1, (t) => t > 0);

      expect(await landRegistry.isParcelRegistered(parcelKey1)).to.be.true;
      expect(await landRegistry.getLandIdByParcelKey(parcelKey1)).to.equal(1);

      const land = await landRegistry.getLand(1);
      expect(land.ownerIdentityId).to.equal(aliceIdentityId);
      expect(land.status).to.equal(0); // PENDING_VERIFICATION
    });

    it("should BLOCK duplicate registration with the same parcelKey (Layer 1 Revert)", async function () {
      await landRegistry
        .connect(fieldInspectorPune)
        .registerLand(parcelKey1, aliceIdentityId, JURISDICTION_PUNE, geometryHash1, manifestHash1);

      // Attempt duplicate registration
      await expect(
        landRegistry
          .connect(fieldInspectorPune)
          .registerLand(parcelKey1, bobIdentityId, JURISDICTION_PUNE, geometryHash1, manifestHash1)
      ).to.be.revertedWithCustomError(landRegistry, "DuplicateParcelKey");
    });

    it("should reject registration with unverified owner identity", async function () {
      const unverifiedIdentity = ethers.keccak256(ethers.toUtf8Bytes("UNVERIFIED"));

      await expect(
        landRegistry
          .connect(fieldInspectorPune)
          .registerLand(parcelKey1, unverifiedIdentity, JURISDICTION_PUNE, geometryHash1, manifestHash1)
      ).to.be.revertedWithCustomError(landRegistry, "OwnerNotVerified");
    });

    it("should reject inspector from another jurisdiction attempting registration", async function () {
      // Nashik inspector attempting to register land in Pune jurisdiction
      await expect(
        landRegistry
          .connect(fieldInspectorNashik)
          .registerLand(parcelKey1, aliceIdentityId, JURISDICTION_PUNE, geometryHash1, manifestHash1)
      ).to.be.revertedWithCustomError(landRegistry, "UnauthorizedInspector");
    });
  });

  describe("Inspector Land Verification and Rejection", function () {
    beforeEach(async function () {
      await landRegistry
        .connect(fieldInspectorPune)
        .registerLand(parcelKey1, aliceIdentityId, JURISDICTION_PUNE, geometryHash1, manifestHash1);
    });

    it("should verify land when called by an authorized inspector in the same jurisdiction", async function () {
      await expect(landRegistry.connect(fieldInspectorPune).verifyLand(1))
        .to.emit(landRegistry, "LandVerified")
        .withArgs(1, fieldInspectorPune.address, (t) => t > 0);

      const land = await landRegistry.getLand(1);
      expect(land.status).to.equal(1); // VERIFIED
      expect(land.verifiedAt).to.be.gt(0);
    });

    it("should reject verification from wrong jurisdiction inspector", async function () {
      await expect(
        landRegistry.connect(fieldInspectorNashik).verifyLand(1)
      ).to.be.revertedWithCustomError(landRegistry, "UnauthorizedInspector");
    });

    it("should allow rejection of invalid land application", async function () {
      await expect(landRegistry.connect(fieldInspectorPune).rejectLand(1, "Encroaches public road"))
        .to.emit(landRegistry, "LandRejected")
        .withArgs(1, fieldInspectorPune.address, "Encroaches public road", (t) => t > 0);

      const land = await landRegistry.getLand(1);
      expect(land.status).to.equal(3); // REJECTED
    });
  });

  describe("Escrow Integration: Lock, Unlock, and Ownership Settlement", function () {
    beforeEach(async function () {
      await landRegistry
        .connect(fieldInspectorPune)
        .registerLand(parcelKey1, aliceIdentityId, JURISDICTION_PUNE, geometryHash1, manifestHash1);
      await landRegistry.connect(fieldInspectorPune).verifyLand(1);
    });

    it("should allow escrow contract to lock land for transfer", async function () {
      const transferId = 1001;

      await expect(landRegistry.connect(fakeEscrow).lockForTransfer(1, transferId))
        .to.emit(landRegistry, "LandLockedForTransfer")
        .withArgs(1, transferId, (t) => t > 0);

      const land = await landRegistry.getLand(1);
      expect(land.status).to.equal(2); // LOCKED_IN_TRANSFER
      expect(land.activeTransferId).to.equal(transferId);
    });

    it("should reject non-escrow caller attempting to lock land", async function () {
      await expect(
        landRegistry.connect(unauthorized).lockForTransfer(1, 1001)
      ).to.be.revertedWithCustomError(landRegistry, "OnlyEscrowAllowed");
    });

    it("should allow escrow contract to unlock land upon cancellation or refund", async function () {
      await landRegistry.connect(fakeEscrow).lockForTransfer(1, 1001);

      await expect(landRegistry.connect(fakeEscrow).unlockFromTransfer(1))
        .to.emit(landRegistry, "LandUnlockedFromTransfer")
        .withArgs(1, 1001, (t) => t > 0);

      const land = await landRegistry.getLand(1);
      expect(land.status).to.equal(1); // VERIFIED
      expect(land.activeTransferId).to.equal(0);
    });

    it("should execute atomic ownership transfer on escrow settlement", async function () {
      await landRegistry.connect(fakeEscrow).lockForTransfer(1, 1001);

      await expect(landRegistry.connect(fakeEscrow).executeOwnershipTransfer(1, bobIdentityId))
        .to.emit(landRegistry, "OwnershipTransferred")
        .withArgs(1, aliceIdentityId, bobIdentityId, (t) => t > 0);

      const land = await landRegistry.getLand(1);
      expect(land.ownerIdentityId).to.equal(bobIdentityId);
      expect(land.status).to.equal(1); // VERIFIED
      expect(land.activeTransferId).to.equal(0);

      // Caller owner check confirms Bob is new owner
      expect(await landRegistry.isCallerLandOwner(1, citizenBob.address)).to.be.true;
      expect(await landRegistry.isCallerLandOwner(1, citizenAlice.address)).to.be.false;
    });
  });

  describe("Identity-Based Ownership & Wallet Recovery Seamless Transition", function () {
    let aliceNewWallet;

    beforeEach(async function () {
      [, , , , , , , , aliceNewWallet] = await ethers.getSigners();

      await landRegistry
        .connect(fieldInspectorPune)
        .registerLand(parcelKey1, aliceIdentityId, JURISDICTION_PUNE, geometryHash1, manifestHash1);
      await landRegistry.connect(fieldInspectorPune).verifyLand(1);
    });

    it("should seamlessly preserve land ownership when a wallet is recovered to a new address", async function () {
      // Alice initially controls the land with citizenAlice wallet
      expect(await landRegistry.isCallerLandOwner(1, citizenAlice.address)).to.be.true;
      expect(await landRegistry.isCallerLandOwner(1, aliceNewWallet.address)).to.be.false;

      // Alice loses her wallet and recovers to aliceNewWallet via IdentityRegistry
      await identityRegistry.recoverWallet(aliceIdentityId, citizenAlice.address, aliceNewWallet.address);

      // Immediately, aliceNewWallet has full land ownership, and old wallet has zero control!
      expect(await landRegistry.isCallerLandOwner(1, aliceNewWallet.address)).to.be.true;
      expect(await landRegistry.isCallerLandOwner(1, citizenAlice.address)).to.be.false;
    });
  });
});
