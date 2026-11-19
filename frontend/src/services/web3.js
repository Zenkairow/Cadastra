/**
 * Web3 Provider & Smart Contract Service
 * Handles MetaMask / EIP-1193 connections, Sepolia chain switching, custom error decoding, and contract instances.
 */

import { ethers } from 'ethers';
import IdentityRegistryAbi from '../contracts/IdentityRegistry.json';
import InspectorRegistryAbi from '../contracts/InspectorRegistry.json';
import LandRegistryAbi from '../contracts/LandRegistry.json';
import TransferEscrowAbi from '../contracts/TransferEscrow.json';

export const SEPOLIA_CHAIN_ID = 11155111;
export const LOCAL_CHAIN_ID = 31337;

// Default contract addresses (configured for live Ethereum Sepolia)
export const CONTRACT_ADDRESSES = {
  IdentityRegistry: import.meta.env.VITE_IDENTITY_REGISTRY_ADDRESS || '0xE720C035317c132870ad971041Cf1c7f7530f988',
  InspectorRegistry: import.meta.env.VITE_INSPECTOR_REGISTRY_ADDRESS || '0x5E7dBcc2D6a83D267739a9B13711850A49e3Bf2a',
  LandRegistry: import.meta.env.VITE_LAND_REGISTRY_ADDRESS || '0x16580F1D8eb4Dd4eA3aa377C08FA0a7AE79Cd8B0',
  TransferEscrow: import.meta.env.VITE_TRANSFER_ESCROW_ADDRESS || '0x0A09A5c1b418888AA5fa2edcB58d998380f98E52',
};

export const SEPOLIA_NETWORK_PARAMS = {
  chainId: '0xaa36a7', // 11155111 in hex
  chainName: 'Ethereum Sepolia Testnet',
  nativeCurrency: {
    name: 'Sepolia Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org'],
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
};

// Error interfaces for decoding custom Solidity errors
const CONTRACT_INTERFACES = [
  new ethers.Interface(TransferEscrowAbi),
  new ethers.Interface(LandRegistryAbi),
  new ethers.Interface(IdentityRegistryAbi),
  new ethers.Interface(InspectorRegistryAbi),
];

const ERROR_DESCRIPTIONS = {
  NotBuyer: 'The calling wallet is not the verified buyer bound to this parcel escrow.',
  NotSeller: 'The calling wallet is not the verified seller for this parcel.',
  RequestNotFound: 'The escrow request ID was not found on-chain.',
  InvalidState: 'The escrow or land title is not in the required state for this operation.',
  IncorrectFundingAmount: 'The deposited ETH does not match the exact agreed purchase price.',
  UnauthorizedInspector: 'Your wallet does not have authorized inspector clearance for this jurisdiction.',
  InspectorAlreadyApproved: 'This inspector has already submitted approval for this escrow request.',
  SeniorApprovalRequired: 'High-value transfers (≥ 5.0 ETH) strictly require Senior Inspector clearance before settlement.',
  TransferNotExpired: 'The escrow period has not yet expired; funds cannot be refunded prematurely.',
  TransferAlreadyExpired: 'The escrow validity period has expired.',
  SellerOwnershipChanged: 'The registered landowner changed after escrow initiation.',
  NoPendingWithdrawal: 'No claimable pull-payment balance is currently available for withdrawal.',
  WithdrawalFailed: 'The pull-payment ETH transfer could not be completed.',
  DuplicateParcelKey: 'A cadastral land title with this parcel key is already registered on-chain.',
  OwnerNotVerified: 'The applicant identity is not verified in the Identity Registry.',
  LandNotFound: 'The specified land ID was not found in the Land Registry.',
  LandAlreadyLocked: 'This parcel is already locked under an active transfer escrow.',
  LandNotLocked: 'This parcel is not currently locked for transfer.',
  ZeroBytes32: 'A required cryptographic hash commitment was empty (zero bytes32).',
  ZeroAmount: 'The agreed price or deposit amount cannot be zero.',
  ZeroAddress: 'An invalid zero address was provided.',
  IdentityAlreadyBound: 'This digital identity is already bound to an active wallet.',
  IdentityNotFound: 'The specified identity ID does not exist in the decentralized registry.',
  WalletAlreadyBound: 'This wallet address is already bound to another registered identity.',
  WalletNotActive: 'This wallet is not currently marked active in the Identity Registry.',
  InspectorAlreadyExists: 'An inspector record already exists for this wallet address.',
  InspectorNotFound: 'No inspector record found for this wallet address.',
  InspectorNotActive: 'This inspector appointment is inactive or expired.',
  InvalidJurisdiction: 'The specified jurisdiction ID is invalid or unregistered.',
  InvalidLevel: 'The inspector hierarchy level is invalid.',
  JurisdictionMismatch: 'The inspector jurisdiction does not match the parcel jurisdiction.',
  UnauthorizedHierarchy: 'Your inspector clearance level is insufficient for this governance action.',
};

class Web3Service {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.account = null;
    this.chainId = SEPOLIA_CHAIN_ID;
    this.CONTRACT_ADDRESSES = CONTRACT_ADDRESSES;

