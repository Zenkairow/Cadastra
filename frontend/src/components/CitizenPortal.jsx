import React, { useState, useEffect } from 'react';
import {
  FileText,
  MapPin,
  Upload,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  DollarSign,
  Lock,
  Layers,
  FileCheck,
  ExternalLink
} from 'lucide-react';
import { api } from '../services/api';
import { web3Service } from '../services/web3';
import CadastralMap from './CadastralMap';
import TransactionModal from './TransactionModal';
import { ethers } from 'ethers';

export default function CitizenPortal({ user, onConnectWallet }) {
  const [activeTab, setActiveTab] = useState('register'); // 'register' | 'applications' | 'escrows'

  // Application Stepper State
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    jurisdiction_id: 101,
    state: 'Maharashtra',
    district: 'Pune',
    taluka: 'Haveli',
    village: 'Wagholi',
    survey_number: '124',
    subdivision: '2A',
  });

  const [polygonCoordinates, setPolygonCoordinates] = useState([
    [73.9850, 18.5800],
    [73.9870, 18.5800],
    [73.9870, 18.5820],
    [73.9850, 18.5820],
    [73.9850, 18.5800]
  ]);

  const [overlapStatus, setOverlapStatus] = useState(null); // null | { checking: boolean, has_overlap: boolean, details: string }
  const [uploadedFiles, setUploadedFiles] = useState({});
  const [createdAppId, setCreatedAppId] = useState(null);
  const [myApplications, setMyApplications] = useState([]);
  const [myEscrows, setMyEscrows] = useState([]);
  const [pendingWithdrawal, setPendingWithdrawal] = useState('0');
  const [loadingList, setLoadingList] = useState(false);
  const [tamperReport, setTamperReport] = useState(null);

  // Web3 Transaction Modal State
  const [txModal, setTxModal] = useState({
    isOpen: false,
    status: 'pending',
    title: '',
    message: '',
    txHash: null,
    errorMessage: null,
  });

  // Load applications and escrows
  const loadData = async () => {
    if (!user || !user.identity_id) return;
    setLoadingList(true);
    try {
      const apps = await api.getApplications();
      setMyApplications(apps || []);

      const escrows = await api.getEscrows({ buyerIdentityId: user.identity_id });
      const sellerEscrows = await api.getEscrows({ sellerIdentityId: user.identity_id });
      
      // Combine unique escrows
      const map = new Map();
      [...(escrows || []), ...(sellerEscrows || [])].forEach((item) => map.set(item.request_id, item));
      setMyEscrows(Array.from(map.values()));

      // Check pull payment withdrawal balance
      if (user.active_wallet && web3Service.isMetaMaskAvailable()) {
        try {
          const escrowContract = web3Service.getTransferEscrow();
          const balWei = await escrowContract.pendingWithdrawals(user.active_wallet);
          setPendingWithdrawal(ethers.formatEther(balWei));
        } catch (e) {
          console.warn('Could not read pending withdrawals:', e);
        }
      }
    } catch (err) {
      console.error('Failed to load user portal data:', err);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  // Spatial Overlap Check
  const handleCheckOverlap = async () => {
    setOverlapStatus({ checking: true, message: 'Performing OGC topological validation & spatial intersection query...' });
    try {
      const geojson = {
        type: 'Polygon',
        coordinates: [polygonCoordinates],
      };
      const res = await api.checkOverlap(geojson);
      if (res.has_overlap) {
        setOverlapStatus({
          checking: false,
          has_overlap: true,
          severity: res.severity,
          details: `Encroachment detected! Conflicts with ${res.conflict_count} registered parcel boundary.`,
        });
      } else {
        setOverlapStatus({
          checking: false,
          has_overlap: false,
          details: `Topologically valid & 100% disjoint. Encroachment area: 0 sqm (${res.candidate_area_sqm.toFixed(2)} sqm total).`,
        });
      }
    } catch (err) {
      setOverlapStatus({
        checking: false,
        has_overlap: true,
        details: err.message || 'Spatial check failed',
      });
    }
  };

  // Submit Draft Application
  const handleSubmitApplication = async () => {
    if (!user) {
      alert('Please connect your verified wallet first.');
      if (onConnectWallet) onConnectWallet();
      return;
    }

    try {
      const payload = {
        jurisdiction_id: Number(formData.jurisdiction_id),
        state: formData.state,
        district: formData.district,
        taluka: formData.taluka,
        village: formData.village,
        survey_number: formData.survey_number,
        subdivision: formData.subdivision,
        geojson: {
          type: 'Polygon',
          coordinates: [polygonCoordinates],
        },
      };

      const app = await api.createDraftApplication(payload);
      setCreatedAppId(app.id);

      // Upload any staged files
      for (const [docType, file] of Object.entries(uploadedFiles)) {
        if (file) {
          try {
            await api.uploadDocument(app.id, docType, file);
          } catch (uploadErr) {
            console.warn(`Upload failed for ${docType}:`, uploadErr);
          }
        }
      }

      alert('Land Application successfully submitted off-chain for Inspector Review!');
      setStep(1);
      setActiveTab('applications');
      loadData();
    } catch (err) {
      alert(`Submission failed: ${err.message}`);
    }
  };

  // On-Chain Land Registration (when status is APPROVED)
  const handleMintOnChain = async (app) => {
    try {
      await web3Service.ensureSepoliaNetwork();
      setTxModal({
        isOpen: true,
        status: 'pending',
        title: 'Minting On-Chain Land Title',
        message: `Calling registerLand for Parcel Key ${app.parcel_key.slice(0, 10)}... on Sepolia.`,
        txHash: null,
      });

      const landRegistry = web3Service.getLandRegistry();
      const tx = await landRegistry.registerLand(
        app.parcel_key,
        app.applicant_identity_id,
        app.jurisdiction_id,
        app.geometry_hash,
        '0x0000000000000000000000000000000000000000000000000000000000000000' // Initial manifest commitment
      );

      setTxModal((prev) => ({ ...prev, txHash: tx.hash, message: 'Awaiting block confirmation on Sepolia...' }));
      const receipt = await tx.wait(1);

      setTxModal({
        isOpen: true,
        status: 'success',
        title: 'Title Registered On-Chain',
        message: `Land registered successfully in block #${receipt.blockNumber}! Synchronizing to read model...`,
        txHash: receipt.hash,
      });

      loadData();
    } catch (err) {
      console.error('Registration mint failed:', err);
      setTxModal({
        isOpen: true,
        status: 'error',
        title: 'Registration Failed',
        errorMessage: err.reason || err.message,
      });
    }
  };

  // Buyer: Fund Escrow
  const handleFundEscrow = async (escrow) => {
    try {
      await web3Service.ensureSepoliaNetwork();
      setTxModal({
        isOpen: true,
        status: 'pending',
        title: 'Depositing Escrow Funds',
        message: `Sending ${escrow.agreed_price} ETH to TransferEscrow contract for Request #${escrow.request_id}...`,
        txHash: null,
      });

      const escrowContract = web3Service.getTransferEscrow();
      const priceWei = ethers.parseEther(String(escrow.agreed_price));

      const tx = await escrowContract.depositPayment(escrow.request_id, { value: priceWei });
      setTxModal((prev) => ({ ...prev, txHash: tx.hash, message: 'Awaiting block confirmation on Sepolia...' }));
      const receipt = await tx.wait(1);

      setTxModal({
        isOpen: true,
        status: 'success',
        title: 'Escrow Funded',
        message: `Payment of ${escrow.agreed_price} ETH locked in escrow contract. Status updated to FUNDED.`,
        txHash: receipt.hash,
      });

      loadData();
    } catch (err) {
      console.error('Funding failed:', err);
      setTxModal({
        isOpen: true,
        status: 'error',
        title: 'Escrow Deposit Failed',
        errorMessage: err.reason || err.message,
      });
    }
  };

  // Seller: Withdraw Funds (Pull-Payment)
  const handleWithdrawFunds = async () => {
    try {
      await web3Service.ensureSepoliaNetwork();
      setTxModal({
        isOpen: true,
        status: 'pending',
        title: 'Withdrawing Settled Funds',
        message: `Pulling ${pendingWithdrawal} ETH from TransferEscrow contract to ${user.active_wallet}...`,
        txHash: null,
      });

      const escrowContract = web3Service.getTransferEscrow();
      const tx = await escrowContract.withdrawFunds();
      setTxModal((prev) => ({ ...prev, txHash: tx.hash, message: 'Awaiting block confirmation on Sepolia...' }));
      const receipt = await tx.wait(1);

      setTxModal({
        isOpen: true,
        status: 'success',
        title: 'Withdrawal Completed',
        message: `Successfully transferred ${pendingWithdrawal} ETH to your wallet!`,
        txHash: receipt.hash,
      });

      loadData();
    } catch (err) {
      console.error('Withdrawal failed:', err);
      setTxModal({
        isOpen: true,
        status: 'error',
        title: 'Withdrawal Failed',
        errorMessage: err.reason || err.message,
      });
    }
  };

  // Tamper Verification check
  const handleVerifyTamper = async (appId) => {
    try {
      const res = await api.verifyDocumentTamper(appId);
      setTamperReport(res);
    } catch (err) {
      alert(`Tamper check failed: ${err.message}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Portal Navigation Tabs */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        <button
          className={activeTab === 'register' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('register')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <FileText size={16} />
          Register New Land
        </button>
        <button
          className={activeTab === 'applications' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('applications')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Layers size={16} />
          My Applications ({myApplications.length})
        </button>
        <button
          className={activeTab === 'escrows' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('escrows')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <DollarSign size={16} />
          My Escrows ({myEscrows.length})
        </button>
      </div>

      {/* TAB 1: REGISTRATION STEPPER */}
      {activeTab === 'register' && (
        <div className="glass-panel" style={{ padding: '2rem' }}>
          {/* Stepper Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2.5rem', position: 'relative' }}>
            {['Cadastral Location', 'Boundary & Overlap Check', 'Evidentiary Documents', 'Review & Submit'].map((title, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  opacity: step === idx + 1 ? 1 : 0.6,
                }}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: step === idx + 1 ? 'var(--brand-accent)' : 'var(--bg-input)',
                    color: step === idx + 1 ? '#000' : 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                  }}
                >
                  {idx + 1}
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: step === idx + 1 ? 600 : 400 }}>{title}</div>
              </div>
            ))}
          </div>

          {/* Step 1: Cadastral Location */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '640px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Cadastral Identifiers (Unicode NFKC Normalized)</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Enter the exact jurisdictional and revenue survey numbers. These will deterministically compute the Layer 1 <code style={{ color: 'var(--brand-accent)' }}>parcelKey</code>.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Jurisdiction ID</label>
                  <input
                    type="number"
                    value={formData.jurisdiction_id}
                    onChange={(e) => setFormData({ ...formData, jurisdiction_id: e.target.value })}
                    style={{ width: '100%', marginTop: '0.35rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>State</label>
                  <input
                    type="text"
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    style={{ width: '100%', marginTop: '0.35rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>District</label>
                  <input
                    type="text"
                    value={formData.district}
                    onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                    style={{ width: '100%', marginTop: '0.35rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Taluka / Tahsil</label>
                  <input
                    type="text"
                    value={formData.taluka}
                    onChange={(e) => setFormData({ ...formData, taluka: e.target.value })}
                    style={{ width: '100%', marginTop: '0.35rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Village</label>
                  <input
                    type="text"
                    value={formData.village}
                    onChange={(e) => setFormData({ ...formData, village: e.target.value })}
                    style={{ width: '100%', marginTop: '0.35rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Survey Number / Khasra</label>
                  <input
                    type="text"
                    value={formData.survey_number}
                    onChange={(e) => setFormData({ ...formData, survey_number: e.target.value })}
                    style={{ width: '100%', marginTop: '0.35rem' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Subdivision / Hissa</label>
                  <input
                    type="text"
                    value={formData.subdivision}
                    onChange={(e) => setFormData({ ...formData, subdivision: e.target.value })}
                    style={{ width: '100%', marginTop: '0.35rem' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button className="btn-primary" onClick={() => setStep(2)}>
                  Proceed to Boundary Polygon <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Cadastral Boundary & Overlap */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Cadastral Boundary & Overlap Query</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                    Draw boundary vertices or click handles to edit. The system verifies OGC validity and checks for encroachment against existing titles.
                  </p>
                </div>
                <button
                  className="btn-secondary"
                  onClick={handleCheckOverlap}
                  disabled={overlapStatus?.checking}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <RefreshCw size={15} className={overlapStatus?.checking ? 'animate-spin' : ''} />
                  Evaluate Spatial Overlap
                </button>
              </div>

              {/* Status Banner */}
              {overlapStatus && (
                <div
                  style={{
                    padding: '1rem',
                    borderRadius: '8px',
                    border: `1px solid ${overlapStatus.has_overlap ? 'var(--brand-danger)' : 'var(--brand-success)'}`,
                    background: overlapStatus.has_overlap ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}
                >
                  {overlapStatus.has_overlap ? (
                    <AlertTriangle color="var(--brand-danger)" size={20} />
                  ) : (
                    <CheckCircle color="var(--brand-success)" size={20} />
                  )}
                  <div style={{ fontSize: '0.9rem' }}>{overlapStatus.details}</div>
                </div>
              )}

              <CadastralMap
                interactive={true}
                height="340px"
                onPolygonChange={(coords) => setPolygonCoordinates(coords)}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
                <button className="btn-secondary" onClick={() => setStep(1)}>
                  Back
                </button>
                <button
                  className="btn-primary"
                  onClick={() => setStep(3)}
                  disabled={overlapStatus?.has_overlap}
                >
                  Proceed to Evidentiary Documents <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Evidentiary Documents */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '640px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Evidentiary Documents & SHA-256 Commitments</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Upload title deeds and tax extracts. Binary inspection will verify PDF/TIFF magic bytes, and canonical hashes will form the document manifest commitment.
              </p>

              {[
                { type: 'SALE_DEED', label: 'Registered Sale Deed (PDF)' },
                { type: '7_12_EXTRACT', label: '7/12 Extract / Record of Rights' },
                { type: 'TAX_RECEIPT', label: 'Property Tax Payment Receipt' },
              ].map((doc) => (
                <div key={doc.type} style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <label style={{ fontSize: '0.9rem', fontWeight: 500, display: 'block', marginBottom: '0.5rem' }}>
                    {doc.label}
                  </label>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg"
                    onChange={(e) => setUploadedFiles({ ...uploadedFiles, [doc.type]: e.target.files[0] })}
                    style={{ fontSize: '0.85rem' }}
                  />
                  {uploadedFiles[doc.type] && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--brand-accent)', marginTop: '0.4rem', fontFamily: 'monospace' }}>
                      Selected: {uploadedFiles[doc.type].name} ({uploadedFiles[doc.type].size} bytes)
                    </div>
                  )}
                </div>
              ))}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
                <button className="btn-secondary" onClick={() => setStep(2)}>
                  Back
                </button>
                <button className="btn-primary" onClick={() => setStep(4)}>
                  Review & Finalize <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Review & Submit */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '640px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Review Application Summary</h3>
              
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Location: </span>
                    <span>{formData.village}, {formData.taluka}, {formData.district}, {formData.state}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Survey / Subdivision: </span>
                    <span>No. {formData.survey_number} / {formData.subdivision}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Jurisdiction: </span>
                    <span>#{formData.jurisdiction_id}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Boundary Vertices: </span>
                    <span>{polygonCoordinates.length} nodes (OGC Valid)</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Attached Documents: </span>
                    <span>{Object.keys(uploadedFiles).length} files staged</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
                <button className="btn-secondary" onClick={() => setStep(3)}>
                  Back
                </button>
                <button className="btn-primary" onClick={handleSubmitApplication}>
                  Submit Application for Review
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: MY APPLICATIONS & REGISTERED LANDS */}
      {activeTab === 'applications' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>My Submitted Applications & Registered Titles</h3>
            <button className="btn-secondary" onClick={loadData} title="Refresh">
              <RefreshCw size={15} />
            </button>
          </div>

          {loadingList ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Loading records...</div>
          ) : myApplications.length === 0 ? (
            <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              You haven't submitted any land applications yet. Use the "Register New Land" tab to get started.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {myApplications.map((app) => (
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                        {app.village} - Survey #{app.survey_number}/{app.subdivision}
                      </span>
                      <span className={`badge ${app.status === 'APPROVED' ? 'badge-verified' : app.status === 'REJECTED' ? 'badge-danger' : 'badge-pending'}`}>
                        {app.status}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <div>Application ID: <span style={{ fontFamily: 'monospace' }}>{app.id}</span></div>
                      <div>Parcel Key: <span style={{ fontFamily: 'monospace' }}>{app.parcel_key}</span></div>
                      <div>Area: {app.area_sq_meters.toFixed(2)} sq meters</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <button
                      className="btn-secondary"
                      onClick={() => handleVerifyTamper(app.id)}
                      style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                      <FileCheck size={15} />
                      Verify Integrity
                    </button>

                    {app.status === 'APPROVED' && (
                      <button
                        className="btn-primary"
                        onClick={() => handleMintOnChain(app)}
                        style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                      >
                        <ShieldCheck size={15} />
                        Mint Title On-Chain
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tamper Verification Drawer */}
          {tamperReport && (
            <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid var(--brand-accent)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h4 style={{ fontWeight: 600, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ShieldCheck size={18} color="var(--brand-accent)" />
                  Cryptographic Integrity Verification Audit
                </h4>
                <button className="btn-secondary" style={{ padding: '0.25rem 0.5rem' }} onClick={() => setTamperReport(null)}>
                  Close
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.85rem' }}>
                <div>Status: <span className={`badge ${tamperReport.status === 'INTACT' ? 'badge-verified' : 'badge-danger'}`}>{tamperReport.status}</span></div>
                <div>Manifest Integrity: <span style={{ fontWeight: 600 }}>{tamperReport.manifest_integrity}</span></div>
                <div>Total Documents Verified: <span>{tamperReport.total_documents}</span></div>
                <div>Tampered Files Detected: <span style={{ color: tamperReport.tampered_count > 0 ? 'var(--brand-danger)' : 'var(--brand-success)' }}>{tamperReport.tampered_count}</span></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: TRANSFER ESCROWS */}
      {activeTab === 'escrows' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Pull payment withdrawal banner */}
          {Number(pendingWithdrawal) > 0 && (
            <div
              className="glass-panel"
              style={{
                padding: '1.5rem',
                border: '1px solid var(--brand-success)',
                background: 'rgba(16, 185, 129, 0.08)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--brand-success)' }}>
                  Settled Escrow Funds Ready for Withdrawal!
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  You have a pending pull-payment balance of <strong>{pendingWithdrawal} ETH</strong> in <code style={{ color: 'var(--brand-accent)' }}>TransferEscrow.sol</code>.
                </div>
              </div>
              <button className="btn-primary" onClick={handleWithdrawFunds}>
                Withdraw {pendingWithdrawal} ETH
              </button>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Active Transfer Escrows</h3>
            <button className="btn-secondary" onClick={loadData} title="Refresh">
              <RefreshCw size={15} />
            </button>
          </div>

          {loadingList ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Loading escrows...</div>
          ) : myEscrows.length === 0 ? (
            <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              No active transfer escrows found for your verified identity.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {myEscrows.map((escrow) => {
                const isBuyer = escrow.buyer_identity_id === user?.identity_id;
                return (
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
                        <span className="badge badge-accent">{isBuyer ? 'Buyer' : 'Seller'}</span>
                      </div>

                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <div>Agreed Purchase Price: <strong>{escrow.agreed_price} ETH</strong></div>
                        <div>Deposit Status: {escrow.deposit_amount} ETH funded</div>
                        <div>Expires: {new Date(escrow.expires_at).toLocaleString()}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      {isBuyer && escrow.state === 'REQUESTED' && (
                        <button className="btn-primary" onClick={() => handleFundEscrow(escrow)}>
                          Deposit {escrow.agreed_price} ETH
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
