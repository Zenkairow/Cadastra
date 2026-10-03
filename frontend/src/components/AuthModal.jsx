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
  Building2,
  FileText,
  Copy,
  Check
} from 'lucide-react';
import { ethers } from 'ethers';
import { web3Service } from '../services/web3';
import { api } from '../services/api';

const DEMO_ACCOUNTS = [
  {
    role: 'ADMIN',
    name: 'Deployer Admin (Sepolia Wallet)',
    wallet: '0x9f4e1425010C383A1818d9daBf55f0Aa2FaF6811',
    detail: 'Sepolia contract deployer & root governance authority',
    tag: 'Sepolia Admin',
    tagColor: '#38bdf8',
    icon: Building2
  },
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
  const [step, setStep] = useState(1); // 1: Connect / Form, 2: Sign (MetaMask), 3: KYC, 4: Complete
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  
  // Registration form state
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [kycResult, setKycResult] = useState(null);
  const [generatedWallet, setGeneratedWallet] = useState(null);

  const hasMetaMask = web3Service.isMetaMaskAvailable();

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setError('');
      setLoading(false);
      setFullName('');
      setNationalId('');
      setKycResult(null);
      setGeneratedWallet(null);
      setShowRegisterForm(false);
      setCopiedKey(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Web3 MetaMask Connect Flow
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
      const nonceData = await api.getNonce(wallet);
      const nonce = nonceData.nonce;

      const domain = window.location.host || 'localhost:3000';
      const siweMessage = `${domain} wants you to sign in with your Ethereum account:\n${wallet}\n\nURI: http://${domain}\nVersion: 1\nChain ID: ${web3Service.chainId || 11155111}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;

      const signature = await web3Service.signMessage(siweMessage);
      const authResponse = await api.verifySignature(siweMessage, signature);
      
      if (authResponse.user && authResponse.user.kyc_status === 'VERIFIED') {
        onAuthSuccess(authResponse.user, wallet);
        onClose();
      } else {
        setStep(3); // First-time user, prompt KYC onboarding
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

  // Normal Web2-Style Citizen Registration (Auto-generates secure wallet)
  const handleAutoRegister = async (e) => {
    e.preventDefault();
    if (!fullName || !nationalId) {
      setError('Please provide your legal name and national ID.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      // 1. Generate a secure, dedicated Ethereum wallet keypair for the citizen
      const newWallet = ethers.Wallet.createRandom();
      setGeneratedWallet(newWallet);
      const assignedAddress = newWallet.address.toLowerCase();
      setWallet(assignedAddress);

      // 2. Perform Zero-PII KYC Verification
      const kycRes = await api.verifyKYC(nationalId, fullName);
      setKycResult(kycRes);

      // 3. Register user profile and bind generated wallet in database
      const loginRes = await api.demoLogin(assignedAddress, 'CITIZEN');

      // 4. Move to confirmation & credential display
      setStep(4);
    } catch (err) {
      setError(err.message || 'Citizen registration failed.');
    } finally {
      setLoading(false);
    }
  };

  // KYC Onboarding for MetaMask connected users
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

  const handleCopyPrivateKey = () => {
    if (generatedWallet) {
      navigator.clipboard.writeText(generatedWallet.privateKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
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
            Self-Sovereign Identity & Zero-PII Land Registry Governance
          </p>
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

        {/* Step 1: Login Options & Normal Citizen Registration */}
        {step === 1 && (
          <div>
            {/* MetaMask Option */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '14px',
              padding: '16px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Wallet size={16} color="var(--accent-emerald)" /> Connect Web3 Wallet
                </span>
                <span className="badge" style={{ fontSize: '0.7rem', background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc' }}>
                  Sepolia Live
                </span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '12px', lineHeight: 1.4 }}>
                Connect your browser's MetaMask extension to sign the cryptographic challenge.
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

            {/* Normal Citizen Registration (No wallet required upfront) */}
            <div style={{ marginBottom: '18px' }}>
              {!showRegisterForm ? (
                <div style={{
                  background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.08), rgba(16, 185, 129, 0.08))',
                  border: '1px dashed rgba(6, 182, 212, 0.3)',
                  borderRadius: '14px',
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}>
                  <div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#f8fafc', marginBottom: '2px' }}>
                      New Citizen? Register with Simple Form
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      No crypto wallet needed. Fill name & ID, and we create your secure wallet automatically.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-cyan"
                    style={{ padding: '8px 14px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                    onClick={() => setShowRegisterForm(true)}
                  >
                    <UserPlus size={14} /> Register Here
                  </button>
                </div>
              ) : (
                <form 
                  onSubmit={handleAutoRegister} 
                  style={{
                    background: 'rgba(6, 182, 212, 0.06)',
                    border: '1px solid rgba(6, 182, 212, 0.3)',
                    borderRadius: '14px',
                    padding: '16px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <UserPlus size={16} color="var(--accent-cyan)" /> Citizen Registration (Auto-Wallet)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowRegisterForm(false)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.78rem', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                    Simply enter your details. We will automatically generate your secure cadastral wallet and bind your Zero-PII identity.
                  </p>

                  <div className="form-group" style={{ marginBottom: '10px' }}>
                    <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>Full Legal Name</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Ramesh Kumar"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: '14px' }}>
                    <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>National Identity Number (Aadhaar / ID)</label>
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
                    className="btn btn-cyan"
                    style={{ width: '100%', padding: '10px 14px', fontSize: '0.88rem' }}
                    disabled={loading}
                  >
                    {loading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                    Create Account & Auto-Generate Wallet
                  </button>
                </form>
              )}
            </div>

            {/* Quick Demo Profiles */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <Sparkles size={15} color="#38bdf8" />
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Quick Sign-In (Pre-Configured Roles)
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
          </div>
        )}

        {/* Step 2: Sign In with Ethereum (MetaMask Flow) */}
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

        {/* Step 3: KYC Verification (For first-time MetaMask users) */}
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

        {/* Step 4: Verification Success & Credentials */}
        {step === 4 && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <CheckCircle2 size={48} color="var(--accent-emerald)" style={{ margin: '0 auto 10px' }} />
            <h3 style={{ fontSize: '1.25rem', marginBottom: '4px' }}>Citizen Identity Registered!</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Zero-PII identity commitment created and anchored on Ethereum Sepolia.
            </p>

            <div style={{
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              padding: '14px',
              textAlign: 'left',
              marginBottom: '16px'
            }}>
              <div style={{ marginBottom: '10px' }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Cryptographic Identity Commitment:</span>
                <div className="mono" style={{ fontSize: '0.78rem', color: 'var(--accent-emerald)', wordBreak: 'break-all', marginTop: '2px' }}>
                  {kycResult?.identity_id}
                </div>
              </div>
              <div style={{ marginBottom: generatedWallet ? '10px' : '0' }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Bound Cadastral Wallet Address:</span>
                <div className="mono" style={{ fontSize: '0.78rem', color: '#f8fafc', wordBreak: 'break-all', marginTop: '2px' }}>
                  {wallet}
                </div>
              </div>
              {generatedWallet && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span style={{ fontSize: '0.74rem', color: '#fbbf24' }}>Generated Private Key (Deed Control Key):</span>
                    <button
                      type="button"
                      onClick={handleCopyPrivateKey}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: copiedKey ? 'var(--accent-emerald)' : '#a5b4fc',
                        fontSize: '0.72rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      {copiedKey ? <Check size={12} /> : <Copy size={12} />}
                      {copiedKey ? 'Copied!' : 'Copy Key'}
                    </button>
                  </div>
                  <div className="mono" style={{
                    fontSize: '0.72rem',
                    color: '#fef08a',
                    wordBreak: 'break-all',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.25)',
                    padding: '6px 8px',
                    borderRadius: '6px'
                  }}>
                    {generatedWallet.privateKey}
                  </div>
                </div>
              )}
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px', fontSize: '0.9rem' }}
              onClick={() => {
                onAuthSuccess({
                  identity_id: kycResult?.identity_id,
                  active_wallet: wallet,
                  role: 'CITIZEN',
                  kyc_status: 'VERIFIED'
                }, wallet);
                onClose();
              }}
            >
              Enter Citizen Portal &rarr;
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
