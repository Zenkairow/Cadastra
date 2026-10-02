/**
 * Web3 Provider & Smart Contract Service
 * Handles MetaMask / EIP-1193 connections, Sepolia chain switching, and contract instances.
 */

import { ethers } from 'ethers';
import IdentityRegistryAbi from '../contracts/IdentityRegistry.json';
import InspectorRegistryAbi from '../contracts/InspectorRegistry.json';
import LandRegistryAbi from '../contracts/LandRegistry.json';
import TransferEscrowAbi from '../contracts/TransferEscrow.json';

export const SEPOLIA_CHAIN_ID = 11155111;
export const LOCAL_CHAIN_ID = 31337;

// Default contract addresses (configurable via environment variables)
export const CONTRACT_ADDRESSES = {
  IdentityRegistry: import.meta.env.VITE_IDENTITY_REGISTRY_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  InspectorRegistry: import.meta.env.VITE_INSPECTOR_REGISTRY_ADDRESS || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  LandRegistry: import.meta.env.VITE_LAND_REGISTRY_ADDRESS || '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  TransferEscrow: import.meta.env.VITE_TRANSFER_ESCROW_ADDRESS || '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
};

export const SEPOLIA_NETWORK_PARAMS = {
  chainId: '0xaa36a7', // 11155111 in hex
  chainName: 'Ethereum Sepolia Testnet',
  nativeCurrency: {
    name: 'Sepolia Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['https://rpc.sepolia.org', 'https://ethereum-sepolia-rpc.publicnode.com'],
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
};

class Web3Service {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.account = null;
    this.chainId = null;
  }

  isMetaMaskAvailable() {
    return typeof window !== 'undefined' && Boolean(window.ethereum);
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
      // 4902 error code indicates the chain has not been added to MetaMask
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [SEPOLIA_NETWORK_PARAMS],
          });
          return true;
        } catch (addError) {
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

  // --- Smart Contract Helpers ---
  getContract(name, abi, addressOverride = null) {
    const address = addressOverride || CONTRACT_ADDRESSES[name];
    if (!address) {
      throw new Error(`Address for contract '${name}' is not configured.`);
    }
    const runner = this.signer || this.provider;
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
