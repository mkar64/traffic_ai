/**
 * SmartCity CAD 2D — Centralized Data Model & State Store (state.js)
 * Manages nodes, roads, traffic lights, zones, undo/redo history, and persistence.
 * Coordinates are stored strictly in physical Centimeters (0..160 cm, 0..120 cm).
 */

class CityState {
  constructor() {
    this.metadata = {
      title: "Miniature Smart City 160cm x 120cm",
      boardWidthCm: 160.0,
      boardHeightCm: 120.0,
      baseScalePxPerCm: 5.0, // 1cm = 5px (800x600 px native canvas)
      version: "1.0.0",
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    };

    // Core Data Entities
    this.nodes = new Map();         // id -> { id, x, y, name, type }
    this.roads = new Map();         // id -> { id, name, fromNode, toNode, width, flow, type, lanes, isCurved, controlPoint, speedLimit }
    this.trafficLights = new Map(); // id -> { id, name, x, y, rotation, type, state, roadId, lane, sensorType, timing }
    this.zones = new Map();         // id -> { id, name, category, x, y, width, height, color, icon, description }

    // History & Undo / Redo Stacks
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 40;

    // Selection & UI State
    this.selectedItem = null; // { type: 'road'|'traffic_light'|'zone'|'node', id: string }
    this.hoveredItem = null;

    // Observers / Listeners
    this.listeners = new Set();

    // Auto-save timer handle
    this.autoSaveTimer = null;

    // Route highlight for Dijkstra simulator
    this.activeRouteHighlight = null; // array of node IDs or null
  }

  // =========================================================================
  // Observer Pattern
  // =========================================================================

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(eventType = 'state_change', payload = null) {
    this.metadata.updated = new Date().toISOString();
    for (const listener of this.listeners) {
      try {
        listener(eventType, payload, this);
      } catch (err) {
        console.error('State listener error:', err);
      }
    }
    this.scheduleAutoSave();
  }

  // =========================================================================
  // Snapshotting & Undo / Redo
  // =========================================================================

