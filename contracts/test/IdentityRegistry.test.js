const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("IdentityRegistry Contract", function () {
  let identityRegistry;
  let admin, user1, user2, user3, nonAdmin;

  const identity1 = ethers.keccak256(ethers.toUtf8Bytes("USER_UUID_1"));
  const identity2 = ethers.keccak256(ethers.toUtf8Bytes("USER_UUID_2"));

  beforeEach(async function () {
    [admin, user1, user2, user3, nonAdmin] = await ethers.getSigners();

    const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
    identityRegistry = await IdentityRegistry.deploy(admin.address);
    await identityRegistry.waitForDeployment();
  });

  describe("Deployment & Role Initialization", function () {
    it("should assign DEFAULT_ADMIN_ROLE and KYC_ADMIN_ROLE to the deployer", async function () {
      const DEFAULT_ADMIN_ROLE = await identityRegistry.DEFAULT_ADMIN_ROLE();
      const KYC_ADMIN_ROLE = await identityRegistry.KYC_ADMIN_ROLE();

      expect(await identityRegistry.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await identityRegistry.hasRole(KYC_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("should revert if initialized with zero address", async function () {
      const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
      await expect(IdentityRegistry.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        identityRegistry,
        "ZeroAddress"
      );
    });
  });

  describe("Identity Binding (1 Identity <-> 1 Active Wallet)", function () {
    it("should successfully bind a verified identity to an active wallet", async function () {
      await expect(identityRegistry.verifyAndBindIdentity(identity1, user1.address))
        .to.emit(identityRegistry, "IdentityBound")
        .withArgs(identity1, user1.address, (val) => val > 0);

      expect(await identityRegistry.isWalletActive(user1.address)).to.be.true;
      expect(await identityRegistry.getIdentityByWallet(user1.address)).to.equal(identity1);
      expect(await identityRegistry.getActiveWalletByIdentity(identity1)).to.equal(user1.address);
    });

    it("should reject binding the same wallet to multiple identities", async function () {
      await identityRegistry.verifyAndBindIdentity(identity1, user1.address);

      await expect(
        identityRegistry.verifyAndBindIdentity(identity2, user1.address)
      ).to.be.revertedWithCustomError(identityRegistry, "WalletAlreadyBound");
    });

    it("should reject binding the same identity to multiple wallets", async function () {
      await identityRegistry.verifyAndBindIdentity(identity1, user1.address);

      await expect(
        identityRegistry.verifyAndBindIdentity(identity1, user2.address)
      ).to.be.revertedWithCustomError(identityRegistry, "IdentityAlreadyBound");
    });

    it("should revert if a non-KYC admin tries to bind an identity", async function () {
      await expect(
        identityRegistry.connect(nonAdmin).verifyAndBindIdentity(identity1, user1.address)
      ).to.be.revertedWithCustomError(identityRegistry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Wallet Loss and Recovery Flow", function () {
    beforeEach(async function () {
      await identityRegistry.verifyAndBindIdentity(identity1, user1.address);
    });

    it("should successfully recover an identity to a new wallet and revoke the old one", async function () {
      await expect(identityRegistry.recoverWallet(identity1, user1.address, user2.address))
        .to.emit(identityRegistry, "WalletRecovered")
        .withArgs(identity1, user1.address, user2.address, (val) => val > 0);

      // Old wallet is now inactive
      expect(await identityRegistry.isWalletActive(user1.address)).to.be.false;

      // New wallet is now active
      expect(await identityRegistry.isWalletActive(user2.address)).to.be.true;
      expect(await identityRegistry.getIdentityByWallet(user2.address)).to.equal(identity1);
      expect(await identityRegistry.getActiveWalletByIdentity(identity1)).to.equal(user2.address);
    });

    it("should reject recovery if new wallet is already bound to another identity", async function () {
      await identityRegistry.verifyAndBindIdentity(identity2, user2.address);

      await expect(
        identityRegistry.recoverWallet(identity1, user1.address, user2.address)
      ).to.be.revertedWithCustomError(identityRegistry, "WalletAlreadyBound");
    });

    it("should reject recovery if old wallet does not match the registered active wallet", async function () {
      await expect(
        identityRegistry.recoverWallet(identity1, user3.address, user2.address)
      ).to.be.revertedWithCustomError(identityRegistry, "WalletMismatch");
    });
  });

  describe("Wallet Revocation", function () {
    beforeEach(async function () {
      await identityRegistry.verifyAndBindIdentity(identity1, user1.address);
    });

    it("should revoke an active wallet successfully", async function () {
      await expect(identityRegistry.revokeWallet(identity1, user1.address))
        .to.emit(identityRegistry, "WalletRevoked")
        .withArgs(identity1, user1.address, (val) => val > 0);

      expect(await identityRegistry.isWalletActive(user1.address)).to.be.false;
      expect(await identityRegistry.getActiveWalletByIdentity(identity1)).to.equal(ethers.ZeroAddress);
    });

    it("should reject revoking an already revoked wallet", async function () {
      await identityRegistry.revokeWallet(identity1, user1.address);

      await expect(
        identityRegistry.revokeWallet(identity1, user1.address)
      ).to.be.revertedWithCustomError(identityRegistry, "WalletNotActive");
    });
  });
});
