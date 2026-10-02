import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Users,
  Database,
  Activity,
  UserPlus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  Server
} from 'lucide-react';
import { api } from '../services/api';
import { web3Service } from '../services/web3';
import TransactionModal from './TransactionModal';

export default function AdminPortal({ user, onConnectWallet }) {
  const [activeTab, setActiveTab] = useState('inspectors'); // 'inspectors' | 'sync' | 'tamper' | 'audit'

  // Governance State
  const [newInspector, setNewInspector] = useState({
    wallet: '',
    level: 3, // FIELD_INSPECTOR
    jurisdiction_id: 101,
    validity_days: 365,
  });

  // Sync and Audit State
  const [syncStates, setSyncStates] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [reconciliationReport, setReconciliationReport] = useState(null);
  const [loading, setLoading] = useState(false);

  // Tamper Lab State
  const [testAppId, setTestAppId] = useState('');
  const [tamperResult, setTamperResult] = useState(null);

  // Web3 Tx Modal
  const [txModal, setTxModal] = useState({
    isOpen: false,
    status: 'pending',
    title: '',
    message: '',
    txHash: null,
    errorMessage: null,
  });

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const sync = await api.getSyncStatus();
      setSyncStates(sync || []);

      const logs = await api.getAuditLogs(30);
      setAuditLogs(logs || []);
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  // Appoint Inspector On-Chain
  const handleAppointInspector = async (e) => {
    e.preventDefault();
    try {
      await web3Service.ensureSepoliaNetwork();
      setTxModal({
        isOpen: true,
        status: 'pending',
        title: 'Appointing Inspector On-Chain',
        message: `Calling appointInspector for ${newInspector.wallet.slice(0, 8)}... at Level ${newInspector.level} on Sepolia.`,
        txHash: null,
      });

      const inspectorRegistry = web3Service.getInspectorRegistry();
      const validUntil = Math.floor(Date.now() / 1000) + Number(newInspector.validity_days) * 86400;

      const tx = await inspectorRegistry.appointInspector(
        newInspector.wallet,
        Number(newInspector.level),
        Number(newInspector.jurisdiction_id),
        validUntil
      );

      setTxModal((prev) => ({ ...prev, txHash: tx.hash, message: 'Awaiting block confirmation on Sepolia...' }));
      const receipt = await tx.wait(1);

      setTxModal({
        isOpen: true,
        status: 'success',
        title: 'Inspector Appointed',
        message: `Inspector role assigned in block #${receipt.blockNumber}! Access granted for Jurisdiction #${newInspector.jurisdiction_id}.`,
        txHash: receipt.hash,
      });

      setNewInspector({ wallet: '', level: 3, jurisdiction_id: 101, validity_days: 365 });
      loadAdminData();
    } catch (err) {
      console.error('Appoint failed:', err);
      setTxModal({
        isOpen: true,
        status: 'error',
        title: 'Appointment Failed',
        errorMessage: err.reason || err.message,
      });
    }
  };

  // Revoke Inspector On-Chain
  const handleRevokeInspector = async (walletAddress) => {
    if (!confirm(`Are you sure you want to revoke inspector ${walletAddress}?`)) return;

    try {
      await web3Service.ensureSepoliaNetwork();
      setTxModal({
        isOpen: true,
        status: 'pending',
        title: 'Revoking Inspector Role',
        message: `Submitting revokeInspector on Sepolia...`,
        txHash: null,
      });

      const inspectorRegistry = web3Service.getInspectorRegistry();
      const tx = await inspectorRegistry.revokeInspector(walletAddress);
      setTxModal((prev) => ({ ...prev, txHash: tx.hash, message: 'Awaiting block confirmation...' }));
      const receipt = await tx.wait(1);

      setTxModal({
        isOpen: true,
        status: 'success',
        title: 'Inspector Revoked',
        message: `Inspector access revoked in block #${receipt.blockNumber}.`,
        txHash: receipt.hash,
      });

      loadAdminData();
    } catch (err) {
      console.error('Revoke failed:', err);
      setTxModal({
        isOpen: true,
        status: 'error',
        title: 'Revocation Failed',
        errorMessage: err.reason || err.message,
      });
    }
  };

  // Trigger Self-Healing Reconciliation
  const handleTriggerReconcile = async () => {
    setLoading(true);
    try {
      const res = await api.triggerReconciliation();
      setReconciliationReport(res);
      loadAdminData();
    } catch (err) {
      alert(`Reconciliation failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Run Tamper Lab Check
  const handleRunTamperCheck = async (e) => {
    e.preventDefault();
    if (!testAppId) return;
    try {
      const res = await api.verifyDocumentTamper(testAppId);
      setTamperResult(res);
    } catch (err) {
      alert(`Tamper check failed: ${err.message}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        <button
          className={activeTab === 'inspectors' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('inspectors')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Users size={16} />
          Inspector Governance
        </button>
        <button
          className={activeTab === 'sync' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('sync')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Activity size={16} />
          Indexer Sync & Health
        </button>
        <button
          className={activeTab === 'tamper' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('tamper')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <FileCheck size={16} />
          Tamper Detection Lab
        </button>
        <button
          className={activeTab === 'audit' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('audit')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Database size={16} />
          System Audit Logs
        </button>
      </div>

      {/* TAB 1: INSPECTOR GOVERNANCE */}
      {activeTab === 'inspectors' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem' }}>
          <div className="glass-panel" style={{ padding: '2rem', maxWidth: '640px' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UserPlus size={18} color="var(--brand-accent)" />
              Appoint Official Inspector
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              Enforces 4-tier cryptographic access hierarchy. Grants review or senior escrow approval capabilities within the specified jurisdiction.
            </p>

            <form onSubmit={handleAppointInspector} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                  Inspector Wallet Address (0x...)
                </label>
                <input
                  type="text"
                  required
                  placeholder="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
                  value={newInspector.wallet}
                  onChange={(e) => setNewInspector({ ...newInspector, wallet: e.target.value })}
                  style={{ width: '100%', fontFamily: 'monospace' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                    Role Tier
                  </label>
                  <select
                    value={newInspector.level}
                    onChange={(e) => setNewInspector({ ...newInspector, level: Number(e.target.value) })}
                    style={{ width: '100%' }}
                  >
                    <option value={1}>Tier 1: Registrar</option>
                    <option value={2}>Tier 2: Senior Inspector</option>
                    <option value={3}>Tier 3: Field Inspector</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                    Jurisdiction ID
                  </label>
                  <input
                    type="number"
                    required
                    value={newInspector.jurisdiction_id}
                    onChange={(e) => setNewInspector({ ...newInspector, jurisdiction_id: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                  Validity Duration (Days)
                </label>
                <input
                  type="number"
                  required
                  value={newInspector.validity_days}
                  onChange={(e) => setNewInspector({ ...newInspector, validity_days: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button type="submit" className="btn-primary">
                  Appoint Inspector On-Chain
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TAB 2: INDEXER SYNC & HEALTH */}
      {activeTab === 'sync' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Indexer Sync Lag & State Machine Health</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Confirmation-aware background daemon monitoring Sepolia block events with idempotent persistence.
              </p>
            </div>
            <button
              className="btn-primary"
              onClick={handleTriggerReconcile}
              disabled={loading}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              Run Self-Healing Reconciliation
            </button>
          </div>

          {/* Sync Status Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
            {syncStates.map((state) => (
              <div key={state.contract_address} className="glass-panel" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--brand-accent)' }}>{state.contract_name}</span>
                  <span className="badge badge-verified">LIVE</span>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  <div>Last Processed Block: <strong style={{ color: 'var(--text-primary)' }}>#{state.last_processed_block}</strong></div>
                  <div>Chain ID: <strong>{state.chain_id} (Sepolia)</strong></div>
                  <div>Contract Address: <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{state.contract_address}</span></div>
                </div>
              </div>
            ))}
          </div>

          {/* Reconciliation Report */}
          {reconciliationReport && (
            <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid var(--brand-success)' }}>
              <h4 style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.5rem', color: 'var(--brand-success)' }}>
                Reconciliation Audit Completed
              </h4>
              <pre style={{ fontSize: '0.85rem', background: 'rgba(0,0,0,0.4)', padding: '1rem', borderRadius: '6px', overflowX: 'auto' }}>
                {JSON.stringify(reconciliationReport, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: TAMPER DETECTION LAB */}
      {activeTab === 'tamper' && (
        <div className="glass-panel" style={{ padding: '2rem', maxWidth: '680px' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileCheck size={18} color="var(--brand-accent)" />
            Tamper Detection & Forensic Integrity Engine
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            Tests and confirms cryptographic detection across all corruption profiles: bitwise corruption, file swapping, deletion, and unsigned injection.
          </p>

          <form onSubmit={handleRunTamperCheck} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <input
              type="text"
              required
              placeholder="Enter Application UUID (e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6)"
              value={testAppId}
              onChange={(e) => setTestAppId(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn-primary">
              Run Integrity Audit
            </button>
          </form>

          {tamperResult && (
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ fontWeight: 600 }}>Forensic Status:</span>
                <span className={`badge ${tamperResult.status === 'INTACT' ? 'badge-verified' : 'badge-danger'}`}>
                  {tamperResult.status}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <div>Total Documents Inspected: {tamperResult.total_documents}</div>
                <div>Tampered Documents: {tamperResult.tampered_count}</div>
                <div>Manifest Integrity: {tamperResult.manifest_integrity}</div>
                <div>Storage Hash: <code style={{ color: 'var(--brand-accent)' }}>{tamperResult.computed_storage_manifest_hash}</code></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: SYSTEM AUDIT LOGS */}
      {activeTab === 'audit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Immutable System Audit Trail</h3>
            <button className="btn-secondary" onClick={loadAdminData} title="Refresh">
              <RefreshCw size={15} />
            </button>
          </div>

          <div className="glass-panel" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '0.75rem 1rem' }}>Timestamp</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Action</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Actor Identity</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)' }}>
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--brand-accent)' }}>
                        {log.action}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace' }}>
                        {log.actor_identity_id ? `${log.actor_identity_id.slice(0, 10)}...` : 'System Daemon'}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                        {log.details ? JSON.stringify(log.details).slice(0, 50) + '...' : '-'}
                      </td>
                    </tr>
                  ))}
                  {auditLogs.length === 0 && (
                    <tr>
                      <td colSpan="4" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        No audit log entries recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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
      />
    </div>
  );
}