  recordHistory() {
    const snapshot = this.serialize();
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    // Clear redo stack on new modification
    this.redoStack = [];
    this.notify('history_change', { canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (!this.canUndo()) return false;
    const currentSnapshot = this.serialize();
    this.redoStack.push(currentSnapshot);

    const prevSnapshot = this.undoStack.pop();
    this.deserialize(prevSnapshot, false);
    this.selectedItem = null;
    this.notify('undo', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    const currentSnapshot = this.serialize();
    this.undoStack.push(currentSnapshot);

    const nextSnapshot = this.redoStack.pop();
    this.deserialize(nextSnapshot, false);
    this.selectedItem = null;
    this.notify('redo', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    return true;
  }

  // =========================================================================
  // Entity CRUD Methods
  // =========================================================================

  // --- Nodes ---
  addNode(x, y, name = null, type = 'junction', record = true) {
    if (record) this.recordHistory();
    const id = `N_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`;
    const node = {
      id,
      x: Math.max(0, Math.min(this.metadata.boardWidthCm, Number(x))),
      y: Math.max(0, Math.min(this.metadata.boardHeightCm, Number(y))),
      name: name || `Junction ${this.nodes.size + 1}`,
      type
    };
    this.nodes.set(id, node);
    this.notify('node_added', node);
    return node;
  }

  findNodeNear(x, y, radiusCm = 3.0) {
    let closest = null;
    let minDist = radiusCm;
    for (const node of this.nodes.values()) {
      const dist = Math.hypot(node.x - x, node.y - y);
      if (dist < minDist) {
        minDist = dist;
        closest = node;
      }
    }
    return closest;
  }

  updateNode(id, props, record = true) {
    const node = this.nodes.get(id);
    if (!node) return null;
    if (record) this.recordHistory();

    if (props.x !== undefined) node.x = Math.max(0, Math.min(this.metadata.boardWidthCm, Number(props.x)));
    if (props.y !== undefined) node.y = Math.max(0, Math.min(this.metadata.boardHeightCm, Number(props.y)));
    if (props.name !== undefined) node.name = props.name;
    if (props.type !== undefined) node.type = props.type;

    this.notify('node_updated', node);
    return node;
  }

  deleteNode(id, record = true) {
    if (!this.nodes.has(id)) return false;
    if (record) this.recordHistory();

    // Delete connected roads first
    const connectedRoads = [];
    for (const road of this.roads.values()) {
      if (road.fromNode === id || road.toNode === id) {
        connectedRoads.push(road.id);
      }
    }
    for (const rId of connectedRoads) {
      this.roads.delete(rId);
    }

    this.nodes.delete(id);
    if (this.selectedItem && this.selectedItem.id === id) {
      this.selectedItem = null;
    }
    this.notify('node_deleted', { id, connectedRoads });
    return true;
  }

  // --- Roads ---
  addRoad(fromNodeId, toNodeId, options = {}, record = true) {
    if (!this.nodes.has(fromNodeId) || !this.nodes.has(toNodeId)) return null;
    if (fromNodeId === toNodeId) return null;
    if (record) this.recordHistory();

    const id = options.id || `ROAD_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`;
    const width = options.width !== undefined ? Number(options.width) : 20.0;
    const road = {
      id,
      name: options.name || (width >= 18 ? `Avenue Road ${this.roads.size + 1}` : `Bypass Road ${this.roads.size + 1}`),
      fromNode: fromNodeId,
      toNode: toNodeId,
      width: width, // 20cm (Main Avenue) or 14cm (Secondary/Bypass)
      flow: options.flow || 'two-way', // 'two-way' | 'one-way-forward' | 'one-way-reverse' | 'roundabout'
      type: options.type || (width >= 18 ? 'avenue' : 'bypass'),
      lanes: options.lanes || (width >= 18 ? 2 : 1),
      isCurved: Boolean(options.isCurved),
      controlPoint: options.controlPoint ? { x: options.controlPoint.x, y: options.controlPoint.y } : null,
      speedLimit: options.speedLimit || 50
    };

    this.roads.set(id, road);
    this.notify('road_added', road);
    return road;
  }

  updateRoad(id, props, record = true) {
    const road = this.roads.get(id);
    if (!road) return null;
    if (record) this.recordHistory();

    Object.assign(road, props);
    this.notify('road_updated', road);
    return road;
  }

  deleteRoad(id, record = true) {
    if (!this.roads.has(id)) return false;
    if (record) this.recordHistory();

    this.roads.delete(id);
    if (this.selectedItem && this.selectedItem.id === id) {
      this.selectedItem = null;
    }
    this.notify('road_deleted', { id });
    return true;
  }

  // --- Traffic Lights & Sensors ---
  addTrafficLight(props = {}, record = true) {
    if (record) this.recordHistory();
    const id = props.id || `TL_${(this.trafficLights.size + 1).toString().padStart(2, '0')}`;
    const unit = {
      id,
      name: props.name || `Signal ${id}`,
      x: Math.max(0, Math.min(this.metadata.boardWidthCm, Number(props.x || 80))),
      y: Math.max(0, Math.min(this.metadata.boardHeightCm, Number(props.y || 60))),
      rotation: Number(props.rotation || 0), // 0, 90, 180, 270 deg
      type: props.type || 'standard_pole', // 'overhead_gantry' | 'standard_pole' | 'smart_sensor'
      state: props.state || 'green', // 'red' | 'yellow' | 'green'
      roadId: props.roadId || null,
      lane: props.lane || null,
      sensorType: props.sensorType || (props.type === 'overhead_gantry' ? 'esp32_cam' : 'none'),
      timing: props.timing || { red: 10, yellow: 3, green: 12 },
      notes: props.notes || ""
    };

    this.trafficLights.set(id, unit);
    this.notify('traffic_light_added', unit);
    return unit;
  }

  updateTrafficLight(id, props, record = true) {
    const unit = this.trafficLights.get(id);
    if (!unit) return null;
    if (record) this.recordHistory();

    if (props.x !== undefined) unit.x = Math.max(0, Math.min(this.metadata.boardWidthCm, Number(props.x)));
    if (props.y !== undefined) unit.y = Math.max(0, Math.min(this.metadata.boardHeightCm, Number(props.y)));
    if (props.rotation !== undefined) unit.rotation = Number(props.rotation) % 360;
    if (props.type !== undefined) unit.type = props.type;
    if (props.state !== undefined) unit.state = props.state;
    if (props.name !== undefined) unit.name = props.name;
    if (props.roadId !== undefined) unit.roadId = props.roadId;
    if (props.sensorType !== undefined) unit.sensorType = props.sensorType;
    if (props.timing !== undefined) Object.assign(unit.timing, props.timing);
    if (props.notes !== undefined) unit.notes = props.notes;

    this.notify('traffic_light_updated', unit);
    return unit;
  }

  cycleTrafficLightState(id) {
    const unit = this.trafficLights.get(id);
    if (!unit) return;
    const cycle = { green: 'yellow', yellow: 'red', red: 'green' };
    unit.state = cycle[unit.state] || 'green';
    this.notify('traffic_light_updated', unit);
  }

  deleteTrafficLight(id, record = true) {
    if (!this.trafficLights.has(id)) return false;
    if (record) this.recordHistory();

    this.trafficLights.delete(id);
    if (this.selectedItem && this.selectedItem.id === id) {
      this.selectedItem = null;
    }
    this.notify('traffic_light_deleted', { id });
    return true;
  }

  // --- City Zones ---
  addZone(props = {}, record = true) {
    if (record) this.recordHistory();
    const id = props.id || `ZONE_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`;
    const categoryDefaults = this.getZoneCategoryPreset(props.category || 'commercial');

    const zone = {
      id,
      name: props.name || categoryDefaults.name,
      category: props.category || 'commercial',
      x: Math.max(0, Math.min(this.metadata.boardWidthCm, Number(props.x || 10))),
      y: Math.max(0, Math.min(this.metadata.boardHeightCm, Number(props.y || 10))),
      width: Math.max(5, Math.min(this.metadata.boardWidthCm, Number(props.width || 25))),
      height: Math.max(5, Math.min(this.metadata.boardHeightCm, Number(props.height || 20))),
      color: props.color || categoryDefaults.color,
      icon: props.icon || categoryDefaults.icon,
      description: props.description || categoryDefaults.description
    };

    this.zones.set(id, zone);
    this.notify('zone_added', zone);
    return zone;
  }

  getZoneCategoryPreset(cat) {
    const presets = {
      hospital: {
        name: "Metro Hospital & Trauma Center",
        color: "#dc2626",
        icon: "cross",
        description: "Emergency ward with priority ambulance routing."
      },
      park: {
        name: "Central City Park",
        color: "#16a34a",
        icon: "tree",
        description: "Lush green space with pedestrian walkways and ponds."
      },
      commercial: {
        name: "Commercial District & Retail",
        color: "#ea580c",
        icon: "cart",
        description: "High-density retail stores, shopping mall & dining."
      },
      residential: {
        name: "Residential Sector",
        color: "#2563eb",
        icon: "home",
        description: "Suburban villas, residential blocks & community center."
      },
      tech_hub: {
        name: "Smart City Tech Hub & R&D",
        color: "#7c3aed",
        icon: "cpu",
        description: "High-tech innovation laboratories and server farms."
      },
      control_hub: {
        name: "Master Control Hub (Raspberry Pi)",
        color: "#0d9488",
        icon: "server",
        description: "Physical mounting bracket for Raspberry Pi 4B & master MQTT controller."
      },
      custom: {
        name: "Civic Building Block",
        color: "#64748b",
        icon: "building",
        description: "Custom editable municipal zone."
      }
    };
    return presets[cat] || presets.custom;
  }

  updateZone(id, props, record = true) {
    const zone = this.zones.get(id);
    if (!zone) return null;
    if (record) this.recordHistory();

    if (props.x !== undefined) zone.x = Math.max(0, Math.min(this.metadata.boardWidthCm, Number(props.x)));
    if (props.y !== undefined) zone.y = Math.max(0, Math.min(this.metadata.boardHeightCm, Number(props.y)));
    if (props.width !== undefined) zone.width = Math.max(2, Number(props.width));
    if (props.height !== undefined) zone.height = Math.max(2, Number(props.height));
    if (props.name !== undefined) zone.name = props.name;
    if (props.category !== undefined) zone.category = props.category;
    if (props.color !== undefined) zone.color = props.color;
    if (props.icon !== undefined) zone.icon = props.icon;
    if (props.description !== undefined) zone.description = props.description;

    this.notify('zone_updated', zone);
    return zone;
  }

  deleteZone(id, record = true) {
    if (!this.zones.has(id)) return false;
    if (record) this.recordHistory();

    this.zones.delete(id);
    if (this.selectedItem && this.selectedItem.id === id) {
      this.selectedItem = null;
    }
    this.notify('zone_deleted', { id });
    return true;
  }

  // =========================================================================
  // Selection
  // =========================================================================

  selectItem(type, id) {
    if (type && id) {
      this.selectedItem = { type, id };
    } else {
      this.selectedItem = null;
    }
    this.notify('selection_changed', this.selectedItem);
  }

  getSelectedItem() {
    if (!this.selectedItem) return null;
    const { type, id } = this.selectedItem;
    if (type === 'road') return { type, data: this.roads.get(id) };
    if (type === 'traffic_light') return { type, data: this.trafficLights.get(id) };
    if (type === 'zone') return { type, data: this.zones.get(id) };
    if (type === 'node') return { type, data: this.nodes.get(id) };
    return null;
  }

  deleteSelected() {
    if (!this.selectedItem) return false;
    const { type, id } = this.selectedItem;
    if (type === 'road') return this.deleteRoad(id);
    if (type === 'traffic_light') return this.deleteTrafficLight(id);
    if (type === 'zone') return this.deleteZone(id);
    if (type === 'node') return this.deleteNode(id);
    return false;
  }

  duplicateSelected() {
    if (!this.selectedItem) return null;
    const { type, id } = this.selectedItem;
    if (type === 'traffic_light') {
      const orig = this.trafficLights.get(id);
      if (!orig) return null;
      return this.addTrafficLight({
        name: `${orig.name} (Copy)`,
        x: Math.min(150, orig.x + 5),
        y: Math.min(110, orig.y + 5),
        rotation: orig.rotation,
        type: orig.type,
        state: orig.state,
        sensorType: orig.sensorType
      });
    }
    if (type === 'zone') {
      const orig = this.zones.get(id);
      if (!orig) return null;
      return this.addZone({
        name: `${orig.name} (Copy)`,
        category: orig.category,
        x: Math.min(140, orig.x + 5),
        y: Math.min(100, orig.y + 5),
        width: orig.width,
        height: orig.height,
        color: orig.color,
        icon: orig.icon,
        description: orig.description
      });
    }
    return null;
  }

  // =========================================================================
  // Serialization & Persistence (JSON / LocalStorage)
  // =========================================================================

  serialize() {
    return JSON.stringify({
      metadata: { ...this.metadata },
      nodes: Array.from(this.nodes.values()),
      roads: Array.from(this.roads.values()),
      trafficLights: Array.from(this.trafficLights.values()),
      zones: Array.from(this.zones.values())
    }, null, 2);
  }

  deserialize(jsonString, clearHistory = true) {
    try {
      const data = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
      if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.roads)) {
        throw new Error('Invalid SmartCity CAD schema format');
      }

      if (data.metadata) {
        Object.assign(this.metadata, data.metadata);
      }

      this.nodes.clear();
      for (const n of data.nodes) {
        this.nodes.set(n.id, n);
      }

      this.roads.clear();
      for (const r of data.roads) {
        this.roads.set(r.id, r);
      }

      this.trafficLights.clear();
      if (Array.isArray(data.trafficLights)) {
        for (const tl of data.trafficLights) {
          this.trafficLights.set(tl.id, tl);
        }
      }

      this.zones.clear();
      if (Array.isArray(data.zones)) {
        for (const z of data.zones) {
          this.zones.set(z.id, z);
        }
      }

      if (clearHistory) {
        this.undoStack = [];
        this.redoStack = [];
      }

      this.selectedItem = null;
      this.activeRouteHighlight = null;
      this.notify('state_loaded');
      return true;
    } catch (err) {
      console.error('Failed to deserialize state:', err);
      return false;
    }
  }

  scheduleAutoSave() {
    if (typeof setTimeout === 'undefined') return;
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      this.saveToLocalStorage();
    }, 800);
  }

