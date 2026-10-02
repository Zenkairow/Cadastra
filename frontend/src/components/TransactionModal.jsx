import React from 'react';
import { ExternalLink, CheckCircle, AlertCircle, Loader, X } from 'lucide-react';

export default function TransactionModal({
  isOpen,
  onClose,
  status = 'pending', // 'pending' | 'success' | 'error'
  title = 'Transaction in Progress',
  message = 'Please confirm the transaction in MetaMask and wait for Sepolia block confirmation.',
  txHash = null,
  errorMessage = null,
}) {
  if (!isOpen) return null;

  const explorerUrl = txHash ? `https://sepolia.etherscan.io/tx/${txHash}` : null;

  return (
    <div className="modal-backdrop">
      <div className="glass-panel" style={{ width: '480px', maxWidth: '95vw', padding: '2rem', position: 'relative' }}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1.25rem',
            right: '1.25rem',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
          {status === 'pending' && (
            <div style={{ display: 'inline-flex', padding: '1rem', borderRadius: '50%', background: 'rgba(56, 189, 248, 0.1)', color: 'var(--brand-accent)', marginBottom: '1.25rem' }}>
              <Loader size={48} className="animate-spin" />
            </div>
          )}

          {status === 'success' && (
            <div style={{ display: 'inline-flex', padding: '1rem', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--brand-success)', marginBottom: '1.25rem' }}>
              <CheckCircle size={48} />
            </div>
          )}

          {status === 'error' && (
            <div style={{ display: 'inline-flex', padding: '1rem', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--brand-danger)', marginBottom: '1.25rem' }}>
              <AlertCircle size={48} />
            </div>
          )}

          <h3 style={{ fontSize: '1.35rem', fontWeight: 600, marginBottom: '0.75rem' }}>{title}</h3>
          
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.925rem', lineHeight: 1.5, marginBottom: '1.5rem' }}>
            {status === 'error' ? errorMessage || 'An unexpected Web3 error occurred.' : message}
          </p>

          {explorerUrl && (
            <div style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '0.85rem 1rem',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.85rem',
            }}>
              <span style={{ color: 'var(--text-muted)' }}>Sepolia Tx Hash:</span>
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: 'var(--brand-accent)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontFamily: 'monospace',
                  textDecoration: 'none',
                }}
              >
                {txHash.slice(0, 10)}...{txHash.slice(-8)}
                <ExternalLink size={14} />
              </a>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            {status !== 'pending' && (
              <button className="btn-primary" onClick={onClose} style={{ minWidth: '140px' }}>
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
