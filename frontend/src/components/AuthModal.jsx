import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Wallet, 
  Key, 
  UserCheck, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  X,
  Sparkles,
  ArrowRight,
  UserPlus,
  RefreshCw,
  Building2,
  FileText
} from 'lucide-react';
import { ethers } from 'ethers';
import { web3Service } from '../services/web3';
import { api } from '../services/api';

const DEMO_ACCOUNTS = [
  {
    role: 'CITIZEN',
    name: 'Alice (Landowner / Citizen)',
    wallet: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    detail: 'Verified owner of Plot 42 Pune Metropolitan (Survey 42/1A)',
    tag: 'Owner',
    tagColor: 'var(--accent-emerald)',
    icon: FileText
  },
  {
    role: 'CITIZEN',
    name: 'Bob (Prospective Buyer)',
    wallet: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4df',
    detail: 'Verified citizen with buyer escrow capability',
    tag: 'Buyer',
    tagColor: 'var(--accent-cyan)',
    icon: UserCheck
  },
  {
    role: 'INSPECTOR',
    name: 'Field Inspector (Pune)',
    wallet: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    detail: 'Tier-1 Cadastral boundary & on-site spatial survey verifier',
    tag: 'Field Inspector',
    tagColor: '#f59e0b',
    icon: ShieldCheck
  },
  {
    role: 'SENIOR_INSPECTOR',
    name: 'Senior Inspector (Pune)',
    wallet: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    detail: 'Tier-2 Legal encumbrance & cross-boundary approval officer',
    tag: 'Senior Inspector',
    tagColor: '#a855f7',
    icon: ShieldCheck
  },
  {
    role: 'ADMIN',
    name: 'System Administrator',
    wallet: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    detail: 'Superintendent of Registries & executive governance',
    tag: 'Admin',
    tagColor: '#ec4899',
    icon: Building2
  }
];

