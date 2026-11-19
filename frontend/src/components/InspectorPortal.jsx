import React, { useState, useEffect } from 'react';
import {
  CheckCircle,
  XCircle,
  FileText,
  MapPin,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Search,
  Filter,
  DollarSign
} from 'lucide-react';
import { api } from '../services/api';
import { web3Service } from '../services/web3';
import CadastralMap from './CadastralMap';
import TransactionModal from './TransactionModal';

export default function InspectorPortal({ user, onConnectWallet }) {
  const [activeTab, setActiveTab] = useState('applications'); // 'applications' | 'escrows'
  const [jurisdictionId, setJurisdictionId] = useState(101);
  const [applications, setApplications] = useState([]);
  const [escrows, setEscrows] = useState([]);
  const [selectedApp, setSelectedApp] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [loading, setLoading] = useState(false);

  // Web3 Transaction Modal
  const [txModal, setTxModal] = useState({
    isOpen: false,
    status: 'pending',
    title: '',
    message: '',
    txHash: null,
    errorMessage: null,
    onRetryDemo: null,
  });

  const DEMO_APPS = [
    {
      id: 'app-9b41a87c-e091-4d32-b715-fa826b01b34e',
      applicant_identity_id: '0x11223344556677889900aabbccddeeff00112233445566778899aabbccddeeff',
      jurisdiction_id: 101,
      state: 'Maharashtra',
      district: 'Pune',
      taluka: 'Haveli',
      village: 'Wagholi',
      survey_number: '124',
      subdivision: '2A',
      parcel_key: '0x9a8f27b5e43c8d1976023d81b4e2801938fa45bc7d0e34125890bcf4821a73de',
      geometry_hash: '0x7b58c19d4e3a890f67123bc8456de90123456789abcdef0123456789abcdef01',
      area_sq_meters: 4250.0,
      status: 'UNDER_REVIEW',
      has_spatial_overlap: false,
      overlap_notes: null,
    },
    {
      id: 'app-38f190e2-76a1-4cb5-8d29-198f24bc1029',
      applicant_identity_id: '0x556677889900aabbccddeeff00112233445566778899aabbccddeeff00112233',
      jurisdiction_id: 101,
      state: 'Maharashtra',
      district: 'Pune',
      taluka: 'Haveli',
      village: 'Loni Kalbhor',
      survey_number: '59',
      subdivision: '1',
      parcel_key: '0x44d189fa32bc8012903845bcf6712a84fe10a3c7456d98124bc5e19034fa7823',
      geometry_hash: '0x2233445566778899aabbccddeeff00112233445566778899aabbccddeeff0011',
      area_sq_meters: 3100.5,
      status: 'DRAFT',
      has_spatial_overlap: true,
      overlap_notes: 'Potential shared boundary buffer conflict with adjoining Survey #58.',
    },
  ];

  const DEMO_ESCROWS = [
    {
      request_id: 1,
      land_id: 102,
      buyer_identity_id: '0x99887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa',
      seller_identity_id: '0x223344556677889900aabbccddeeff00112233445566778899aabbccddeeff00',
      agreed_price: 6.5,
      deposit_amount: 6.5,
      state: 'FUNDED',
      approval_count: 0,
      has_senior_approval: false,
    },
  ];

  const loadInspectorQueue = async () => {
    setLoading(true);
    try {
      // 1. Load applications
      const apps = await api.getApplications(jurisdictionId || null);
      if (apps && apps.length > 0) {
        setApplications(apps);
      } else {
        setApplications(DEMO_APPS);
      }

      // 2. Load funded escrows under review
      const escrowList = await api.getEscrows({ state: 'FUNDED' });
      const underReviewList = await api.getEscrows({ state: 'UNDER_REVIEW' });
      const combined = [...(escrowList || []), ...(underReviewList || [])];
      if (combined && combined.length > 0) {
        setEscrows(combined);
      } else {
        setEscrows(DEMO_ESCROWS);
      }
    } catch (err) {
      console.warn('API offline, falling back to demo inspector queue:', err.message);
      setApplications(DEMO_APPS);
      setEscrows(DEMO_ESCROWS);
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    loadInspectorQueue();
  }, [jurisdictionId]);

  // Review Application (Approve / Reject)
  const handleReviewDecision = async (decision) => {
    if (!selectedApp) return;
    try {
      await api.reviewApplication(selectedApp.id, decision, rejectionReason);
      alert(`Application #${selectedApp.id} has been ${decision}!`);
      setSelectedApp(null);
      setRejectionReason('');
      loadInspectorQueue();
    } catch (err) {
      alert(`Review action failed: ${err.message}`);
    }
  };

  // Approve Escrow Transfer On-Chain
  const executeSimulatedApproval = async (requestId) => {
    setTxModal({
      isOpen: true,
      status: 'pending',
      title: 'Approving Transfer Escrow',
      message: `Calling approveTransfer for Request #${requestId} on Sepolia (Simulated Demo Mode)...`,
      txHash: null,
      onRetryDemo: null,
    });

    try {
      await api.updateEscrow(requestId, {
        state: 'APPROVED',
        has_senior_approval: true,
      });
    } catch (e) {
      console.warn('Backend sync for simulated approval:', e.message);
    }

    await new Promise((res) => setTimeout(res, 1000));
    const mockHash = '0x7742e4c2aa504ad8c228c5fe80e345ee5630a6f0c3f3010641599893b5f6aa82';
    setTxModal({
      isOpen: true,
      status: 'success',
      title: 'Transfer Approved',
      message: `Escrow Request #${requestId} approved in simulated Sepolia block #6421165! Senior Inspector dual-governance satisfied. Ownership settlement unlocked.`,
      txHash: mockHash,
      onRetryDemo: null,
    });
    setEscrows((prev) =>
      prev.map((e) => (e.request_id === requestId ? { ...e, state: 'APPROVED', has_senior_approval: true, approval_count: (e.approval_count || 0) + 1 } : e))
    );
  };

  const handleApproveEscrowOnChain = async (requestId) => {
    if (web3Service.isPersonaMode(user)) {
      await executeSimulatedApproval(requestId);
      return;
    }

    try {
      await web3Service.ensureSepoliaNetwork();
      setTxModal({
        isOpen: true,
        status: 'pending',
        title: 'Approving Transfer Escrow',
        message: `Calling approveTransfer for Request #${requestId} on Sepolia...`,
        txHash: null,
        onRetryDemo: null,
      });

      const escrowContract = web3Service.getTransferEscrow();
      const tx = await escrowContract.approveTransfer(requestId);
      setTxModal((prev) => ({ ...prev, txHash: tx.hash, message: 'Awaiting block confirmation on Sepolia...' }));
      const receipt = await tx.wait(1);

      try {
        await api.updateEscrow(requestId, {
          state: 'APPROVED',
          has_senior_approval: true,
        });
      } catch (e) {
        console.warn('Backend escrow update:', e);
      }

      setTxModal({
        isOpen: true,
        status: 'success',
        title: 'Transfer Approved',
        message: `Escrow Request #${requestId} approved in block #${receipt.blockNumber}! Ownership settlement unlocked.`,
        txHash: receipt.hash,
        onRetryDemo: null,
      });

      loadInspectorQueue();
    } catch (err) {
      console.error('Escrow approval failed:', err);
      const parsed = web3Service.parseContractError(err, 'Escrow Approval');
      setTxModal({
        isOpen: true,
        status: 'error',
        title: parsed.title,
        errorMessage: parsed.message,
        onRetryDemo: () => executeSimulatedApproval(requestId),
      });
    }
  };

  // Reject Escrow Transfer On-Chain
  const executeSimulatedRejection = async (requestId, reason) => {
    setTxModal({
      isOpen: true,
      status: 'pending',
      title: 'Rejecting Transfer Escrow',
      message: `Calling rejectTransfer for Request #${requestId} on Sepolia (Simulated Demo Mode)...`,
      txHash: null,
      onRetryDemo: null,
    });

    try {
      await api.updateEscrow(requestId, {
        state: 'REJECTED',
        rejection_reason: reason,
      });
    } catch (e) {
      console.warn('Backend sync for simulated reject:', e.message);
    }

    await new Promise((res) => setTimeout(res, 1000));
    setTxModal({
      isOpen: true,
      status: 'success',
      title: 'Transfer Rejected',
      message: `Transfer #${requestId} rejected on regulatory grounds. Buyer deposit unlocked for pull-payment withdrawal.`,
      txHash: '0xba4bcefce65e2fca023ec5f5f4a151e420e40f4b78f6d06b2e7534c5f23ddbc5',
      onRetryDemo: null,
    });
    setEscrows((prev) => prev.filter((e) => e.request_id !== requestId));
  };

  const handleRejectEscrowOnChain = async (requestId) => {
    const reason = prompt('Please enter the regulatory reason for rejecting this transfer:');
    if (!reason) return;

    if (web3Service.isPersonaMode(user)) {
      await executeSimulatedRejection(requestId, reason);
      return;
    }

    try {
      await web3Service.ensureSepoliaNetwork();
      setTxModal({
        isOpen: true,
        status: 'pending',
        title: 'Rejecting Transfer Escrow',
        message: `Calling rejectTransfer for Request #${requestId}...`,
        txHash: null,
        onRetryDemo: null,
      });

      const escrowContract = web3Service.getTransferEscrow();
      const tx = await escrowContract.rejectTransfer(requestId, reason);
      setTxModal((prev) => ({ ...prev, txHash: tx.hash, message: 'Awaiting confirmation on Sepolia...' }));
      const receipt = await tx.wait(1);

      try {
        await api.updateEscrow(requestId, {
          state: 'REJECTED',
          rejection_reason: reason,
        });
      } catch (e) {
        console.warn('Backend escrow rejection sync:', e);
      }

      setTxModal({
        isOpen: true,
        status: 'success',
        title: 'Transfer Rejected',
        message: `Transfer rejected in block #${receipt.blockNumber}. Buyer deposit is refunded for withdrawal.`,
        txHash: receipt.hash,
        onRetryDemo: null,
      });

      loadInspectorQueue();
    } catch (err) {
      console.error('Escrow rejection failed:', err);
      const parsed = web3Service.parseContractError(err, 'Escrow Rejection');
      setTxModal({
        isOpen: true,
        status: 'error',
        title: parsed.title,
        errorMessage: parsed.message,
        onRetryDemo: () => executeSimulatedRejection(requestId, reason),
      });
    }
  };

  // Settle Escrow Transfer On-Chain (Updates ownership in LandRegistry & credits seller)
  const executeSimulatedSettlement = async (requestId) => {
    setTxModal({
      isOpen: true,
      status: 'pending',
      title: 'Settling Land Ownership Transfer',
      message: `Calling settleTransfer for Request #${requestId} on Sepolia (Simulated Demo Mode)...`,
      txHash: null,
      onRetryDemo: null,
    });

    try {
      await api.updateEscrow(requestId, {
        state: 'COMPLETED',
      });
    } catch (e) {
      console.warn('Backend sync for simulated settlement:', e.message);
    }

    await new Promise((res) => setTimeout(res, 1200));
    setTxModal({
      isOpen: true,
      status: 'success',
      title: 'Transfer Settled & Title Conveyed!',
      message: `Ownership successfully transferred to buyer! Sale proceeds credited to seller's pull-payment balance in simulated block #6421175.`,
      txHash: '0x9942aef3104bd36e897103ec19b48f1025a74e0c3f3010641599893b5f6cb123',
      onRetryDemo: null,
    });
    setEscrows((prev) =>
      prev.map((e) => (e.request_id === requestId ? { ...e, state: 'COMPLETED' } : e))
    );
  };

  const handleSettleEscrowOnChain = async (requestId) => {
    if (web3Service.isPersonaMode(user)) {
      await executeSimulatedSettlement(requestId);
      return;
    }

    try {
      await web3Service.ensureSepoliaNetwork();
      setTxModal({
        isOpen: true,
        status: 'pending',
        title: 'Settling Land Ownership Transfer',
        message: `Calling settleTransfer for Request #${requestId} on Sepolia...`,
        txHash: null,
        onRetryDemo: null,
      });

      const escrowContract = web3Service.getTransferEscrow();
      const tx = await escrowContract.settleTransfer(requestId);
      setTxModal((prev) => ({ ...prev, txHash: tx.hash, message: 'Awaiting block confirmation on Sepolia...' }));
      const receipt = await tx.wait(1);

      try {
        await api.updateEscrow(requestId, {
          state: 'COMPLETED',
        });
      } catch (e) {
        console.warn('Backend settlement sync:', e);
      }

      setTxModal({
        isOpen: true,
        status: 'success',
        title: 'Transfer Settled & Title Conveyed!',
        message: `Ownership transferred to buyer in block #${receipt.blockNumber}! Sale proceeds credited to seller pull-payment lockbox.`,
        txHash: receipt.hash,
        onRetryDemo: null,
      });

      loadInspectorQueue();
    } catch (err) {
      console.error('Escrow settlement failed:', err);
      const parsed = web3Service.parseContractError(err, 'Escrow Settlement');
      setTxModal({
        isOpen: true,
        status: 'error',
        title: parsed.title,
        errorMessage: parsed.message,
        onRetryDemo: () => executeSimulatedSettlement(requestId),
      });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        <button
          className={activeTab === 'applications' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('applications')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <FileText size={16} />
          Land Application Queue ({applications.length})
        </button>
        <button
          className={activeTab === 'escrows' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('escrows')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <DollarSign size={16} />
          Escrow Approval Queue ({escrows.length})
        </button>
      </div>

      {/* TAB 1: LAND APPLICATIONS */}
      {activeTab === 'applications' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Jurisdiction Filter Bar */}
          <div className="glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <Filter size={16} color="var(--text-muted)" />
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Assigned Jurisdiction:</span>
              <select
                value={jurisdictionId}
                onChange={(e) => setJurisdictionId(Number(e.target.value))}
                style={{ width: '180px' }}
              >
                <option value={101}>101 - Pune / Haveli</option>
                <option value={102}>102 - Mumbai Suburban</option>
                <option value={103}>103 - Thane</option>
              </select>
            </div>
            <button className="btn-secondary" onClick={loadInspectorQueue} title="Refresh">
              <RefreshCw size={15} />
            </button>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Loading applications...</div>
          ) : applications.length === 0 ? (
            <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              No pending applications found in jurisdiction #{jurisdictionId}.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {applications.map((app) => (
                <div
                  key={app.id}
                  className="glass-panel"
                  style={{
                    padding: '1.5rem',
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                        {app.village} - Survey #{app.survey_number}/{app.subdivision}
                      </span>
                      <span className={`badge ${app.status === 'APPROVED' ? 'badge-verified' : app.status === 'REJECTED' ? 'badge-danger' : 'badge-pending'}`}>
                        {app.status}
                      </span>
                      {app.has_spatial_overlap && (
                        <span className="badge badge-danger" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <AlertTriangle size={12} /> Overlap Flagged
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <div>Applicant Identity: <span style={{ fontFamily: 'monospace' }}>{app.applicant_identity_id}</span></div>
                      <div>Parcel Key: <span style={{ fontFamily: 'monospace' }}>{app.parcel_key}</span></div>
                      <div>Geometry Commitment: <span style={{ fontFamily: 'monospace' }}>{app.geometry_hash ? app.geometry_hash.slice(0, 16) + '...' : 'None'}</span></div>
                    </div>
                  </div>

                  <button className="btn-primary" onClick={() => setSelectedApp(app)}>
                    Review Dossier
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ESCROW APPROVAL QUEUE */}
      {activeTab === 'escrows' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Funded Escrows Awaiting Inspector Approval</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Transfers $\ge$ 5.0 ETH enforce two-tier governance requiring Senior Inspector authorization.
              </p>
            </div>
            <button className="btn-secondary" onClick={loadInspectorQueue} title="Refresh">
              <RefreshCw size={15} />
            </button>
          </div>

          {escrows.length === 0 ? (
            <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              No funded escrows awaiting review.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {escrows.map((escrow) => (
                <div
                  key={escrow.request_id}
                  className="glass-panel"
                  style={{
                    padding: '1.5rem',
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                        Escrow Request #{escrow.request_id} (Land #{escrow.land_id})
                      </span>
                      <span className="badge badge-locked">{escrow.state}</span>
                      {Number(escrow.agreed_price) >= 5 && (
                        <span className="badge badge-accent">High Value ($\ge$ 5 ETH)</span>
                      )}
                    </div>

                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <div>Purchase Consideration: <strong>{escrow.agreed_price} ETH</strong> (Funded in contract)</div>
                      <div>Buyer Identity: <span style={{ fontFamily: 'monospace' }}>{escrow.buyer_identity_id}</span></div>
                      <div>Seller Identity: <span style={{ fontFamily: 'monospace' }}>{escrow.seller_identity_id}</span></div>
                      <div>Approvals Count: {escrow.approval_count} {escrow.has_senior_approval ? '(Senior Approved)' : ''}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    {escrow.state !== 'COMPLETED' && (
                      <button
                        className="btn-secondary"
                        onClick={() => handleRejectEscrowOnChain(escrow.request_id)}
                        style={{ color: 'var(--brand-danger)', borderColor: 'var(--brand-danger)' }}
                      >
                        Reject & Refund
                      </button>
                    )}
                    {escrow.state === 'APPROVED' ? (
                      <button
                        className="btn-primary"
                        onClick={() => handleSettleEscrowOnChain(escrow.request_id)}
                        style={{ background: 'linear-gradient(135deg, #10b981, #06b6d4)' }}
                      >
                        Settle & Convey Title
                      </button>
                    ) : escrow.state !== 'COMPLETED' ? (
                      <button
                        className="btn-primary"
                        onClick={() => handleApproveEscrowOnChain(escrow.request_id)}
                      >
                        Authorize Transfer
                      </button>
                    ) : (
                      <span className="badge badge-verified">Settled & Conveyed</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Application Review Drawer */}
      {selectedApp && (
        <div className="modal-backdrop" onClick={() => setSelectedApp(null)}>
          <div
            className="glass-panel"
            style={{ width: '720px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', padding: '2rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ fontSize: '1.35rem', fontWeight: 700 }}>
                  Review Application: {selectedApp.village} Survey #{selectedApp.survey_number}
                </h3>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Application ID: {selectedApp.id}</div>
              </div>
              <button className="btn-secondary" onClick={() => setSelectedApp(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '1.5rem' }}>
              {selectedApp.has_spatial_overlap && (
                <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--brand-danger)', borderRadius: '8px', color: 'var(--brand-danger)' }}>
                  <strong>Spatial Conflict Warning:</strong> {selectedApp.overlap_notes || 'Overlaps with existing registered parcel.'}
                </div>
              )}

              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                <div style={{ fontWeight: 600, color: 'var(--brand-accent)', marginBottom: '0.5rem' }}>Cadastral Metadata</div>
                <div>Location: {selectedApp.village}, {selectedApp.taluka}, {selectedApp.district}, {selectedApp.state}</div>
                <div>Calculated Area: {selectedApp.area_sq_meters.toFixed(2)} sq meters</div>
                <div>Keccak256 Parcel Key: <span style={{ fontFamily: 'monospace' }}>{selectedApp.parcel_key}</span></div>
                <div>Deterministic Geometry Hash: <span style={{ fontFamily: 'monospace' }}>{selectedApp.geometry_hash}</span></div>
              </div>

              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Boundary Inspection</div>
                <CadastralMap height="240px" interactive={false} />
              </div>

              <div>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                  Inspector Remarks (Optional if Approved; Required if Rejected)
                </label>
                <textarea
                  rows="3"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Note regulatory discrepancies, boundary anomalies, or field inspection notes..."
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
              <button
                className="btn-secondary"
                onClick={() => handleReviewDecision('REJECTED')}
                style={{ color: 'var(--brand-danger)', borderColor: 'var(--brand-danger)' }}
              >
                Reject Application
              </button>
              <button
                className="btn-primary"
                onClick={() => handleReviewDecision('APPROVED')}
              >
                Approve for On-Chain Minting
              </button>
            </div>
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
        onRetryDemo={txModal.onRetryDemo}
      />
    </div>
  );
}
