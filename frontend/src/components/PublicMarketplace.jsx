import React, { useState, useEffect } from 'react';
import { Search, Filter, ShieldCheck, MapPin, Layers, ExternalLink, ArrowRight, CheckCircle2, Lock, FileText, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { web3Service } from '../services/web3';
import CadastralMap from './CadastralMap';
import TransactionModal from './TransactionModal';
import { ethers } from 'ethers';

export default function PublicMarketplace({ user, onConnectWallet }) {
  const [lands, setLands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedLand, setSelectedLand] = useState(null);
  const [escrowModalOpen, setEscrowModalOpen] = useState(false);
  const [escrowPriceEth, setEscrowPriceEth] = useState('1.5');
  const [escrowDurationDays, setEscrowDurationDays] = useState(14);
  const [txModal, setTxModal] = useState({ isOpen: false, status: 'pending', title: '', message: '', txHash: null, errorMessage: null });

  const loadLands = async () => {
    setLoading(true);
    try {
      const res = await api.getLands(1, 50, null, statusFilter || null);
      if (res && res.items) {
        setLands(res.items);
      } else {
        setLands([]);
      }
    } catch (err) {
      console.error('Failed to load lands:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLands();
  }, [statusFilter]);

  const filteredLands = lands.filter((l) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      l.parcel_key.toLowerCase().includes(term) ||
      String(l.land_id).includes(term) ||
      String(l.jurisdiction_id).includes(term)
    );
  });

  const handleInitiateEscrow = async (e) => {
    e.preventDefault();
    if (!user || !user.active_wallet) {
      alert('Please connect your verified wallet to initiate escrow.');
      if (onConnectWallet) onConnectWallet();
      return;
    }

    try {
      await web3Service.ensureSepoliaNetwork();
      setTxModal({
        isOpen: true,
        status: 'pending',
        title: 'Initiating Transfer Escrow',
        message: `Submitting requestTransfer for Land #${selectedLand.land_id} at ${escrowPriceEth} ETH.`,
        txHash: null,
      });

      const escrowContract = web3Service.getTransferEscrow();
      const priceWei = ethers.parseEther(escrowPriceEth);
      const expirationSeconds = Math.floor(Date.now() / 1000) + Number(escrowDurationDays) * 86400;

      // seller identity is selectedLand.owner_identity_id
      const tx = await escrowContract.requestTransfer(
        selectedLand.land_id,
        selectedLand.owner_identity_id,
        priceWei,
        expirationSeconds
      );

      setTxModal((prev) => ({ ...prev, txHash: tx.hash, message: 'Awaiting block confirmation on Sepolia...' }));
      const receipt = await tx.wait(1);

      setTxModal({
        isOpen: true,
        status: 'success',
        title: 'Escrow Request Created',
        message: `Transfer Escrow created successfully in block #${receipt.blockNumber}. Buyer can now fund the escrow.`,
        txHash: receipt.hash,
      });

      setEscrowModalOpen(false);
      loadLands();
    } catch (err) {
      console.error('Escrow initiation error:', err);
      setTxModal({
        isOpen: true,
        status: 'error',
        title: 'Escrow Creation Failed',
        errorMessage: err.reason || err.message,
      });
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'VERIFIED':
        return <span className="badge badge-verified"><ShieldCheck size={12} style={{ marginRight: '4px' }} /> Verified</span>;
      case 'LOCKED_IN_TRANSFER':
        return <span className="badge badge-locked"><Lock size={12} style={{ marginRight: '4px' }} /> Escrow Locked</span>;
      case 'PENDING_VERIFICATION':
        return <span className="badge badge-pending">Pending Review</span>;
      case 'REJECTED':
        return <span className="badge badge-danger">Rejected</span>;
      default:
        return <span className="badge">{status}</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Hero Header */}
      <div className="glass-panel" style={{ padding: '2.5rem', position: 'relative', overflow: 'hidden' }}>
        <div style={{ maxWidth: '700px', position: 'relative', zIndex: 1 }}>
          <div className="badge badge-accent" style={{ marginBottom: '1rem' }}>
            Authoritative Cadastral Registry
          </div>
          <h1 style={{ fontSize: '2.4rem', fontWeight: 700, marginBottom: '0.75rem', lineHeight: 1.2 }}>
            Decentralized Title Catalog & Escrow Exchange
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
            Zero-PII land titles cryptographically anchored to Ethereum Sepolia. Direct search powered by PostgreSQL read-model with zero sequential RPC lag.
          </p>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.75rem 1.25rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Registered Parcels</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--brand-accent)' }}>{lands.length}</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.75rem 1.25rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Verified Titles</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--brand-success)' }}>
                {lands.filter(l => l.status === 'VERIFIED').length}
              </div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.75rem 1.25rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Active Escrows</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f59e0b' }}>
                {lands.filter(l => l.status === 'LOCKED_IN_TRANSFER').length}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '1rem', flex: 1, minWidth: '280px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search by Parcel Key, Land ID, Jurisdiction..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', paddingLeft: '2.75rem' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Filter size={16} style={{ color: 'var(--text-muted)' }} />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ width: '180px' }}
          >
            <option value="">All Statuses</option>
            <option value="VERIFIED">Verified Only</option>
            <option value="LOCKED_IN_TRANSFER">In Escrow</option>
            <option value="PENDING_VERIFICATION">Pending Review</option>
          </select>
          <button className="btn-secondary" onClick={loadLands} title="Refresh Read Model">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Lands Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
          <div className="animate-spin" style={{ display: 'inline-block', marginBottom: '1rem' }}><RefreshCw size={32} /></div>
          <div>Loading registered titles from PostgreSQL read model...</div>
        </div>
      ) : filteredLands.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
          <Layers size={48} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
          <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>No Land Parcels Found</h3>
          <p style={{ maxWidth: '400px', margin: '0 auto' }}>
            There are currently no parcels matching your filter criteria. Try changing filters or submit a new draft application.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1.5rem' }}>
          {filteredLands.map((land) => (
            <div
              key={land.land_id}
              className="glass-panel"
              style={{
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'transform 0.2s, border-color 0.2s',
                cursor: 'pointer',
              }}
              onClick={() => setSelectedLand(land)}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--brand-accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-color)')}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '0.85rem', fontFamily: 'monospace', color: 'var(--brand-accent)', background: 'rgba(56, 189, 248, 0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                    Land #{land.land_id}
                  </span>
                  {getStatusBadge(land.status)}
                </div>

                <h3 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  Jurisdiction ID: {land.jurisdiction_id}
                </h3>

                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                  Parcel Key:
                  <div style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', wordBreak: 'break-all', fontSize: '0.78rem', marginTop: '0.25rem' }}>
                    {land.parcel_key}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Geometry Commitment:</span>
                    <span style={{ fontFamily: 'monospace', color: 'var(--brand-accent)' }}>
                      {land.geometry_hash ? `${land.geometry_hash.slice(0, 8)}...${land.geometry_hash.slice(-6)}` : 'None'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Document Manifest:</span>
                    <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                      {land.document_manifest_hash ? `${land.document_manifest_hash.slice(0, 8)}...${land.document_manifest_hash.slice(-6)}` : 'None'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Registered Block:</span>
                    <span style={{ fontFamily: 'monospace' }}>#{land.registered_block}</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>View Dossier</span>
                <ArrowRight size={16} color="var(--brand-accent)" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selected Land Dossier Modal */}
      {selectedLand && (
        <div className="modal-backdrop" onClick={() => setSelectedLand(null)}>
          <div
            className="glass-panel"
            style={{ width: '700px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', padding: '2rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Land Parcel #{selectedLand.land_id}</h2>
                  {getStatusBadge(selectedLand.status)}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Authoritative Title anchored on Sepolia block #{selectedLand.registered_block}
                </div>
              </div>
              <button
                className="btn-secondary"
                style={{ padding: '0.35rem 0.65rem' }}
                onClick={() => setSelectedLand(null)}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--brand-accent)', marginBottom: '0.75rem' }}>
                  Cryptographic Commitments
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Keccak256 Parcel Key: </span>
                    <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{selectedLand.parcel_key}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Owner Identity ID: </span>
                    <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{selectedLand.owner_identity_id}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>SHA-256 Geometry Hash: </span>
                    <span style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--brand-accent)' }}>{selectedLand.geometry_hash}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>SHA-256 Manifest Hash: </span>
                    <span style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>{selectedLand.document_manifest_hash}</span>
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <MapPin size={16} color="var(--brand-accent)" />
                  Registered Cadastral Boundary
                </div>
                <CadastralMap height="240px" interactive={false} />
              </div>
            </div>

            {/* Escrow Trigger Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
              <a
                href={`https://sepolia.etherscan.io/address/${web3Service.CONTRACT_ADDRESSES?.LandRegistry}`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}
              >
                <ExternalLink size={15} />
                Sepolia Explorer
              </a>

              {selectedLand.status === 'VERIFIED' && (
                <button
                  className="btn-primary"
                  onClick={() => setEscrowModalOpen(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <Lock size={15} />
                  Initiate Purchase Escrow
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Escrow Initiation Modal */}
      {escrowModalOpen && selectedLand && (
        <div className="modal-backdrop" onClick={() => setEscrowModalOpen(false)}>
          <div
            className="glass-panel"
            style={{ width: '460px', maxWidth: '95vw', padding: '2rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              Create Purchase Escrow
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Locked in <code style={{ color: 'var(--brand-accent)' }}>TransferEscrow.sol</code>. State will transition to REQUESTED and require buyer deposit.
            </p>

            <form onSubmit={handleInitiateEscrow} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                  Agreed Purchase Price (ETH)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={escrowPriceEth}
                  onChange={(e) => setEscrowPriceEth(e.target.value)}
                  style={{ width: '100%' }}
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                  Transfers $\ge$ 5.0 ETH automatically require Senior Inspector approval.
                </span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                  Escrow Lock Duration (Days)
                </label>
                <input
                  type="number"
                  min="1"
                  max="90"
                  required
                  value={escrowDurationDays}
                  onChange={(e) => setEscrowDurationDays(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setEscrowModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Confirm & Lock Escrow
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transaction Status Modal */}
      <TransactionModal
        isOpen={txModal.isOpen}
        onClose={() => setTxModal((prev) => ({ ...prev, isOpen: false }))}
        status={txModal.status}
        title={txModal.title}
        message={txModal.message}
        txHash={txModal.txHash}
        errorMessage={txModal.errorMessage}
      />
    </div>
  );
}