export default function AuthModal({ isOpen, onClose, onAuthSuccess }) {
  const [step, setStep] = useState(1); // 1: Connect, 2: Sign, 3: KYC (if new), 4: Complete
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Custom wallet registration state
  const [showCustomRegister, setShowCustomRegister] = useState(false);
  const [customWalletAddress, setCustomWalletAddress] = useState('');

  // KYC Form State
  const [fullName, setFullName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [kycResult, setKycResult] = useState(null);

  const hasMetaMask = web3Service.isMetaMaskAvailable();

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setError('');
      setLoading(false);
      setFullName('');
      setNationalId('');
      setKycResult(null);
      setShowCustomRegister(false);
      setCustomWalletAddress('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConnectWallet = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await web3Service.connectWallet();
      setWallet(res.account);
      try {
        await web3Service.ensureSepoliaNetwork();
      } catch (chainErr) {
        console.warn('Network switch notification:', chainErr.message);
      }
      setStep(2); // Move to signing step
    } catch (err) {
      setError(err.message || 'Failed to connect MetaMask wallet.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignChallenge = async () => {
    setLoading(true);
    setError('');
    try {
      // 1. Fetch challenge nonce from backend
      const nonceData = await api.getNonce(wallet);
      const nonce = nonceData.nonce;

      // 2. Build EIP-4361 SIWE formatted challenge
      const domain = window.location.host || 'localhost:3000';
      const siweMessage = `${domain} wants you to sign in with your Ethereum account:\n${wallet}\n\nURI: http://${domain}\nVersion: 1\nChain ID: ${web3Service.chainId || 11155111}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;

      // 3. Request signature from MetaMask
      const signature = await web3Service.signMessage(siweMessage);

      // 4. Verify signature on backend
      const authResponse = await api.verifySignature(siweMessage, signature);
      
      // If user already has verified KYC and identity, finish!
      if (authResponse.user && authResponse.user.kyc_status === 'VERIFIED') {
        onAuthSuccess(authResponse.user, wallet);
        onClose();
      } else {
        // If first-time user, prompt KYC onboarding
        setStep(3);
      }
    } catch (err) {
      setError(err.message || 'Signature verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoLogin = async (account) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.demoLogin(account.wallet, account.role);
      onAuthSuccess(res.user, account.wallet);
      onClose();
    } catch (err) {
      setError(err.message || 'Quick demo login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleCustomRegisterPrompt = () => {
    if (!customWalletAddress || !customWalletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      setError('Please provide a valid 42-character Ethereum address (0x...)');
      return;
    }
    setWallet(customWalletAddress.toLowerCase());
    setStep(3); // Go straight to KYC
  };

  const handleGenerateRandomWallet = () => {
    try {
      const randomWallet = ethers.Wallet.createRandom();
      setCustomWalletAddress(randomWallet.address);
      setError('');
    } catch (e) {
      // Fallback pseudo-random wallet
      const randHex = '0x' + Array.from({length: 40}, () => Math.floor(Math.random() * 16).toString(16)).join('');
      setCustomWalletAddress(randHex);
    }
  };

  const handleKYCOnboarding = async (e) => {
    e.preventDefault();
    if (!fullName || !nationalId) {
      setError('Please provide your full legal name and national ID.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const kycRes = await api.verifyKYC(nationalId, fullName);
      setKycResult(kycRes);
      
      // Complete user registration in backend
      const loginRes = await api.demoLogin(wallet, 'CITIZEN');
      
      onAuthSuccess(loginRes.user, wallet);
      setStep(4);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.message || 'KYC verification failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(2, 6, 23, 0.82)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '16px'
    }}>
      <div className="modal-content" style={{
        position: 'relative',
        background: '#0d1527',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '20px',
        padding: '28px',
        maxWidth: '560px',
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)'
      }}>
        <button 
          onClick={onClose}
          style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
        >
          <X size={20} />
        </button>

        {/* Modal Header */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(99, 102, 241, 0.2))',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px'
          }}>
            <ShieldCheck size={26} color="var(--accent-emerald)" />
          </div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '4px' }}>Cadastra Authentication</h2>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0 }}>
            EIP-4361 Sign-In with Ethereum & Zero-PII Identity Governance
          </p>
        </div>

        {/* Stepper Indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
          {[1, 2, 3].map((num) => (
            <div key={num} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.78rem',
                fontWeight: 600,
                background: step === num ? 'var(--accent-emerald)' : step > num ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                color: step >= num ? '#ffffff' : 'var(--text-muted)',
                border: step === num ? '2px solid rgba(255, 255, 255, 0.4)' : 'none'
              }}>
                {step > num ? <CheckCircle2 size={15} color="var(--accent-emerald)" /> : num}
              </div>
              {num < 3 && <div style={{ width: '24px', height: '2px', background: step > num ? 'var(--accent-emerald)' : 'var(--border-subtle)' }}></div>}
            </div>
          ))}
        </div>

        {error && (
          <div style={{
            background: 'rgba(244, 63, 94, 0.15)',
            border: '1px solid rgba(244, 63, 94, 0.3)',
            borderRadius: '10px',
            padding: '10px 14px',
            color: '#fda4af',
            fontSize: '0.84rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '16px'
          }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Step 1: Connect Wallet / Choose Profile */}
        {step === 1 && (
          <div>
            {/* MetaMask Option */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '14px',
              padding: '16px',
              marginBottom: '18px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Wallet size={16} color="var(--accent-emerald)" /> Connect Web3 Wallet
                </span>
                <span className="badge" style={{ fontSize: '0.7rem', background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc' }}>
                  Sepolia / Local
                </span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '12px', lineHeight: 1.4 }}>
                Connect your browser's MetaMask extension to sign the cryptographic EIP-4361 challenge.
              </p>
              <button 
                className="btn btn-primary" 
                style={{ width: '100%', padding: '10px 14px', fontSize: '0.88rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }} 
                onClick={handleConnectWallet}
                disabled={loading}
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />}
                {hasMetaMask ? 'Connect MetaMask' : 'Connect Browser Wallet'}
              </button>
            </div>

            {/* Quick Demo Profiles */}
            <div style={{ marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <Sparkles size={15} color="#38bdf8" />
                <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Quick Demo Profiles (Instant Sign-in)
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {DEMO_ACCOUNTS.map((acc, idx) => {
                  const Icon = acc.icon;
                  return (
                    <button
                      key={idx}
                      onClick={() => handleQuickDemoLogin(acc)}
                      disabled={loading}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s ease',
                        color: 'inherit'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          background: `${acc.tagColor}15`,
                          border: `1px solid ${acc.tagColor}40`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          <Icon size={16} color={acc.tagColor} />
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#f8fafc' }}>
                              {acc.name}
                            </span>
                            <span className="badge" style={{ fontSize: '0.65rem', padding: '1px 6px', background: `${acc.tagColor}20`, color: acc.tagColor }}>
                              {acc.tag}
                            </span>
                          </div>
                          <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {acc.wallet.substring(0, 8)}...{acc.wallet.substring(acc.wallet.length - 6)}
                          </span>
                        </div>
                      </div>
                      <ArrowRight size={16} color="var(--text-muted)" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Wallet Registration Toggle */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
              {!showCustomRegister ? (
                <button
                  type="button"
                  onClick={() => setShowCustomRegister(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-cyan)',
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    margin: '0 auto',
                    padding: '4px 8px'
                  }}
                >
                  <UserPlus size={14} /> Register New Citizen Wallet
                </button>
              ) : (
                <div style={{ background: 'rgba(6, 182, 212, 0.05)', border: '1px solid rgba(6, 182, 212, 0.2)', borderRadius: '12px', padding: '14px' }}>
                  <label className="form-label" style={{ fontSize: '0.82rem', marginBottom: '6px' }}>
                    Citizen Ethereum Address
                  </label>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <input
                      type="text"
                      className="form-input mono"
                      style={{ fontSize: '0.82rem', padding: '8px 10px' }}
                      placeholder="0x..."
                      value={customWalletAddress}
                      onChange={(e) => setCustomWalletAddress(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ padding: '8px 12px' }}
                      title="Generate Test Address"
                      onClick={handleGenerateRandomWallet}
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn btn-cyan"
                    style={{ width: '100%', padding: '9px 12px', fontSize: '0.85rem' }}
                    onClick={handleCustomRegisterPrompt}
                  >
                    Proceed to Citizen KYC &rarr;
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Sign In with Ethereum */}
        {step === 2 && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '14px' }}>
              Connected Wallet: <span className="mono" style={{ color: 'var(--accent-emerald)' }}>{wallet}</span>
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '20px' }}>
              Sign a one-time cryptographic challenge proving ownership of this wallet. This action does not cost any gas.
            </p>
            <button 
              className="btn btn-indigo" 
              style={{ width: '100%', padding: '12px' }} 
              onClick={handleSignChallenge}
              disabled={loading}
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Key size={18} />}
              Sign Login Challenge
            </button>
          </div>
        )}

        {/* Step 3: KYC Verification */}
        {step === 3 && (
          <form onSubmit={handleKYCOnboarding} style={{ padding: '8px 0' }}>
            <div style={{
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              borderRadius: '10px',
              padding: '12px 16px',
              marginBottom: '16px',
              fontSize: '0.85rem',
              color: '#c7d2fe'
            }}>
              <strong>Zero-PII Privacy Protection:</strong> Your National ID is validated through our mock KYC adapter. Only an opaque, platform-generated <code>identityId</code> is anchored on-chain.
            </div>

            <div style={{ marginBottom: '14px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Binding Wallet: <span className="mono" style={{ color: 'var(--accent-emerald)' }}>{wallet}</span>
            </div>

            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label className="form-label" style={{ fontSize: '0.85rem', marginBottom: '6px' }}>Full Legal Name</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="e.g. Ramesh Kumar"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>

            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label" style={{ fontSize: '0.85rem', marginBottom: '6px' }}>National Identity Number (Aadhaar / National ID)</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="e.g. 5432-8976-1234"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                required
              />
            </div>

            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ width: '100%', padding: '12px' }}
              disabled={loading}
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <UserCheck size={18} />}
              Complete KYC & Bind Wallet
            </button>
          </form>
        )}

        {/* Step 4: Verification Success */}
        {step === 4 && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <CheckCircle2 size={48} color="var(--accent-emerald)" style={{ margin: '0 auto 12px' }} />
            <h3 style={{ fontSize: '1.25rem', marginBottom: '8px' }}>Identity Successfully Verified!</h3>
            <p className="mono" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Identity ID: {kycResult?.identity_id}
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
