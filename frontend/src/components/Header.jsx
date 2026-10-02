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
  walletAddress, 
  currentUser, 
  onConnectWallet, 
  onDisconnectWallet, 
  networkChainId,
  indexerLag = 0
}) {
  const isSepolia = networkChainId === 11155111;
  const isLocal = networkChainId === 31337;

  return (
    <header className="glass-panel" style={{ margin: '16px 24px', padding: '14px 24px', borderRadius: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        
        {/* Brand Logo & Tagline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer' }} onClick={() => setCurrentPortal('marketplace')}>
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
            className={`btn ${currentPortal === 'marketplace' ? 'btn-primary' : 'btn-outline'}`}
            style={{ padding: '8px 14px', fontSize: '0.85rem' }}
            onClick={() => setCurrentPortal('marketplace')}
          >
            <Compass size={16} /> Explorer
          </button>
          
          <button 
            className={`btn ${currentPortal === 'citizen' ? 'btn-primary' : 'btn-outline'}`}
            style={{ padding: '8px 14px', fontSize: '0.85rem' }}
            onClick={() => setCurrentPortal('citizen')}
          >
            <FileText size={16} /> Landowner
          </button>

          <button 
            className={`btn ${currentPortal === 'inspector' ? 'btn-primary' : 'btn-outline'}`}
            style={{ padding: '8px 14px', fontSize: '0.85rem' }}
            onClick={() => setCurrentPortal('inspector')}
          >
            <UserCheck size={16} /> Inspector
          </button>

          <button 
            className={`btn ${currentPortal === 'admin' ? 'btn-primary' : 'btn-outline'}`}
            style={{ padding: '8px 14px', fontSize: '0.85rem' }}
            onClick={() => setCurrentPortal('admin')}
          >
            <Building2 size={16} /> Governance
          </button>
        </nav>

        {/* Network, Indexer Sync & Wallet Connect */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          
          {/* Indexer Sync Indicator */}
          <div className="badge badge-network" title={`Indexer lag: ${indexerLag} blocks`} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'default' }}>
            <div className="pulse-dot" style={{ backgroundColor: indexerLag === 0 ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}></div>
            <span>{indexerLag === 0 ? 'Synced' : `Lag: ${indexerLag} blk`}</span>
          </div>

          {/* Network Pill */}
          <div className="badge" style={{
            background: isSepolia ? 'rgba(99, 102, 241, 0.15)' : 'rgba(245, 158, 11, 0.15)',
            color: isSepolia ? '#a5b4fc' : '#fbbf24',
            border: `1px solid ${isSepolia ? 'rgba(99, 102, 241, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`
          }}>
            <Activity size={12} />
            <span>{isSepolia ? 'Sepolia 11155111' : isLocal ? 'Hardhat 31337' : 'Unknown Chain'}</span>
          </div>

          {/* Wallet / Auth Action */}
          {walletAddress ? (
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
                  {walletAddress.substring(0, 6)}...{walletAddress.substring(walletAddress.length - 4)}
                </span>
                {currentUser?.role && (
                  <span className="badge badge-verified" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                    {currentUser.role}
                  </span>
                )}
              </div>
              <button 
                className="btn btn-outline" 
                style={{ padding: '8px 10px' }} 
                onClick={onDisconnectWallet}
                title="Disconnect Wallet & Logout"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={onConnectWallet}>
              <Wallet size={16} /> Connect Wallet
            </button>
          )}

        </div>

      </div>
    </header>
  );
}
