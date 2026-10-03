import React from 'react';
import { 
  ShieldCheck, 
  MapPin, 
  Building2, 
  UserCheck, 
  Wallet, 
  LogOut, 
  Activity, 
  Layers, 
  Compass,
  FileText
} from 'lucide-react';

export default function Header({ 
  currentPortal, 
  setCurrentPortal, 
  activeTab,
  setActiveTab,
  walletAddress, 
  currentUser, 
  user,
  onConnectWallet, 
  onOpenAuth,
  onDisconnectWallet, 
  onLogout,
  networkChainId,
  indexerLag = 0,
  syncStatus
}) {
  const portal = activeTab || currentPortal || 'marketplace';
  const setPortal = setActiveTab || setCurrentPortal || (() => {});
  const activeUser = user || currentUser;
  const address = activeUser?.active_wallet || walletAddress;
  const connectAction = onOpenAuth || onConnectWallet || (() => {});
  const disconnectAction = onLogout || onDisconnectWallet || (() => {});

  const chainId = networkChainId || 11155111;
  const isSepolia = chainId === 11155111;
  const isLocal = chainId === 31337;
  const lag = syncStatus !== undefined ? (syncStatus.isSynced ? 0 : 1) : indexerLag;

  return (
    <header className="glass-panel" style={{ margin: '16px 24px', padding: '14px 24px', borderRadius: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        
        {/* Brand Logo & Tagline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer' }} onClick={() => setPortal('marketplace')}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #10b981, #06b6d4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 18px rgba(16, 185, 129, 0.4)'
          }}>
            <Layers size={22} color="#ffffff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.35rem', fontWeight: '800', letterSpacing: '-0.03em', background: 'linear-gradient(to right, #ffffff, #cbd5e1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                CADASTRA
              </span>
              <span className="badge badge-verified" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
                v1.0 Sepolia
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
              Hierarchical Blockchain Land Registry & Escrow
            </p>
          </div>
        </div>

        {/* Portal Navigation Tabs */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(15, 23, 42, 0.5)', padding: '6px', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
          <button 
            className={`btn ${portal === 'marketplace' ? 'btn-primary' : 'btn-outline'}`}
            style={{ padding: '8px 14px', fontSize: '0.85rem' }}
            onClick={() => setPortal('marketplace')}
          >
            <Compass size={16} /> Explorer
          </button>
          
          <button 
            className={`btn ${portal === 'citizen' ? 'btn-primary' : 'btn-outline'}`}
            style={{ padding: '8px 14px', fontSize: '0.85rem' }}
            onClick={() => setPortal('citizen')}
          >
            <FileText size={16} /> Landowner
          </button>

          <button 
            className={`btn ${portal === 'inspector' ? 'btn-primary' : 'btn-outline'}`}
            style={{ padding: '8px 14px', fontSize: '0.85rem' }}
            onClick={() => setPortal('inspector')}
          >
            <UserCheck size={16} /> Inspector
          </button>

          <button 
            className={`btn ${portal === 'admin' ? 'btn-primary' : 'btn-outline'}`}
            style={{ padding: '8px 14px', fontSize: '0.85rem' }}
            onClick={() => setPortal('admin')}
          >
            <Building2 size={16} /> Governance
          </button>
        </nav>

        {/* Network, Indexer Sync & Wallet Connect */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          
          {/* Indexer Sync Indicator */}
          <div className="badge badge-network" title={`Indexer lag: ${lag} blocks`} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'default' }}>
            <div className="pulse-dot" style={{ backgroundColor: lag === 0 ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}></div>
            <span>{lag === 0 ? 'Synced' : `Lag: ${lag} blk`}</span>
          </div>

          {/* Network Pill */}
          <div className="badge" style={{
            background: isSepolia ? 'rgba(99, 102, 241, 0.15)' : 'rgba(245, 158, 11, 0.15)',
            color: isSepolia ? '#a5b4fc' : '#fbbf24',
            border: `1px solid ${isSepolia ? 'rgba(99, 102, 241, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`
          }}>
            <Activity size={12} />
            <span>{isSepolia ? 'Sepolia 11155111' : isLocal ? 'Hardhat 31337' : `Chain ${chainId}`}</span>
          </div>

          {/* Wallet / Auth Action */}
          {address ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                padding: '6px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <ShieldCheck size={16} color="var(--accent-emerald)" />
                <span className="mono" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  {address.substring(0, 6)}...{address.substring(address.length - 4)}
                </span>
                {activeUser?.role && (
                  <span className="badge badge-verified" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                    {activeUser.role}
                  </span>
                )}
              </div>
              <button 
                className="btn btn-outline" 
                style={{ padding: '8px 10px' }} 
                onClick={disconnectAction}
                title="Disconnect Wallet & Logout"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={connectAction}>
              <Wallet size={16} /> Connect Wallet
            </button>
          )}

        </div>

      </div>
    </header>
  );
}