  saveToLocalStorage() {
    if (typeof localStorage === 'undefined') return false;
    try {
      const json = this.serialize();
      localStorage.setItem('smartcity_cad_map_v1', json);
      if (typeof document !== 'undefined') {
        const autosaveEl = document.getElementById('status-autosave');
        if (autosaveEl) {
          autosaveEl.innerHTML = '<span class="autosave-tag">● Auto-Saved</span>';
        }
      }
      return true;
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
      return false;
    }
  }

  loadFromLocalStorage() {
    try {
      const saved = localStorage.getItem('smartcity_cad_map_v1');
      if (saved) {
        return this.deserialize(saved);
      }
    } catch (e) {
      console.warn('LocalStorage load failed:', e);
    }
    return false;
  }

  // =========================================================================
  // Default Map Setup (160cm x 120cm reference layout)
  // =========================================================================

  loadDefaultMap() {
    this.nodes.clear();
    this.roads.clear();
    this.trafficLights.clear();
    this.zones.clear();
    this.undoStack = [];
    this.redoStack = [];

    // --- 1. Nodes definition ---
    // Main Avenue Horizontal line at Y=92cm (20cm wide avenue)
    const nodeDefs = [
      // Main Avenue (South)
      { id: 'N_AVE_W', x: 20, y: 92, name: 'Main Ave West Entrance' },
      { id: 'N_AVE_J1', x: 50, y: 92, name: 'Main Ave / Commercial W Junction' },
      { id: 'N_AVE_J2', x: 80, y: 92, name: 'Main Central 4-Way Intersection' },
      { id: 'N_AVE_J3', x: 110, y: 92, name: 'Main Ave / Commercial E Junction' },
      { id: 'N_AVE_E', x: 140, y: 92, name: 'Main Ave East Entrance' },

      // Central Roundabout Ring (Radius ~13cm, center at (80, 52))
      { id: 'N_RND_S', x: 80, y: 65, name: 'Roundabout South Entry' },
      { id: 'N_RND_E', x: 93, y: 52, name: 'Roundabout East Entry' },
      { id: 'N_RND_N', x: 80, y: 39, name: 'Roundabout North Entry' },
      { id: 'N_RND_W', x: 67, y: 52, name: 'Roundabout West Entry' },

      // North Avenue / Bypass junction
      { id: 'N_BYPASS_N_MID', x: 80, y: 16, name: 'North Tech Hub Junction' },

      // Outer Perimeter Bypass Ring (14cm wide)
      { id: 'N_BYPASS_NW', x: 20, y: 16, name: 'North-West Outer Corner' },
      { id: 'N_BYPASS_NE', x: 140, y: 16, name: 'North-East Outer Corner' },
      { id: 'N_BYPASS_W_MID', x: 20, y: 52, name: 'West Residential Gate' },
      { id: 'N_BYPASS_E_MID', x: 140, y: 52, name: 'East Residential Gate' },

      // Intermediate District Grid Crossings
      { id: 'N_DIST_NW', x: 50, y: 16, name: 'Park North Access' },
      { id: 'N_DIST_NE', x: 110, y: 16, name: 'Hospital North Access' },
      { id: 'N_DIST_MID_W', x: 50, y: 52, name: 'Central Park West Ave' },
      { id: 'N_DIST_MID_E', x: 110, y: 52, name: 'Hospital Trauma Emergency Access' },
    ];

    for (const nd of nodeDefs) {
      this.nodes.set(nd.id, {
        id: nd.id,
        x: nd.x,
        y: nd.y,
        name: nd.name,
        type: 'junction'
      });
    }

    // --- 2. Roads definition ---
    const roadDefs = [
      // 1. Main Horizontal Avenue (20cm dual-way, high capacity)
      { id: 'R_AVE_1', name: 'Grand Avenue (Sector 1)', fromNode: 'N_AVE_W', toNode: 'N_AVE_J1', width: 20, flow: 'two-way', type: 'avenue' },
      { id: 'R_AVE_2', name: 'Grand Avenue (Sector 2)', fromNode: 'N_AVE_J1', toNode: 'N_AVE_J2', width: 20, flow: 'two-way', type: 'avenue' },
      { id: 'R_AVE_3', name: 'Grand Avenue (Sector 3)', fromNode: 'N_AVE_J2', toNode: 'N_AVE_J3', width: 20, flow: 'two-way', type: 'avenue' },
      { id: 'R_AVE_4', name: 'Grand Avenue (Sector 4)', fromNode: 'N_AVE_J3', toNode: 'N_AVE_E', width: 20, flow: 'two-way', type: 'avenue' },

      // 2. Central North-South Main Corridor (20cm dual-way)
      { id: 'R_CORR_S', name: 'Central South Corridor', fromNode: 'N_AVE_J2', toNode: 'N_RND_S', width: 20, flow: 'two-way', type: 'avenue' },
      { id: 'R_CORR_N', name: 'Central North Corridor', fromNode: 'N_RND_N', toNode: 'N_BYPASS_N_MID', width: 20, flow: 'two-way', type: 'avenue' },

      // 3. Central Roundabout Segments (Rotary flow!)
      { id: 'R_RND_1', name: 'Roundabout Arc (South to East)', fromNode: 'N_RND_S', toNode: 'N_RND_E', width: 16, flow: 'roundabout', type: 'roundabout', isCurved: true, controlPoint: { x: 92, y: 64 } },
      { id: 'R_RND_2', name: 'Roundabout Arc (East to North)', fromNode: 'N_RND_E', toNode: 'N_RND_N', width: 16, flow: 'roundabout', type: 'roundabout', isCurved: true, controlPoint: { x: 92, y: 40 } },
      { id: 'R_RND_3', name: 'Roundabout Arc (North to West)', fromNode: 'N_RND_N', toNode: 'N_RND_W', width: 16, flow: 'roundabout', type: 'roundabout', isCurved: true, controlPoint: { x: 68, y: 40 } },
      { id: 'R_RND_4', name: 'Roundabout Arc (West to South)', fromNode: 'N_RND_W', toNode: 'N_RND_S', width: 16, flow: 'roundabout', type: 'roundabout', isCurved: true, controlPoint: { x: 68, y: 64 } },

      // 4. Central District Cross Connectors
      { id: 'R_CONN_W', name: 'West Roundabout Link', fromNode: 'N_RND_W', toNode: 'N_DIST_MID_W', width: 14, flow: 'two-way', type: 'secondary' },
      { id: 'R_CONN_E', name: 'East Roundabout Link', fromNode: 'N_RND_E', toNode: 'N_DIST_MID_E', width: 14, flow: 'two-way', type: 'secondary' },
      { id: 'R_MID_W', name: 'West Mid Crossing', fromNode: 'N_DIST_MID_W', toNode: 'N_BYPASS_W_MID', width: 14, flow: 'two-way', type: 'secondary' },
      { id: 'R_MID_E', name: 'East Mid Crossing', fromNode: 'N_DIST_MID_E', toNode: 'N_BYPASS_E_MID', width: 14, flow: 'two-way', type: 'secondary' },

      // 5. Outer Perimeter Bypass (14cm wide secondary)
      // West Side Loop
      { id: 'R_BYP_W1', name: 'West Bypass (South)', fromNode: 'N_AVE_W', toNode: 'N_BYPASS_W_MID', width: 14, flow: 'two-way', type: 'bypass' },
      { id: 'R_BYP_W2', name: 'West Bypass (North)', fromNode: 'N_BYPASS_W_MID', toNode: 'N_BYPASS_NW', width: 14, flow: 'two-way', type: 'bypass' },

      // North Perimeter
      { id: 'R_BYP_N1', name: 'North Bypass (West)', fromNode: 'N_BYPASS_NW', toNode: 'N_DIST_NW', width: 14, flow: 'two-way', type: 'bypass' },
      { id: 'R_BYP_N2', name: 'North Bypass (Mid-West)', fromNode: 'N_DIST_NW', toNode: 'N_BYPASS_N_MID', width: 14, flow: 'two-way', type: 'bypass' },
      { id: 'R_BYP_N3', name: 'North Bypass (Mid-East)', fromNode: 'N_BYPASS_N_MID', toNode: 'N_DIST_NE', width: 14, flow: 'two-way', type: 'bypass' },
      { id: 'R_BYP_N4', name: 'North Bypass (East)', fromNode: 'N_DIST_NE', toNode: 'N_BYPASS_NE', width: 14, flow: 'two-way', type: 'bypass' },

      // East Side Loop
      { id: 'R_BYP_E1', name: 'East Bypass (North)', fromNode: 'N_BYPASS_NE', toNode: 'N_BYPASS_E_MID', width: 14, flow: 'two-way', type: 'bypass' },
      { id: 'R_BYP_E2', name: 'East Bypass (South)', fromNode: 'N_BYPASS_E_MID', toNode: 'N_AVE_E', width: 14, flow: 'two-way', type: 'bypass' },

      // 6. District Vertical Arteries
      { id: 'R_DIST_W_S', name: 'Commercial West Artery', fromNode: 'N_AVE_J1', toNode: 'N_DIST_MID_W', width: 14, flow: 'two-way', type: 'secondary' },
      { id: 'R_DIST_W_N', name: 'Central Park West Lane', fromNode: 'N_DIST_MID_W', toNode: 'N_DIST_NW', width: 14, flow: 'one-way-forward', type: 'secondary' },
      { id: 'R_DIST_E_S', name: 'Commercial East Artery', fromNode: 'N_AVE_J3', toNode: 'N_DIST_MID_E', width: 14, flow: 'two-way', type: 'secondary' },
      { id: 'R_DIST_E_N', name: 'Hospital Emergency Lane', fromNode: 'N_DIST_MID_E', toNode: 'N_DIST_NE', width: 14, flow: 'two-way', type: 'secondary' },
    ];

    for (const rd of roadDefs) {
      this.roads.set(rd.id, {
        id: rd.id,
        name: rd.name,
        fromNode: rd.fromNode,
        toNode: rd.toNode,
        width: rd.width,
        flow: rd.flow,
        type: rd.type,
        lanes: rd.width >= 18 ? 2 : 1,
        isCurved: Boolean(rd.isCurved),
        controlPoint: rd.controlPoint || null,
        speedLimit: rd.width >= 18 ? 50 : 35
      });
    }

    // --- 3. City Zones (matching physical layout reference) ---
    const zoneDefs = [
      // Central Park
      {
        id: 'ZONE_PARK',
        name: 'Central City Park',
        category: 'park',
        x: 32,
        y: 26,
        width: 30,
        height: 20,
        color: '#16a34a',
        icon: 'tree',
        description: 'Green zone with walking tracks, botanical garden, and fountain.'
      },
      // Metro Hospital
      {
        id: 'ZONE_HOSPITAL',
        name: 'Metro Hospital & Trauma Center',
        category: 'hospital',
        x: 98,
        y: 24,
        width: 32,
        height: 22,
        color: '#dc2626',
        icon: 'cross',
        description: 'Main healthcare complex with emergency ambulance bays & helipad.'
      },
      // Commercial District (West)
      {
        id: 'ZONE_COMMERCIAL_W',
        name: 'Commercial District (West)',
        category: 'commercial',
        x: 32,
        y: 62,
        width: 30,
        height: 22,
        color: '#ea580c',
        icon: 'cart',
        description: 'Retail stores, banks, cafes, and business offices.'
      },
      // Commercial District (East)
      {
        id: 'ZONE_COMMERCIAL_E',
        name: 'Commercial District (East)',
        category: 'commercial',
        x: 98,
        y: 62,
        width: 32,
        height: 22,
        color: '#f59e0b',
        icon: 'cart',
        description: 'Market district, multi-story shopping plaza and transit center.'
      },
      // Residential Area (West)
      {
        id: 'ZONE_RESIDENTIAL_W',
        name: 'West Residential Sector',
        category: 'residential',
        x: 4,
        y: 26,
        width: 12,
        height: 58,
        color: '#2563eb',
        icon: 'home',
        description: 'Quiet suburban villas and apartments.'
      },
      // Residential Area (East)
      {
        id: 'ZONE_RESIDENTIAL_E',
        name: 'East Residential Sector',
        category: 'residential',
        x: 144,
        y: 26,
        width: 12,
        height: 58,
        color: '#0284c7',
        icon: 'home',
        description: 'Modern residential housing complexes.'
      },
      // Tech Hub (North)
      {
        id: 'ZONE_TECH_HUB',
        name: 'Smart City Tech Hub & R&D',
        category: 'tech_hub',
        x: 35,
        y: 4,
        width: 90,
        height: 9,
        color: '#7c3aed',
        icon: 'cpu',
        description: 'Artificial Intelligence, Robotics, and IoT research laboratories.'
      },
      // Control Hub (Raspberry Pi Mount - Bottom Right Corner)
      {
        id: 'ZONE_CONTROL_HUB',
        name: 'Master Control Hub (Raspberry Pi 4B)',
        category: 'control_hub',
        x: 134,
        y: 104,
        width: 23,
        height: 13,
        color: '#0d9488',
        icon: 'server',
        description: 'Physical acrylic testbed shelf: Raspberry Pi 4 Model B, 40-pin GPIO bus, MQTT broker.'
      }
    ];

    for (const zd of zoneDefs) {
      this.zones.set(zd.id, zd);
    }

    // --- 4. Traffic Lights & Sensor Units ---
    const signalDefs = [
      // Overhead Gantries on Grand Avenue Intersection
      {
        id: 'TL_MAIN_J2_GANTRY_W',
        name: 'Overhead Gantry West Approach (ESP32-CAM)',
        x: 72,
        y: 92,
        rotation: 90,
        type: 'overhead_gantry',
        state: 'green',
        sensorType: 'esp32_cam',
        roadId: 'R_AVE_2',
        timing: { red: 12, yellow: 3, green: 15 },
        notes: 'Monitors westbound & eastbound traffic with ESP32-CAM optical flow.'
      },
      {
        id: 'TL_MAIN_J2_GANTRY_E',
        name: 'Overhead Gantry East Approach (ESP32-CAM)',
        x: 88,
        y: 92,
        rotation: 270,
        type: 'overhead_gantry',
        state: 'green',
        sensorType: 'esp32_cam',
        roadId: 'R_AVE_3',
        timing: { red: 12, yellow: 3, green: 15 },
        notes: 'High-speed optical queue detection.'
      },

      // Standard 3-LED Poles at Main Intersection
      {
        id: 'TL_MAIN_J2_POLE_S',
        name: 'Main 4-Way Pole (South Entrance)',
        x: 84,
        y: 100,
        rotation: 0,
        type: 'standard_pole',
        state: 'red',
        sensorType: 'none',
        roadId: 'R_CORR_S',
        timing: { red: 15, yellow: 3, green: 12 },
        notes: 'Crosswalk pedestrian & vehicle signal.'
      },
      {
        id: 'TL_MAIN_J2_POLE_N',
        name: 'Main 4-Way Pole (North Roundabout Corridor)',
        x: 76,
        y: 84,
        rotation: 180,
        type: 'standard_pole',
        state: 'red',
        sensorType: 'none',
        roadId: 'R_CORR_S',
        timing: { red: 15, yellow: 3, green: 12 },
        notes: 'Stops corridor traffic for avenue crossing.'
      },

      // Roundabout Signals
      {
        id: 'TL_RND_S',
        name: 'Roundabout South Entry Signal',
        x: 74,
        y: 69,
        rotation: 0,
        type: 'standard_pole',
        state: 'green',
        sensorType: 'none',
        roadId: 'R_CORR_S',
        timing: { red: 10, yellow: 3, green: 12 },
        notes: 'Controls entry into roundabout from central corridor.'
      },
      {
        id: 'TL_RND_N',
        name: 'Roundabout North Entry Signal',
        x: 86,
        y: 35,
        rotation: 180,
        type: 'standard_pole',
        state: 'green',
        sensorType: 'none',
        roadId: 'R_CORR_N',
        timing: { red: 10, yellow: 3, green: 12 },
        notes: 'Controls entry into roundabout from north tech hub.'
      },

      // Hospital Emergency Intersection Signal
      {
        id: 'TL_HOSP_EMERGENCY',
        name: 'Hospital Emergency Priority Signal',
        x: 110,
        y: 52,
        rotation: 0,
        type: 'standard_pole',
        state: 'green',
        sensorType: 'none',
        roadId: 'R_DIST_E_N',
        timing: { red: 8, yellow: 2, green: 20 },
        notes: 'Preemptively turns green when ambulance is routed.'
      },

      // Commercial District Junction Signal
      {
        id: 'TL_COMM_J1',
        name: 'Commercial West Signal Pole',
        x: 50,
        y: 92,
        rotation: 90,
        type: 'standard_pole',
        state: 'yellow',
        sensorType: 'none',
        roadId: 'R_AVE_1',
        timing: { red: 12, yellow: 3, green: 12 },
        notes: 'Controls commercial entrance from Main Avenue.'
      },

      // Smart Sensors (IR / Ultrasonic)
      {
        id: 'TL_SENSOR_TECH',
        name: 'Tech Hub Ultrasonic Vehicle Counter',
        x: 80,
        y: 16,
        rotation: 180,
        type: 'smart_sensor',
        state: 'green',
        sensorType: 'ultrasonic',
        roadId: 'R_BYP_N2',
        timing: { red: 0, yellow: 0, green: 0 },
        notes: 'HC-SR04 ultrasonic sensor reporting distance & vehicle queue to RPi.'
      },
      {
        id: 'TL_SENSOR_RES_W',
        name: 'Residential West IR Proximity Gate',
        x: 20,
        y: 52,
        rotation: 270,
        type: 'smart_sensor',
        state: 'green',
        sensorType: 'ir_sensor',
        roadId: 'R_BYP_W1',
        timing: { red: 0, yellow: 0, green: 0 },
        notes: 'TCRT5000 infrared obstacle sensor for vehicle passing detection.'
      },
      {
        id: 'TL_SENSOR_RES_E',
        name: 'Residential East IR Proximity Gate',
        x: 140,
        y: 52,
        rotation: 90,
        type: 'smart_sensor',
        state: 'green',
        sensorType: 'ir_sensor',
        roadId: 'R_BYP_E1',
        timing: { red: 0, yellow: 0, green: 0 },
        notes: 'Infrared vehicle count detection for residential sector.'
      }
    ];

    for (const sig of signalDefs) {
      this.trafficLights.set(sig.id, sig);
    }

    this.notify('default_map_loaded');
  }