    // Public read-only provider for reading verified contract state without MetaMask
    try {
      this.readProvider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
    } catch {
      this.readProvider = null;
    }
  }

  isMetaMaskAvailable() {
    return typeof window !== 'undefined' && Boolean(window.ethereum);
  }

  /**
   * Determine whether an operation should execute via simulated Persona Mode.
   * True if:
   * 1. No signer is available, OR
   * 2. User is logged in as a Persona whose active_wallet differs from MetaMask's account.
   */
  isPersonaMode(user) {
    if (!this.signer || !this.account) return true;
    if (user && user.active_wallet && user.active_wallet.toLowerCase() !== this.account.toLowerCase()) {
      return true;
    }
    return false;
  }

  async connectWallet() {
    if (!this.isMetaMaskAvailable()) {
      throw new Error('MetaMask is not installed. Please install MetaMask to use Web3 features.');
    }

    this.provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await this.provider.send('eth_requestAccounts', []);
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts selected in wallet.');
    }

    this.signer = await this.provider.getSigner();
    this.account = accounts[0].toLowerCase();

    const network = await this.provider.getNetwork();
    this.chainId = Number(network.chainId);

    return {
      account: this.account,
      chainId: this.chainId,
      provider: this.provider,
      signer: this.signer,
    };
  }

  async ensureSepoliaNetwork() {
    if (!this.isMetaMaskAvailable()) return false;

    const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
    const currentNum = parseInt(currentChainId, 16);

    // Accept Sepolia (11155111) or Local Hardhat (31337)
    if (currentNum === SEPOLIA_CHAIN_ID || currentNum === LOCAL_CHAIN_ID) {
      return true;
    }

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_NETWORK_PARAMS.chainId }],
      });
      return true;
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [SEPOLIA_NETWORK_PARAMS],
          });
          return true;
        } catch {
          throw new Error('Failed to add Ethereum Sepolia network to MetaMask.');
        }
      }
      throw switchError;
    }
  }

  async signMessage(message) {
    if (!this.signer) {
      await this.connectWallet();
    }
    return await this.signer.signMessage(message);
  }

  /**
   * Parse EVM reverts, custom errors, and RPC exceptions into human-readable messages.
   */
  parseContractError(err, defaultAction = 'Transaction') {
    if (!err) return { title: `${defaultAction} Failed`, message: 'An unknown error occurred.' };

    // 1. User rejected in MetaMask
    if (err.code === 4001 || err.code === 'ACTION_REJECTED' || String(err.message).includes('user rejected')) {
      return {
        title: 'Transaction Cancelled',
        message: 'The transaction was rejected in your MetaMask wallet.',
        isUserRejection: true,
      };
    }

    // 2. Insufficient funds for gas or value
    if (err.code === 'INSUFFICIENT_FUNDS' || String(err.message).toLowerCase().includes('insufficient funds')) {
      return {
        title: 'Insufficient Balance',
        message: 'Your wallet has insufficient Sepolia ETH to cover transaction gas and value.',
      };
    }

    // 3. Extract revert hex data from various ethers / RPC formats
    let rawData = err.data || err.error?.data || err.info?.error?.data || null;
    if (!rawData && typeof err.message === 'string') {
      const match = err.message.match(/data="(0x[0-9a-fA-F]+)"/);
      if (match) rawData = match[1];
    }

    if (rawData && typeof rawData === 'string' && rawData.startsWith('0x') && rawData.length >= 10) {
      for (const iface of CONTRACT_INTERFACES) {
        try {
          const parsed = iface.parseError(rawData);
          if (parsed && parsed.name) {
            const explanation = ERROR_DESCRIPTIONS[parsed.name] || `Smart contract execution reverted with ${parsed.name}.`;
            return {
              title: `${parsed.name} Revert`,
              message: explanation,
              errorName: parsed.name,
              args: parsed.args,
            };
          }
        } catch {
          // Continue testing other contract interfaces
        }
      }
    }

    // 4. Return formatted reason or message
    const msg = err.reason || err.shortMessage || err.message || 'Smart contract execution reverted.';
    return {
      title: `${defaultAction} Failed`,
      message: msg.length > 250 ? msg.substring(0, 247) + '...' : msg,
    };
  }

  // --- Smart Contract Helpers ---
  getContract(name, abi, addressOverride = null) {
    const address = addressOverride || CONTRACT_ADDRESSES[name];
    if (!address) {
      throw new Error(`Address for contract '${name}' is not configured.`);
    }
    const runner = this.signer || this.provider || this.readProvider;
    return new ethers.Contract(address, abi, runner);
  }

  getLandRegistry(address = null) {
    return this.getContract('LandRegistry', LandRegistryAbi, address);
  }

  getTransferEscrow(address = null) {
    return this.getContract('TransferEscrow', TransferEscrowAbi, address);
  }

  getIdentityRegistry(address = null) {
    return this.getContract('IdentityRegistry', IdentityRegistryAbi, address);
  }

  getInspectorRegistry(address = null) {
    return this.getContract('InspectorRegistry', InspectorRegistryAbi, address);
  }
}

export const web3Service = new Web3Service();
