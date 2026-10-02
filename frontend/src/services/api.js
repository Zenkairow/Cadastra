/**
 * Cadastra API Client
 * Connects directly to the FastAPI REST backend (/api/v1)
 */

const API_BASE = '/api/v1';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('cadastra_jwt_token') || null;
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('cadastra_jwt_token', token);
    } else {
      localStorage.removeItem('cadastra_jwt_token');
    }
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        let errorDetail = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errData = await response.json();
          errorDetail = errData.detail || errorDetail;
        } catch {
          // keep fallback
        }
        throw new Error(errorDetail);
      }

      return await response.json();
    } catch (err) {
      console.error(`API Error [${endpoint}]:`, err.message);
      throw err;
    }
  }

  // --- Authentication & KYC Endpoints ---
  async getNonce(walletAddress) {
    return this.request(`/auth/nonce?wallet_address=${encodeURIComponent(walletAddress)}`);
  }

  async verifySignature(message, signature) {
    const data = await this.request('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ message, signature }),
    });
    if (data.access_token) {
      this.setToken(data.access_token);
    }
    return data;
  }

  async verifyKYC(nationalIdNumber, fullName) {
    return this.request('/auth/kyc/verify', {
      method: 'POST',
      body: JSON.stringify({ national_id_number: nationalIdNumber, full_name: fullName }),
    });
  }

  // --- Land Application Endpoints ---
  async createDraftApplication(appData) {
    return this.request('/applications/draft', {
      method: 'POST',
      body: JSON.stringify(appData),
    });
  }

  async getApplications(jurisdictionId = null, status = null) {
    const params = new URLSearchParams();
    if (jurisdictionId) params.append('jurisdiction_id', jurisdictionId);
    if (status) params.append('status_filter', status);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/applications${query}`);
  }

  async reviewApplication(applicationId, decision, reason = '') {
    return this.request(`/applications/${applicationId}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, reason }),
    });
  }

  // --- Land Read Model Endpoints ---
  async getLands(page = 1, size = 50, jurisdictionId = null, status = null) {
    const params = new URLSearchParams({ page, size });
    if (jurisdictionId) params.append('jurisdiction_id', jurisdictionId);
    if (status) params.append('status_filter', status);
    return this.request(`/lands?${params.toString()}`);
  }

  async getLandById(landId) {
    return this.request(`/lands/${landId}`);
  }

  // --- Escrow Read Model Endpoints ---
  async getEscrows(filters = {}) {
    const params = new URLSearchParams();
    if (filters.landId) params.append('land_id', filters.landId);
    if (filters.state) params.append('state', filters.state);
    if (filters.buyerIdentityId) params.append('buyer_identity_id', filters.buyerIdentityId);
    if (filters.sellerIdentityId) params.append('seller_identity_id', filters.sellerIdentityId);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/escrows${query}`);
  }

  async getEscrowById(requestId) {
    return this.request(`/escrows/${requestId}`);
  }

  // --- System & Audit Endpoints ---
  async getSyncStatus() {
    return this.request('/system/sync-status');
  }

  async getAuditLogs(limit = 50) {
    return this.request(`/system/audit-logs?limit=${limit}`);
  }

  async triggerReconciliation() {
    return this.request('/system/reconcile', { method: 'POST' });
  }


  // --- Geospatial & Maps Endpoints ---
  async validatePolygon(geojson) {
    return this.request('/geospatial/validate', {
      method: 'POST',
      body: JSON.stringify({ geojson }),
    });
  }

  async checkOverlap(geojson, excludeAppId = null) {
    return this.request('/geospatial/check-overlap', {
      method: 'POST',
      body: JSON.stringify({
        geojson,
        exclude_application_id: excludeAppId,
      }),
    });
  }

  async getParcelsFeatureCollection(bbox = null, jurisdictionId = null) {
    const params = new URLSearchParams();
    if (bbox) {
      params.append('min_lon', bbox.min_lon);
      params.append('min_lat', bbox.min_lat);
      params.append('max_lon', bbox.max_lon);
      params.append('max_lat', bbox.max_lat);
    }
    if (jurisdictionId) params.append('jurisdiction_id', jurisdictionId);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/geospatial/parcels${query}`);
  }

  async verifyGeometryIntegrity(parcelId) {
    return this.request(`/geospatial/verify-integrity/${parcelId}`, {
      method: 'POST',
    });
  }

  // --- Documents & Storage Endpoints ---
  async uploadDocument(applicationId, documentType, file) {
    const formData = new FormData();
    formData.append('document_type', documentType);
    formData.append('file', file);

    const headers = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_BASE}/documents/upload/${applicationId}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || 'Document upload failed');
    }
    return await response.json();
  }

  async getDocumentManifest(applicationId) {
    return this.request(`/documents/manifest/${applicationId}`);
  }

  async getDocumentDownloadUrl(documentId) {
    return this.request(`/documents/download/${documentId}`);
  }

  async verifyDocumentTamper(applicationId) {
    return this.request(`/documents/verify/${applicationId}`);
  }

  // --- Health & Network ---
  async getHealth() {
    const res = await fetch('/health');
    return await res.json();
  }
}

export const api = new ApiClient();
