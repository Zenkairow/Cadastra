import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Wallet, 
  Key, 
  UserCheck, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  X 
} from 'lucide-react';
import { web3Service } from '../services/web3';
import { api } from '../services/api';

export default function AuthModal({ isOpen, onClose, onAuthSuccess }) {
  const [step, setStep] = useState(1); // 1: Connect, 2: Sign, 3: KYC (if new), 4: Complete
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // KYC Form State
  const [fullName, setFullName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [kycResult, setKycResult] = useState(null);

  if (!isOpen) return null;

  const handleConnectWallet = async () => {
    setLoading(true);
    setError('');
    try {
      await web3Service.ensureSepoliaNetwork();
      const res = await web3Service.connectWallet();
      setWallet(res.account);
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
      
      // User is verified!
      const user = {
        identity_id: kycRes.identity_id,
        active_wallet: wallet,
        role: 'CITIZEN',
        kyc_status: 'VERIFIED',
      };
      
      onAuthSuccess(user, wallet);
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
    <div className="modal-overlay">
      <div className="modal-content" style={{ position: 'relative' }}>
        <button 
          onClick={onClose}
          style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
        >
          <X size={20} />
        </button>

        {/* Modal Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(99, 102, 241, 0.2))',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 14px'
          }}>
            <ShieldCheck size={28} color="var(--accent-emerald)" />
          </div>
          <h2 style={{ fontSize: '1.4rem', marginBottom: '6px' }}>Web3 Citizen Onboarding</h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            EIP-4361 Sign-In with Ethereum & Zero-PII Identity Binding
          </p>
        </div>

        {/* Stepper Indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          {[1, 2, 3].map((num) => (
            <div key={num} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
                fontWeight: 600,
                background: step === num ? 'var(--accent-emerald)' : step > num ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                color: step >= num ? '#ffffff' : 'var(--text-muted)',
                border: step === num ? '2px solid rgba(255, 255, 255, 0.4)' : 'none'
              }}>
                {step > num ? <CheckCircle2 size={16} color="var(--accent-emerald)" /> : num}
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
            padding: '12px 16px',
            color: '#fda4af',
            fontSize: '0.88rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '18px'
          }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {/* Step 1: Connect Wallet */}
        {step === 1 && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '20px' }}>
              Connect your MetaMask wallet. We require connection to <strong>Ethereum Sepolia (Chain ID 11155111)</strong>.
            </p>
            <button 
              className="btn btn-primary" 
              style={{ width: '100%', padding: '12px' }} 
              onClick={handleConnectWallet}
              disabled={loading}
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Wallet size={18} />}
              Connect MetaMask
            </button>
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

            <div className="form-group">
              <label className="form-label">Full Legal Name</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="e.g. Ramesh Kumar"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">National Identity Number (Aadhaar / National ID)</label>
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
              style={{ width: '100%', padding: '12px', marginTop: '8px' }}
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