  // =========================================================================
  // Dijkstra / A* Graph Solver (For Routing simulation)
  // =========================================================================

  calculateShortestPath(startNodeId, endNodeId) {
    if (!this.nodes.has(startNodeId) || !this.nodes.has(endNodeId)) return null;
    if (startNodeId === endNodeId) return { path: [startNodeId], distance: 0 };

    // Build adjacency graph based on roads and flow constraints
    const adj = new Map();
    for (const node of this.nodes.values()) {
      adj.set(node.id, []);
    }

    for (const road of this.roads.values()) {
      const u = this.nodes.get(road.fromNode);
      const v = this.nodes.get(road.toNode);
      if (!u || !v) continue;

      const weight = Math.hypot(v.x - u.x, v.y - u.y);

      // Flow direction handling:
      // 'two-way': both directions allowed
      // 'one-way-forward': u -> v only
      // 'one-way-reverse': v -> u only
      // 'roundabout': u -> v only
      if (road.flow === 'two-way') {
        adj.get(u.id).push({ to: v.id, weight, roadId: road.id });
        adj.get(v.id).push({ to: u.id, weight, roadId: road.id });
      } else if (road.flow === 'one-way-forward' || road.flow === 'roundabout') {
        adj.get(u.id).push({ to: v.id, weight, roadId: road.id });
      } else if (road.flow === 'one-way-reverse') {
        adj.get(v.id).push({ to: u.id, weight, roadId: road.id });
      }
    }

    // Dijkstra algorithm
    const dist = new Map();
    const prev = new Map();
    const unvisited = new Set(this.nodes.keys());

    for (const id of this.nodes.keys()) {
      dist.set(id, Infinity);
    }
    dist.set(startNodeId, 0);

    while (unvisited.size > 0) {
      // Find lowest dist node in unvisited
      let curr = null;
      let minD = Infinity;
      for (const id of unvisited) {
        const d = dist.get(id);
        if (d < minD) {
          minD = d;
          curr = id;
        }
      }

      if (curr === null || minD === Infinity) break;
      if (curr === endNodeId) break;

      unvisited.delete(curr);

      const neighbors = adj.get(curr) || [];
      for (const edge of neighbors) {
        if (!unvisited.has(edge.to)) continue;
        const alt = dist.get(curr) + edge.weight;
        if (alt < dist.get(edge.to)) {
          dist.set(edge.to, alt);
          prev.set(edge.to, curr);
        }
      }
    }

    if (dist.get(endNodeId) === Infinity) {
      return null; // No path found
    }

    // Reconstruct path
    const path = [];
    let step = endNodeId;
    while (step) {
      path.unshift(step);
      step = prev.get(step);
    }

    return {
      path,
      distance: dist.get(endNodeId)
    };
  }

  findNearestNodeToZone(zoneId) {
    const zone = this.zones.get(zoneId);
    if (!zone) return null;
    const centerX = zone.x + zone.width / 2;
    const centerY = zone.y + zone.height / 2;

    let nearest = null;
    let minDist = Infinity;
    for (const node of this.nodes.values()) {
      const d = Math.hypot(node.x - centerX, node.y - centerY);
      if (d < minDist) {
        minDist = d;
        nearest = node;
      }
    }
    return nearest ? nearest.id : null;
  }
}

// Global instance
window.cityState = new CityState();
