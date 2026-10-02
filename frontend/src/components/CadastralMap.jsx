import React, { useState, useEffect, useRef } from 'react';
import { 
  Layers, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  MousePointer, 
  PenTool, 
  AlertTriangle, 
  CheckCircle2, 
  Info,
  Maximize2
} from 'lucide-react';
import { api } from '../services/api';

export default function CadastralMap({ 
  mode = 'view', // 'view' or 'draw'
  onPolygonCreated = null, 
  highlightParcelId = null,
  overlays = [],
  height = '500px'
}) {
  const canvasRef = useRef(null);
  const [parcels, setParcels] = useState([]);
  const [selectedParcel, setSelectedParcel] = useState(null);
  const [drawnPoints, setDrawnPoints] = useState([]);
  const [isDrawing, setIsDrawing] = useState(mode === 'draw');
  const [loading, setLoading] = useState(false);

  // Map view transform state (centered on Pune: lon 73.856, lat 18.520)
  const [center, setCenter] = useState({ lon: 73.8567, lat: 18.5204 });
  const [zoom, setZoom] = useState(16); // scale factor

  // Dragging / panning state
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Fetch registered parcels from backend on load
  useEffect(() => {
    fetchParcels();
  }, []);

  const fetchParcels = async () => {
    setLoading(true);
    try {
      const data = await api.getParcelsFeatureCollection();
      if (data && data.features) {
        setParcels(data.features);
      }
    } catch (err) {
      console.warn('Could not fetch parcels from backend, using fallback demo parcels:', err.message);
      // Fallback demo parcels for interactive testing
      setParcels([
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [73.856000, 18.520000],
              [73.856379, 18.520000],
              [73.856379, 18.520270],
              [73.856000, 18.520270],
              [73.856000, 18.520000]
            ]]
          },
          properties: {
            boundary_id: 'DEMO-101',
            on_chain_land_id: 101,
            area_sq_meters: 1200.5,
            geometry_hash: '0x7ba3ac1ae77c66b1c375c693b6ae6d40afa8300156033a3fc7656808053b568d',
            status: 'VERIFIED'
          }
        },
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [73.856000, 18.520270],
              [73.856379, 18.520270],
              [73.856379, 18.520540],
              [73.856000, 18.520540],
              [73.856000, 18.520270]
            ]]
          },
          properties: {
            boundary_id: 'DEMO-102',
            on_chain_land_id: 102,
            area_sq_meters: 1200.0,
            geometry_hash: '0x88f28c2e718b52f1a65d19fb09e13d964f7b2e1a3c6d9a8f2e1a3c6d9a8f2e1a',
            status: 'VERIFIED'
          }
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Convert Lon/Lat to Canvas Screen Coordinates
  const geoToScreen = (lon, lat, width, height) => {
    const scale = Math.pow(2, zoom) * 80;
    const x = width / 2 + (lon - center.lon) * scale;
    const y = height / 2 - (lat - center.lat) * scale;
    return { x, y };
  };

  // Convert Screen Coordinates back to Lon/Lat
  const screenToGeo = (x, y, width, height) => {
    const scale = Math.pow(2, zoom) * 80;
    const lon = center.lon + (x - width / 2) / scale;
    const lat = center.lat - (y - height / 2) / scale;
    return { 
      lon: Math.round(lon * 1000000) / 1000000, 
      lat: Math.round(lat * 1000000) / 1000000 
    };
  };

  // Render Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // 1. Clear background
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, width, height);

    // 2. Draw subtle cadastral survey grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // 3. Draw registered parcels
    parcels.forEach((feature) => {
      const coords = feature.geometry?.coordinates?.[0];
      if (!coords || coords.length < 3) return;

      const isSelected = selectedParcel && selectedParcel.properties?.boundary_id === feature.properties?.boundary_id;
      const isHighlighted = highlightParcelId && (feature.properties?.on_chain_land_id === highlightParcelId || feature.properties?.boundary_id === highlightParcelId);

      ctx.beginPath();
      coords.forEach((pt, idx) => {
        const { x, y } = geoToScreen(pt[0], pt[1], width, height);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();

      // Style parcel
      if (isSelected || isHighlighted) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2.5;
      } else {
        ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.6)';
        ctx.lineWidth = 1.5;
      }
      ctx.fill();
      ctx.stroke();

      // Label parcel ID in center
      const centerScreen = geoToScreen(coords[0][0], coords[0][1], width, height);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(
        `#${feature.properties?.on_chain_land_id || feature.properties?.boundary_id?.substring(0, 6)}`,
        centerScreen.x + 8,
        centerScreen.y - 8
      );
    });

    // 4. Draw overlays (e.g. conflicting parcels in inspector view)
    overlays.forEach((ov) => {
      if (!ov.coordinates) return;
      ctx.beginPath();
      ov.coordinates.forEach((pt, idx) => {
        const { x, y } = geoToScreen(pt[0], pt[1], width, height);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = ov.isConflict ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.25)';
      ctx.strokeStyle = ov.isConflict ? '#ef4444' : '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // 5. Draw active drawing path (Citizen Land Registration)
    if (drawnPoints.length > 0) {
      ctx.beginPath();
      drawnPoints.forEach((pt, idx) => {
        const { x, y } = geoToScreen(pt[0], pt[1], width, height);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      if (drawnPoints.length >= 3 && drawnPoints[0][0] === drawnPoints[drawnPoints.length - 1][0]) {
        ctx.closePath();
        ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
        ctx.fill();
      }

      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw vertex handles
      drawnPoints.forEach((pt, idx) => {
        const { x, y } = geoToScreen(pt[0], pt[1], width, height);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = idx === 0 ? '#34d399' : '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }

  }, [parcels, selectedParcel, drawnPoints, center, zoom, overlays, highlightParcelId]);

  // Handle Canvas Click (Select Parcel or Draw Vertex)
  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (isDrawing) {
      const geo = screenToGeo(mouseX, mouseY, canvas.width, canvas.height);
      const newPoints = [...drawnPoints, [geo.lon, geo.lat]];
      
      // If clicking near the first point after 3 points, auto-close!
      if (drawnPoints.length >= 3) {
        const firstPt = geoToScreen(drawnPoints[0][0], drawnPoints[0][1], canvas.width, canvas.height);
        const dist = Math.hypot(mouseX - firstPt.x, mouseY - firstPt.y);
        if (dist < 15) {
          const closed = [...drawnPoints, drawnPoints[0]];
          setDrawnPoints(closed);
          if (onPolygonCreated) onPolygonCreated(closed);
          return;
        }
      }

      setDrawnPoints(newPoints);
      if (newPoints.length >= 4 && onPolygonCreated) {
        onPolygonCreated([...newPoints, newPoints[0]]);
      }
    } else {
      // Find clicked parcel
      const clickedGeo = screenToGeo(mouseX, mouseY, canvas.width, canvas.height);
      const found = parcels.find((f) => {
        const coords = f.geometry?.coordinates?.[0];
        if (!coords) return false;
        // Simple bounding box check
        const lons = coords.map((c) => c[0]);
        const lats = coords.map((c) => c[1]);
        return (
          clickedGeo.lon >= Math.min(...lons) &&
          clickedGeo.lon <= Math.max(...lons) &&
          clickedGeo.lat >= Math.min(...lats) &&
          clickedGeo.lat <= Math.max(...lats)
        );
      });
      setSelectedParcel(found || null);
    }
  };

  // Mouse drag pan handlers
  const handleMouseDown = (e) => {
    if (e.button === 0 && !isDrawing) {
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseMove = (e) => {
    if (isDraggingRef.current) {
      const canvas = canvasRef.current;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      dragStartRef.current = { x: e.clientX, y: e.clientY };

      const scale = Math.pow(2, zoom) * 80;
      setCenter((prev) => ({
        lon: prev.lon - dx / scale,
        lat: prev.lat + dy / scale,
      }));
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const clearDrawing = () => {
    setDrawnPoints([]);
    if (onPolygonCreated) onPolygonCreated([]);
  };

  const closePolygon = () => {
    if (drawnPoints.length >= 3) {
      const closed = [...drawnPoints, drawnPoints[0]];
      setDrawnPoints(closed);
      if (onPolygonCreated) onPolygonCreated(closed);
    }
  };

  return (
    <div className="glass-panel" style={{ position: 'relative', overflow: 'hidden', height, display: 'flex', flexDirection: 'column' }}>
      
      {/* Top Map Toolbar */}
      <div style={{
        position: 'absolute',
        top: '12px',
        left: '12px',
        right: '12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 10,
        pointerEvents: 'none'
      }}>
        <div style={{ display: 'flex', gap: '8px', pointerEvents: 'auto' }}>
          <button 
            className={`btn ${!isDrawing ? 'btn-primary' : 'btn-outline'}`}
            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
            onClick={() => setIsDrawing(false)}
          >
            <MousePointer size={14} /> Inspect
          </button>
          <button 
            className={`btn ${isDrawing ? 'btn-primary' : 'btn-outline'}`}
            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
            onClick={() => setIsDrawing(true)}
          >
            <PenTool size={14} /> Draw Boundary
          </button>
        </div>

        {/* Zoom Controls */}
        <div style={{ display: 'flex', gap: '6px', pointerEvents: 'auto' }}>
          <button 
            className="btn btn-outline" 
            style={{ padding: '6px 10px' }} 
            onClick={() => setZoom((z) => Math.min(z + 0.5, 20))}
            title="Zoom In"
          >
            <ZoomIn size={16} />
          </button>
          <button 
            className="btn btn-outline" 
            style={{ padding: '6px 10px' }} 
            onClick={() => setZoom((z) => Math.max(z - 0.5, 12))}
            title="Zoom Out"
          >
            <ZoomOut size={16} />
          </button>
          <button 
            className="btn btn-outline" 
            style={{ padding: '6px 10px' }} 
            onClick={() => { setCenter({ lon: 73.8567, lat: 18.5204 }); setZoom(16); }}
            title="Reset View"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      {/* Drawing Actions Overlay */}
      {isDrawing && (
        <div style={{
          position: 'absolute',
          bottom: '16px',
          left: '16px',
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(10px)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          zIndex: 10
        }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Vertices: <strong>{drawnPoints.length}</strong>
          </span>
          <button 
            className="btn btn-primary" 
            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
            onClick={closePolygon}
            disabled={drawnPoints.length < 3}
          >
            <CheckCircle2 size={14} /> Close Polygon
          </button>
          <button 
            className="btn btn-outline" 
            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
            onClick={clearDrawing}
          >
            Clear
          </button>
        </div>
      )}

      {/* Selected Parcel Info Tooltip */}
      {selectedParcel && !isDrawing && (
        <div style={{
          position: 'absolute',
          bottom: '16px',
          right: '16px',
          maxWidth: '320px',
          background: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(12px)',
          border: '1px solid var(--border-active)',
          borderRadius: '12px',
          padding: '14px 16px',
          zIndex: 10,
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span className="badge badge-verified">
              Land #{selectedParcel.properties?.on_chain_land_id || 'Pending'}
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {selectedParcel.properties?.area_sq_meters} m²
            </span>
          </div>
          <p className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', wordBreak: 'break-all', marginBottom: '8px' }}>
            Hash: {selectedParcel.properties?.geometry_hash}
          </p>
        </div>
      )}

      {/* Main Canvas */}
      <canvas 
        ref={canvasRef} 
        width={900} 
        height={500} 
        style={{ width: '100%', height: '100%', cursor: isDrawing ? 'crosshair' : 'grab' }}
        onClick={handleCanvasClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />
    </div>
  );
}
