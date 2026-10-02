import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import AuthModal from './components/AuthModal';
import PublicMarketplace from './components/PublicMarketplace';
import CitizenPortal from './components/CitizenPortal';
import InspectorPortal from './components/InspectorPortal';
import AdminPortal from './components/AdminPortal';
import { api } from './services/api';
import { web3Service } from './services/web3';

export default function App() {
  const [activeTab, setActiveTab] = useState('marketplace'); // 'marketplace' | 'citizen' | 'inspector' | 'admin'
  const [user, setUser] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ isSynced: true, blockNumber: 0 });

  // Load existing session on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('cadastra_user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.warn('Could not parse stored user session');
      }
    }

    // Monitor Indexer health
    const checkSync = async () => {
      try {
        const statuses = await api.getSyncStatus();
        if (statuses && statuses.length > 0) {
          const maxBlock = Math.max(...statuses.map((s) => s.last_processed_block));
          setSyncStatus({ isSynced: true, blockNumber: maxBlock });
        }
      } catch (err) {
        // Fallback
        setSyncStatus((prev) => ({ ...prev, isSynced: true }));
      }
    };

    checkSync();
    const interval = setInterval(checkSync, 15000);
    return () => clearInterval(interval);
  }, []);

  // Listen for MetaMask account changes
  useEffect(() => {
    if (typeof window !== 'undefined' && window.ethereum) {
      const handleAccountsChanged = (accounts) => {
        if (!accounts || accounts.length === 0) {
          handleLogout();
        } else if (user && user.active_wallet && accounts[0].toLowerCase() !== user.active_wallet.toLowerCase()) {
          console.warn('MetaMask account changed, re-authentication recommended.');
        }
      };

      window.ethereum.on('accountsChanged', handleAccountsChanged);
      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      };
    }
  }, [user]);

  const handleAuthSuccess = (authenticatedUser) => {
    setUser(authenticatedUser);
    localStorage.setItem('cadastra_user', JSON.stringify(authenticatedUser));
    setAuthModalOpen(false);

    // Auto-route based on role
    if (authenticatedUser.role === 'ADMIN') {
      setActiveTab('admin');
    } else if (['INSPECTOR', 'SENIOR_INSPECTOR', 'REGISTRAR'].includes(authenticatedUser.role)) {
      setActiveTab('inspector');
    } else {
      setActiveTab('citizen');
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('cadastra_user');
    localStorage.removeItem('cadastra_jwt_token');
    api.setToken(null);
    setActiveTab('marketplace');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        user={user}
        onOpenAuth={() => setAuthModalOpen(true)}
        onLogout={handleLogout}
        syncStatus={syncStatus}
      />

      <main style={{ flex: 1, padding: '2rem 1.5rem', maxWidth: '1280px', width: '100%', margin: '0 auto' }}>
        {activeTab === 'marketplace' && (
          <PublicMarketplace
            user={user}
            onConnectWallet={() => setAuthModalOpen(true)}
          />
        )}

        {activeTab === 'citizen' && (
          <CitizenPortal
            user={user}
            onConnectWallet={() => setAuthModalOpen(true)}
          />
        )}

        {activeTab === 'inspector' && (
          <InspectorPortal
            user={user}
            onConnectWallet={() => setAuthModalOpen(true)}
          />
        )}

        {activeTab === 'admin' && (
          <AdminPortal
            user={user}
            onConnectWallet={() => setAuthModalOpen(true)}
          />
        )}
      </main>

      <footer style={{ borderTop: '1px solid var(--border-color)', padding: '2rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', background: 'rgba(10, 15, 29, 0.6)' }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <div>
            <strong>Cadastra</strong> - Hierarchical Blockchain Land Registry with EIP-4361 SIWE & PostGIS Spatial Integrity.
          </div>
          <div>
            Target Network: <span style={{ color: 'var(--brand-accent)' }}>Ethereum Sepolia (Chain ID 11155111)</span>
          </div>
        </div>
      </footer>

      {/* Auth & KYC Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />
    </div>
  );
}
