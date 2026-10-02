const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InspectorRegistry Contract", function () {
  let inspectorRegistry;
  let admin, registrarPune, registrarNashik, seniorInspectorPune, fieldInspectorPune, unauthorized;

  const JURISDICTION_PUNE = 101;
  const JURISDICTION_NASHIK = 102;

  let oneYearFromNow;

  beforeEach(async function () {
    [admin, registrarPune, registrarNashik, seniorInspectorPune, fieldInspectorPune, unauthorized] =
      await ethers.getSigners();

    const InspectorRegistry = await ethers.getContractFactory("InspectorRegistry");
    inspectorRegistry = await InspectorRegistry.deploy(admin.address);
    await inspectorRegistry.waitForDeployment();

    const latestBlock = await ethers.provider.getBlock("latest");
    oneYearFromNow = latestBlock.timestamp + 365 * 24 * 60 * 60;
  });

  describe("System Admin (Level 0) Operations", function () {
    it("should set deployer as Level 0 System Admin with global jurisdiction", async function () {
      const ins = await inspectorRegistry.getInspector(admin.address);
      expect(ins.level).to.equal(0);
      expect(ins.jurisdictionId).to.equal(0);
      expect(ins.active).to.be.true;

      // Admin has universal authorization across all regions and levels
      expect(await inspectorRegistry.isAuthorized(admin.address, JURISDICTION_PUNE, 3)).to.be.true;
      expect(await inspectorRegistry.isAuthorized(admin.address, JURISDICTION_NASHIK, 1)).to.be.true;
    });

    it("should allow Admin to appoint a Regional Registrar (Level 1)", async function () {
      await expect(
        inspectorRegistry.addInspector(
          registrarPune.address,
          1, // Level 1: Registrar
          JURISDICTION_PUNE,
          oneYearFromNow
        )
      )
        .to.emit(inspectorRegistry, "InspectorAdded")
        .withArgs(registrarPune.address, 1, JURISDICTION_PUNE, oneYearFromNow, admin.address);

      const ins = await inspectorRegistry.getInspector(registrarPune.address);
      expect(ins.level).to.equal(1);
      expect(ins.jurisdictionId).to.equal(JURISDICTION_PUNE);
      expect(ins.active).to.be.true;
    });
  });

  describe("Regional Registrar (Level 1) Hierarchy & Jurisdiction Containment", function () {
    beforeEach(async function () {
      // Admin appoints Registrar for Pune
      await inspectorRegistry.addInspector(
        registrarPune.address,
        1,
        JURISDICTION_PUNE,
        oneYearFromNow
      );
    });

    it("should allow Registrar to appoint a Senior Inspector (Level 2) in their own jurisdiction", async function () {
      await expect(
        inspectorRegistry
          .connect(registrarPune)
          .addInspector(seniorInspectorPune.address, 2, JURISDICTION_PUNE, oneYearFromNow)
      )
        .to.emit(inspectorRegistry, "InspectorAdded")
        .withArgs(seniorInspectorPune.address, 2, JURISDICTION_PUNE, oneYearFromNow, registrarPune.address);

      expect(await inspectorRegistry.isAuthorized(seniorInspectorPune.address, JURISDICTION_PUNE, 2)).to.be.true;
    });

    it("should allow Registrar to appoint a Field Inspector (Level 3) in their own jurisdiction", async function () {
      await inspectorRegistry
        .connect(registrarPune)
        .addInspector(fieldInspectorPune.address, 3, JURISDICTION_PUNE, oneYearFromNow);

      expect(await inspectorRegistry.isAuthorized(fieldInspectorPune.address, JURISDICTION_PUNE, 3)).to.be.true;
    });

    it("should reject a Registrar attempting to appoint outside their jurisdiction", async function () {
      await expect(
        inspectorRegistry
          .connect(registrarPune)
          .addInspector(fieldInspectorPune.address, 3, JURISDICTION_NASHIK, oneYearFromNow)
      ).to.be.revertedWithCustomError(inspectorRegistry, "JurisdictionMismatch");
    });

    it("should reject a Registrar attempting to appoint at or above their own level (e.g. Level 1 or 0)", async function () {
      await expect(
        inspectorRegistry
          .connect(registrarPune)
          .addInspector(fieldInspectorPune.address, 1, JURISDICTION_PUNE, oneYearFromNow)
      ).to.be.revertedWithCustomError(inspectorRegistry, "UnauthorizedHierarchy");
    });
  });

  describe("Cross-Jurisdictional and Expired Authorization Checks (RQ1)", function () {
    beforeEach(async function () {
      await inspectorRegistry.addInspector(
        registrarPune.address,
        1,
        JURISDICTION_PUNE,
        oneYearFromNow
      );
      await inspectorRegistry
        .connect(registrarPune)
        .addInspector(fieldInspectorPune.address, 3, JURISDICTION_PUNE, oneYearFromNow);
    });

    it("should allow Pune Field Inspector to act in Pune for Level 3 tasks", async function () {
      expect(await inspectorRegistry.isAuthorized(fieldInspectorPune.address, JURISDICTION_PUNE, 3)).to.be.true;
    });

    it("should reject Pune Field Inspector acting in Nashik (Cross-Jurisdiction Rejection)", async function () {
      expect(await inspectorRegistry.isAuthorized(fieldInspectorPune.address, JURISDICTION_NASHIK, 3)).to.be.false;
    });

    it("should reject Pune Field Inspector attempting to approve Level 2 (Senior) operations", async function () {
      // Level 3 attempting a Level 2 requirement (ins.level <= minRequiredLevel fails because 3 <= 2 is false)
      expect(await inspectorRegistry.isAuthorized(fieldInspectorPune.address, JURISDICTION_PUNE, 2)).to.be.false;
    });

    it("should reject an expired inspector", async function () {
      const latestBlock = await ethers.provider.getBlock("latest");
      const shortExpiry = latestBlock.timestamp + 10;

      await inspectorRegistry
        .connect(registrarPune)
        .addInspector(seniorInspectorPune.address, 2, JURISDICTION_PUNE, shortExpiry);

      // Fast forward time by 20 seconds
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine");

      expect(await inspectorRegistry.isAuthorized(seniorInspectorPune.address, JURISDICTION_PUNE, 2)).to.be.false;
    });

    it("should reject a revoked inspector immediately", async function () {
      await inspectorRegistry.connect(registrarPune).revokeInspector(fieldInspectorPune.address);

      expect(await inspectorRegistry.isAuthorized(fieldInspectorPune.address, JURISDICTION_PUNE, 3)).to.be.false;
    });

    it("should reject an unregistered random wallet", async function () {
      expect(await inspectorRegistry.isAuthorized(unauthorized.address, JURISDICTION_PUNE, 3)).to.be.false;
    });
  });
});
