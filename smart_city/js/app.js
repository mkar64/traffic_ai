/**
 * SmartCity CAD 2D — Main Application Controller & UI Bindings (app.js)
 * Coordinates State, Renderer, ToolController, Inspector Panel, Data Import/Export, and Tab Navigation.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize State & Data
  const state = window.cityState;

  // Check LocalStorage or load default reference layout
  const restored = state.loadFromLocalStorage();
  if (!restored) {
    state.loadDefaultMap();
  }

  // 2. Initialize Renderer
  const canvas = document.getElementById('city-canvas');
  const renderer = new window.CityRenderer(canvas, state);

  // 3. Initialize Tool Controller
  const tools = new window.ToolController(canvas, state, renderer);

  // 4. Bind UI Components
  initNavigationTabs(state, renderer);
  initHeaderControls(state, renderer);
  initToolbarControls(tools);
  initHUDControls(renderer, tools);
  initInspectorPanel(state, renderer, tools);
  initProjectTab(state, renderer);
  initStatusBar(state, renderer);

  // Subscribe to state updates to refresh UI & Inspector
  state.subscribe((event, data) => {
    updateStatusBar(state, renderer);
    updateUndoRedoButtons(state);
    renderInspector(state, renderer, tools);
  });

  // Initial UI Render
  updateStatusBar(state, renderer);
  updateUndoRedoButtons(state);
  renderInspector(state, renderer, tools);
});

// =========================================================================
// Top Navigation Tabs
// =========================================================================

function initNavigationTabs(state, renderer) {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.tab;

      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
      });

      btn.classList.add('active');
      const targetPane = document.getElementById(targetId);
      if (targetPane) {
        targetPane.style.display = targetId === 'tab-editor' ? 'flex' : 'block';
        targetPane.classList.add('active');
      }

      if (targetId === 'tab-editor') {
        renderer.handleResize();
      } else if (targetId === 'tab-ai-sim' && window.aiSim) {
        window.aiSim.drawIntersectionCanvas();
        window.aiSim.updateUI();
        if (!window.aiSim.isRunning) window.aiSim.start();
      }
    });
  });

  // Support URL hash navigation (e.g. #tab-project)
  if (window.location.hash === '#project' || window.location.hash === '#tab-project') {
    const tabProjBtn = document.getElementById('btn-tab-project');
    if (tabProjBtn) tabProjBtn.click();
  }
}

// =========================================================================
// Header Action Controls (Export/Import, Undo/Redo, Ref Photo)
// =========================================================================

function initHeaderControls(state, renderer) {
  // Reference Photo Opacity Slider
  const refSlider = document.getElementById('ref-photo-slider');
  const refVal = document.getElementById('ref-photo-val');
  if (refSlider && refVal) {
    refSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      refVal.textContent = `${val}%`;
      renderer.refPhotoOpacity = val / 100;
      renderer.render();
    });
  }

  // Undo / Redo
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');

  if (btnUndo) {
    btnUndo.addEventListener('click', () => {
      state.undo();
      renderer.render();
    });
  }

  if (btnRedo) {
    btnRedo.addEventListener('click', () => {
      state.redo();
      renderer.render();
    });
  }

  // Export JSON
  const btnExportJson = document.getElementById('btn-export-json');
  if (btnExportJson) {
    btnExportJson.addEventListener('click', () => {
      const json = state.serialize();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smartcity_map_160x120_${Date.now().toString(36)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // Import JSON
  const fileImport = document.getElementById('file-import-json');
  if (fileImport) {
    fileImport.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const success = state.deserialize(event.target.result);
        if (success) {
          renderer.fitBoardToView();
          alert('Smart City Map successfully imported!');
        } else {
          alert('Failed to import map: Invalid JSON schema format.');
        }
      };
      reader.readAsText(file);
      fileImport.value = '';
    });
  }

  // Export High-Resolution PNG
  const btnExportPng = document.getElementById('btn-export-png');
  if (btnExportPng) {
    btnExportPng.addEventListener('click', () => {
      exportHighResPNG(state, renderer);
    });
  }

  // Reset to Default Reference Map
  const btnReset = document.getElementById('btn-reset-map');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (confirm('Reset to the initial 160cm × 120cm reference layout? Any unsaved changes will be replaced.')) {
        state.loadDefaultMap();
        renderer.fitBoardToView();
      }
    });
  }
}

function updateUndoRedoButtons(state) {
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  if (btnUndo) btnUndo.disabled = !state.canUndo();
  if (btnRedo) btnRedo.disabled = !state.canRedo();
}

function exportHighResPNG(state, renderer) {
  // Render full 160x120cm board at high DPI
  const offscreen = document.createElement('canvas');
  const baseScale = state.metadata.baseScalePxPerCm;
  const boardW = state.metadata.boardWidthCm * baseScale;
  const boardH = state.metadata.boardHeightCm * baseScale;
  const exportScale = 2.0; // 2x crispness

  offscreen.width = (boardW + 40) * exportScale;
  offscreen.height = (boardH + 40) * exportScale;
  const ctx = offscreen.getContext('2d');

  ctx.scale(exportScale, exportScale);
  ctx.translate(20, 20);

  // Render complete scene
  renderer.renderTableFrame(ctx, boardW, boardH);
  if (renderer.refPhotoOpacity > 0 && renderer.refImageLoaded) {
    ctx.save();
    ctx.globalAlpha = renderer.refPhotoOpacity;
    ctx.drawImage(renderer.refImage, 0, 0, boardW, boardH);
    ctx.restore();
  }
  renderer.renderCADGrid(ctx, boardW, boardH, baseScale);
  renderer.renderZones(ctx, baseScale);
  renderer.renderRoads(ctx, baseScale);
  renderer.renderNodes(ctx, baseScale);
  renderer.renderTrafficLights(ctx, baseScale);

  // Trigger download
  const url = offscreen.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `smartcity_layout_160x120.png`;
  a.click();
}

// =========================================================================
// Toolbar & Tool Options
// =========================================================================

function initToolbarControls(tools) {
  const toolButtons = document.querySelectorAll('.tool-btn');
  toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tools.setTool(btn.dataset.tool);
    });
  });

  // Road options
  const roadWidthPills = document.querySelectorAll('#opt-road-panel .pill-btn');
  roadWidthPills.forEach(pill => {
    pill.addEventListener('click', () => {
      roadWidthPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      tools.roadOptions.width = Number(pill.dataset.roadWidth);
    });
  });

  const selRoadFlow = document.getElementById('sel-new-road-flow');
  if (selRoadFlow) {
    selRoadFlow.addEventListener('change', (e) => {
      tools.roadOptions.flow = e.target.value;
    });
  }

  const chkCurved = document.getElementById('chk-road-curved');
  if (chkCurved) {
    chkCurved.addEventListener('change', (e) => {
      tools.roadOptions.isCurved = e.target.checked;
    });
  }

  // Traffic signal options
  const selSignalType = document.getElementById('sel-new-signal-type');
  if (selSignalType) {
    selSignalType.addEventListener('change', (e) => {
      tools.trafficLightOptions.type = e.target.value;
    });
  }

  const signalRotPills = document.querySelectorAll('#opt-traffic-panel .pill-btn');
  signalRotPills.forEach(pill => {
    pill.addEventListener('click', () => {
      signalRotPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      tools.trafficLightOptions.rotation = Number(pill.dataset.rot);
    });
  });

  // Zone category options
  const selZoneCat = document.getElementById('sel-new-zone-category');
  if (selZoneCat) {
    selZoneCat.addEventListener('change', (e) => {
      tools.zoneOptions.category = e.target.value;
    });
  }

  // View zoom buttons
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnResetView = document.getElementById('btn-reset-view');

  if (btnZoomIn) btnZoomIn.addEventListener('click', () => tools.renderer.setZoom(tools.renderer.zoom * 1.25));
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => tools.renderer.setZoom(tools.renderer.zoom * 0.8));
  if (btnResetView) btnResetView.addEventListener('click', () => tools.renderer.fitBoardToView());
}

// =========================================================================
// Canvas HUD Controls
// =========================================================================

function initHUDControls(renderer, tools) {
  const chkSnap = document.getElementById('chk-snap-grid');
  if (chkSnap) {
    chkSnap.addEventListener('change', (e) => {
      renderer.snapToGrid = e.target.checked;
      tools.snapToGrid = e.target.checked;
    });
  }

  const selGridStep = document.getElementById('sel-grid-step');
  if (selGridStep) {
    selGridStep.addEventListener('change', (e) => {
      renderer.gridStepCm = Number(e.target.value);
    });
  }

  const chkArrows = document.getElementById('chk-show-arrows');
  if (chkArrows) {
    chkArrows.addEventListener('change', (e) => {
      renderer.showArrows = e.target.checked;
      renderer.render();
    });
  }

  const chkLabels = document.getElementById('chk-show-labels');
  if (chkLabels) {
    chkLabels.addEventListener('change', (e) => {
      renderer.showLabels = e.target.checked;
      renderer.render();
    });
  }

  const chkNodes = document.getElementById('chk-show-nodes');
  if (chkNodes) {
    chkNodes.addEventListener('change', (e) => {
      renderer.showNodes = e.target.checked;
      renderer.render();
    });
  }

  // Live Signals Simulation Toggle
  let isSimulating = false;
  let simInterval = null;
  const btnToggleSim = document.getElementById('btn-toggle-sim');
  const simIcon = document.getElementById('sim-icon');
  const simText = document.getElementById('sim-text');

  if (btnToggleSim) {
    btnToggleSim.addEventListener('click', () => {
      isSimulating = !isSimulating;
      if (isSimulating) {
        btnToggleSim.classList.remove('btn-secondary');
        btnToggleSim.classList.add('btn-primary');
        if (simIcon) simIcon.textContent = '⏸';
        if (simText) simText.textContent = 'Sim Active';

        simInterval = setInterval(() => {
          // Cycle traffic lights and append mock MQTT event
          for (const tl of state.trafficLights.values()) {
            if (tl.type === 'smart_sensor') continue;
            // Smooth realistic cycle probability
            if (Math.random() < 0.28) {
              state.cycleTrafficLightState(tl.id);
            }
          }
          renderer.render();

          // If MQTT log box is present, append live telemetry packet
          const mqttCode = document.querySelector('.mqtt-code code');
          if (mqttCode) {
            const timeStr = new Date().toLocaleTimeString();
            const lights = Array.from(state.trafficLights.values());
            const sample = lights[Math.floor(Math.random() * lights.length)];
            const newLog = `[${timeStr}] MQTT: smartcity/signal/${sample.id} -> {"state":"${sample.state.toUpperCase()}", "vehicles":${Math.floor(Math.random() * 5)}}\n`;
            mqttCode.textContent = (newLog + mqttCode.textContent).split('\n').slice(0, 8).join('\n');
          }
        }, 1200);
      } else {
        btnToggleSim.classList.remove('btn-primary');
        btnToggleSim.classList.add('btn-secondary');
        if (simIcon) simIcon.textContent = '▶';
        if (simText) simText.textContent = 'Live Sim';
        if (simInterval) clearInterval(simInterval);
        simInterval = null;
      }
    });
  }
}

// =========================================================================
// Inspector Panel (Properties & Editing)
// =========================================================================

function initInspectorPanel(state, renderer, tools) {
  const btnDuplicate = document.getElementById('btn-duplicate-elem');
  const btnDelete = document.getElementById('btn-delete-elem');

  if (btnDuplicate) {
    btnDuplicate.addEventListener('click', () => {
      state.duplicateSelected();
      renderer.render();
    });
  }

  if (btnDelete) {
    btnDelete.addEventListener('click', () => {
      state.deleteSelected();
      renderer.render();
    });
  }
}

function renderInspector(state, renderer, tools) {
  const container = document.getElementById('inspector-content');
  const badge = document.getElementById('inspector-type-badge');
  const footerActions = document.getElementById('inspector-actions');
  if (!container) return;

  const sel = state.getSelectedItem();

  if (!sel) {
    // Empty State: Overview of Map
    badge.textContent = 'Map Overview';
    footerActions.style.display = 'none';

    container.innerHTML = `
      <div class="prop-group">
        <span class="prop-title">Physical Board</span>
        <div class="prop-row">
          <label>Board Size:</label>
          <span class="mono">160.0 × 120.0 cm</span>
        </div>
        <div class="prop-row">
          <label>Display Ratio:</label>
          <span class="mono">1cm = 5.0px</span>
        </div>
        <div class="prop-row">
          <label>Main Corridor:</label>
          <span class="mono">Grand Avenue (20cm)</span>
        </div>
        <div class="prop-row">
          <label>Secondary / Bypass:</label>
          <span class="mono">14cm (1-2 Lanes)</span>
        </div>
      </div>

      <div class="empty-inspector">
        <svg viewBox="0 0 24 24" width="36" height="36" stroke="currentColor" fill="none" stroke-width="1.5">
          <path d="M3 3l7 18 3-7 7-3L3 3z"/>
        </svg>
        <p>Click on any road, traffic signal, zone, or junction node to view and edit its parameters.</p>
      </div>
    `;
    return;
  }

  footerActions.style.display = 'flex';

  // --- 1. ROAD INSPECTOR ---
  if (sel.type === 'road') {
    const road = sel.data;
    badge.textContent = 'Road Segment';

    container.innerHTML = `
      <div class="prop-group">
        <span class="prop-title">Identification</span>
        <div class="prop-row">
          <label>ID:</label>
          <input type="text" class="cad-input mono" value="${road.id}" readonly>
        </div>
        <div class="prop-row">
          <label>Name:</label>
          <input type="text" id="inp-road-name" class="cad-input" value="${road.name}">
        </div>
      </div>

      <div class="prop-group">
        <span class="prop-title">Width &amp; Classification</span>
        <div class="prop-row">
          <label>Width:</label>
          <div class="pill-group">
            <button class="pill-btn ${road.width >= 18 ? 'active' : ''}" id="btn-set-width-20">20cm Ave</button>
            <button class="pill-btn ${road.width < 18 ? 'active' : ''}" id="btn-set-width-14">14cm Byp</button>
          </div>
        </div>
        <div class="prop-row">
          <label>Custom (cm):</label>
          <input type="number" id="inp-road-width" class="cad-input mono" value="${road.width}" min="6" max="40" step="1">
        </div>
      </div>

      <div class="prop-group">
        <span class="prop-title">Flow &amp; Direction</span>
        <div class="prop-row">
          <label>Flow Control:</label>
          <select id="sel-road-flow" class="cad-select">
            <option value="two-way" ${road.flow === 'two-way' ? 'selected' : ''}>Two-Way (Dual Flow)</option>
            <option value="one-way-forward" ${road.flow === 'one-way-forward' ? 'selected' : ''}>One-Way (Forward)</option>
            <option value="one-way-reverse" ${road.flow === 'one-way-reverse' ? 'selected' : ''}>One-Way (Reverse)</option>
            <option value="roundabout" ${road.flow === 'roundabout' ? 'selected' : ''}>Roundabout (Rotary)</option>
          </select>
        </div>
        <div class="prop-row">
          <label>Geometry:</label>
          <label class="hud-check">
            <input type="checkbox" id="chk-road-iscurved" ${road.isCurved ? 'checked' : ''}>
            <span>Curved Segment</span>
          </label>
        </div>
        <div class="prop-row">
          <label>Speed Limit:</label>
          <input type="number" id="inp-road-speed" class="cad-input mono" value="${road.speedLimit || 50}" step="5">
        </div>
      </div>

      <div class="prop-group">
        <span class="prop-title">Connected Nodes</span>
        <div class="prop-row">
          <label>From Node:</label>
          <span class="mono">${road.fromNode}</span>
        </div>
        <div class="prop-row">
          <label>To Node:</label>
          <span class="mono">${road.toNode}</span>
        </div>
      </div>
    `;

    // Event bindings for Road Inspector
    document.getElementById('inp-road-name').addEventListener('change', (e) => {
      state.updateRoad(road.id, { name: e.target.value });
      renderer.render();
    });

    document.getElementById('btn-set-width-20').addEventListener('click', () => {
      state.updateRoad(road.id, { width: 20, lanes: 2, type: 'avenue' });
      renderer.render();
    });

    document.getElementById('btn-set-width-14').addEventListener('click', () => {
      state.updateRoad(road.id, { width: 14, lanes: 1, type: 'bypass' });
      renderer.render();
    });

    document.getElementById('inp-road-width').addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      if (val > 4) {
        state.updateRoad(road.id, { width: val, lanes: val >= 18 ? 2 : 1 });
        renderer.render();
      }
    });

    document.getElementById('sel-road-flow').addEventListener('change', (e) => {
      state.updateRoad(road.id, { flow: e.target.value });
      renderer.render();
    });

    document.getElementById('chk-road-iscurved').addEventListener('change', (e) => {
      const isCurved = e.target.checked;
      let controlPoint = road.controlPoint;
      if (isCurved && !controlPoint) {
        const from = state.nodes.get(road.fromNode);
        const to = state.nodes.get(road.toNode);
        if (from && to) {
          const mx = (from.x + to.x) / 2;
          const my = (from.y + to.y) / 2;
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          controlPoint = { x: mx - dy * 0.25, y: my + dx * 0.25 };
        }
      }
      state.updateRoad(road.id, { isCurved, controlPoint });
      renderer.render();
    });

    document.getElementById('inp-road-speed').addEventListener('change', (e) => {
      state.updateRoad(road.id, { speedLimit: Number(e.target.value) });
    });
  }

  // --- 2. TRAFFIC LIGHT / SENSOR INSPECTOR ---
  else if (sel.type === 'traffic_light') {
    const tl = sel.data;
    badge.textContent = 'Signal / Sensor';

    const roadsList = Array.from(state.roads.values())
      .map(r => `<option value="${r.id}" ${tl.roadId === r.id ? 'selected' : ''}>${r.name} (${r.id})</option>`)
      .join('');

    container.innerHTML = `
      <div class="prop-group">
        <span class="prop-title">Unit Identification</span>
        <div class="prop-row">
          <label>ID:</label>
          <input type="text" class="cad-input mono" value="${tl.id}" readonly>
        </div>
        <div class="prop-row">
          <label>Name:</label>
          <input type="text" id="inp-tl-name" class="cad-input" value="${tl.name}">
        </div>
      </div>

      <div class="prop-group">
        <span class="prop-title">Hardware Type &amp; Sensor</span>
        <div class="prop-row">
          <label>Type:</label>
          <select id="sel-tl-type" class="cad-select">
            <option value="overhead_gantry" ${tl.type === 'overhead_gantry' ? 'selected' : ''}>Overhead Gantry + ESP32-CAM</option>
            <option value="standard_pole" ${tl.type === 'standard_pole' ? 'selected' : ''}>Standard 3-LED Pole</option>
            <option value="smart_sensor" ${tl.type === 'smart_sensor' ? 'selected' : ''}>Smart Sensor Node (IR / Ultrasonic)</option>
          </select>
        </div>
        <div class="prop-row">
          <label>Sensor:</label>
          <select id="sel-tl-sensor" class="cad-select">
            <option value="esp32_cam" ${tl.sensorType === 'esp32_cam' ? 'selected' : ''}>ESP32-CAM Vision Module</option>
            <option value="ultrasonic" ${tl.sensorType === 'ultrasonic' ? 'selected' : ''}>HC-SR04 Ultrasonic</option>
            <option value="ir_sensor" ${tl.sensorType === 'ir_sensor' ? 'selected' : ''}>TCRT5000 IR Sensor</option>
            <option value="none" ${tl.sensorType === 'none' ? 'selected' : ''}>None (Passive Signal)</option>
          </select>
        </div>
      </div>

      <div class="prop-group">
        <span class="prop-title">Orientation (Degrees)</span>
        <div class="prop-row">
          <label>Angle:</label>
          <div class="pill-group">
            <button class="pill-btn ${tl.rotation === 0 ? 'active' : ''}" data-rot="0">0°</button>
            <button class="pill-btn ${tl.rotation === 90 ? 'active' : ''}" data-rot="90">90°</button>
            <button class="pill-btn ${tl.rotation === 180 ? 'active' : ''}" data-rot="180">180°</button>
            <button class="pill-btn ${tl.rotation === 270 ? 'active' : ''}" data-rot="270">270°</button>
          </div>
        </div>
      </div>

      <div class="prop-group">
        <span class="prop-title">Manual State Preview</span>
        <div class="signal-state-toggles">
          <button class="signal-toggle-btn btn-red ${tl.state === 'red' ? 'active' : ''}" id="btn-state-red">RED</button>
          <button class="signal-toggle-btn btn-yellow ${tl.state === 'yellow' ? 'active' : ''}" id="btn-state-yellow">YELLOW</button>
          <button class="signal-toggle-btn btn-green ${tl.state === 'green' ? 'active' : ''}" id="btn-state-green">GREEN</button>
        </div>
      </div>

      <div class="prop-group">
        <span class="prop-title">Coordinates &amp; Linking</span>
        <div class="prop-row">
          <label>Position X (cm):</label>
          <input type="number" id="inp-tl-x" class="cad-input mono" value="${tl.x.toFixed(1)}" step="1">
        </div>
        <div class="prop-row">
          <label>Position Y (cm):</label>
          <input type="number" id="inp-tl-y" class="cad-input mono" value="${tl.y.toFixed(1)}" step="1">
        </div>
        <div class="prop-row">
          <label>Linked Road:</label>
          <select id="sel-tl-road" class="cad-select">
            <option value="">None / Floating</option>
            ${roadsList}
          </select>
        </div>
      </div>

      <div class="prop-group">
        <span class="prop-title">Hardware Notes</span>
        <textarea id="txt-tl-notes" class="cad-input" rows="2" placeholder="e.g. GPIO Pin 18, Shift Register 0x01">${tl.notes || ''}</textarea>
      </div>
    `;

    // Bindings
    document.getElementById('inp-tl-name').addEventListener('change', (e) => {
      state.updateTrafficLight(tl.id, { name: e.target.value });
      renderer.render();
    });

    document.getElementById('sel-tl-type').addEventListener('change', (e) => {
      state.updateTrafficLight(tl.id, { type: e.target.value });
      renderer.render();
    });

    document.getElementById('sel-tl-sensor').addEventListener('change', (e) => {
      state.updateTrafficLight(tl.id, { sensorType: e.target.value });
      renderer.render();
    });

    container.querySelectorAll('.pill-group .pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.updateTrafficLight(tl.id, { rotation: Number(btn.dataset.rot) });
        renderer.render();
      });
    });

    document.getElementById('btn-state-red').addEventListener('click', () => {
      state.updateTrafficLight(tl.id, { state: 'red' });
      renderer.render();
    });
    document.getElementById('btn-state-yellow').addEventListener('click', () => {
      state.updateTrafficLight(tl.id, { state: 'yellow' });
      renderer.render();
    });
    document.getElementById('btn-state-green').addEventListener('click', () => {
      state.updateTrafficLight(tl.id, { state: 'green' });
      renderer.render();
    });

    document.getElementById('inp-tl-x').addEventListener('change', (e) => {
      state.updateTrafficLight(tl.id, { x: Number(e.target.value) });
      renderer.render();
    });
    document.getElementById('inp-tl-y').addEventListener('change', (e) => {
      state.updateTrafficLight(tl.id, { y: Number(e.target.value) });
      renderer.render();
    });

    document.getElementById('sel-tl-road').addEventListener('change', (e) => {
      state.updateTrafficLight(tl.id, { roadId: e.target.value || null });
    });

    document.getElementById('txt-tl-notes').addEventListener('change', (e) => {
      state.updateTrafficLight(tl.id, { notes: e.target.value });
    });
  }

  // --- 3. ZONE INSPECTOR ---
  else if (sel.type === 'zone') {
    const zone = sel.data;
    badge.textContent = 'City Zone Block';

    container.innerHTML = `
      <div class="prop-group">
        <span class="prop-title">Zone Identification</span>
        <div class="prop-row">
          <label>ID:</label>
          <input type="text" class="cad-input mono" value="${zone.id}" readonly>
        </div>
        <div class="prop-row">
          <label>Name:</label>
          <input type="text" id="inp-zone-name" class="cad-input" value="${zone.name}">
        </div>
      </div>

      <div class="prop-group">
        <span class="prop-title">Category &amp; Styling</span>
        <div class="prop-row">
          <label>Category:</label>
          <select id="sel-zone-cat" class="cad-select">
            <option value="hospital" ${zone.category === 'hospital' ? 'selected' : ''}>Hospital &amp; Medical</option>
            <option value="park" ${zone.category === 'park' ? 'selected' : ''}>Central Park</option>
            <option value="commercial" ${zone.category === 'commercial' ? 'selected' : ''}>Commercial District</option>
            <option value="residential" ${zone.category === 'residential' ? 'selected' : ''}>Residential Area</option>
            <option value="tech_hub" ${zone.category === 'tech_hub' ? 'selected' : ''}>Tech Hub &amp; R&amp;D</option>
            <option value="control_hub" ${zone.category === 'control_hub' ? 'selected' : ''}>Control Hub (Raspberry Pi)</option>
            <option value="custom" ${zone.category === 'custom' ? 'selected' : ''}>Custom Civic Zone</option>
          </select>
        </div>
        <div class="prop-row">
          <label>Color:</label>
          <input type="color" id="inp-zone-color" value="${zone.color || '#3b82f6'}" class="cad-input" style="height:32px; padding:2px;">
        </div>
      </div>

      <div class="prop-group">
        <span class="prop-title">Dimensions &amp; Location (cm)</span>
        <div class="prop-row">
          <label>Width:</label>
          <input type="number" id="inp-zone-w" class="cad-input mono" value="${zone.width.toFixed(1)}" step="1">
        </div>
        <div class="prop-row">
          <label>Height:</label>
          <input type="number" id="inp-zone-h" class="cad-input mono" value="${zone.height.toFixed(1)}" step="1">
        </div>
        <div class="prop-row">
          <label>X (cm):</label>
          <input type="number" id="inp-zone-x" class="cad-input mono" value="${zone.x.toFixed(1)}" step="1">
        </div>
        <div class="prop-row">
          <label>Y (cm):</label>
          <input type="number" id="inp-zone-y" class="cad-input mono" value="${zone.y.toFixed(1)}" step="1">
        </div>
      </div>

      <div class="prop-group">
        <span class="prop-title">Description</span>
        <textarea id="txt-zone-desc" class="cad-input" rows="2">${zone.description || ''}</textarea>
      </div>
    `;

    document.getElementById('inp-zone-name').addEventListener('change', (e) => {
      state.updateZone(zone.id, { name: e.target.value });
      renderer.render();
    });

    document.getElementById('sel-zone-cat').addEventListener('change', (e) => {
      const preset = state.getZoneCategoryPreset(e.target.value);
      state.updateZone(zone.id, {
        category: e.target.value,
        color: preset.color,
        icon: preset.icon,
        name: preset.name
      });
      renderer.render();
    });

    document.getElementById('inp-zone-color').addEventListener('change', (e) => {
      state.updateZone(zone.id, { color: e.target.value });
      renderer.render();
    });

    document.getElementById('inp-zone-w').addEventListener('change', (e) => {
      state.updateZone(zone.id, { width: Number(e.target.value) });
      renderer.render();
    });
    document.getElementById('inp-zone-h').addEventListener('change', (e) => {
      state.updateZone(zone.id, { height: Number(e.target.value) });
      renderer.render();
    });
    document.getElementById('inp-zone-x').addEventListener('change', (e) => {
      state.updateZone(zone.id, { x: Number(e.target.value) });
      renderer.render();
    });
    document.getElementById('inp-zone-y').addEventListener('change', (e) => {
      state.updateZone(zone.id, { y: Number(e.target.value) });
      renderer.render();
    });

    document.getElementById('txt-zone-desc').addEventListener('change', (e) => {
      state.updateZone(zone.id, { description: e.target.value });
    });
  }

  // --- 4. NODE INSPECTOR ---
  else if (sel.type === 'node') {
    const node = sel.data;
    badge.textContent = 'Junction Node';

    const connectedRoads = Array.from(state.roads.values())
      .filter(r => r.fromNode === node.id || r.toNode === node.id)
      .map(r => `<li>${r.name} (${r.flow})</li>`)
      .join('');

    container.innerHTML = `
      <div class="prop-group">
        <span class="prop-title">Node Parameters</span>
        <div class="prop-row">
          <label>ID:</label>
          <input type="text" class="cad-input mono" value="${node.id}" readonly>
        </div>
        <div class="prop-row">
          <label>Name:</label>
          <input type="text" id="inp-node-name" class="cad-input" value="${node.name}">
        </div>
        <div class="prop-row">
          <label>X (cm):</label>
          <input type="number" id="inp-node-x" class="cad-input mono" value="${node.x.toFixed(1)}" step="1">
        </div>
        <div class="prop-row">
          <label>Y (cm):</label>
          <input type="number" id="inp-node-y" class="cad-input mono" value="${node.y.toFixed(1)}" step="1">
        </div>
      </div>

      <div class="prop-group">
        <span class="prop-title">Connected Roads</span>
        <ul class="spec-list" style="margin-top:4px;">
          ${connectedRoads || '<li style="color:#64748b;">No roads connected</li>'}
        </ul>
      </div>
    `;

    document.getElementById('inp-node-name').addEventListener('change', (e) => {
      state.updateNode(node.id, { name: e.target.value });
    });
    document.getElementById('inp-node-x').addEventListener('change', (e) => {
      state.updateNode(node.id, { x: Number(e.target.value) });
      renderer.render();
    });
    document.getElementById('inp-node-y').addEventListener('change', (e) => {
      state.updateNode(node.id, { y: Number(e.target.value) });
      renderer.render();
    });
  }
}

// =========================================================================
// Tab 2: Project Info & Dijkstra Simulator
// =========================================================================

function initProjectTab(state, renderer) {
  const btnCalc = document.getElementById('btn-calc-route');
  const resultBox = document.getElementById('route-result-box');
  const pathText = document.getElementById('route-path-text');
  const distText = document.getElementById('route-dist-text');
  const timeText = document.getElementById('route-time-text');
  const btnShowOnMap = document.getElementById('btn-show-route-map');

  if (btnCalc) {
    btnCalc.addEventListener('click', () => {
      const startZoneId = document.getElementById('route-start-zone').value;
      const endZoneId = document.getElementById('route-end-zone').value;

      const startNodeId = state.findNearestNodeToZone(startZoneId);
      const endNodeId = state.findNearestNodeToZone(endZoneId);

      if (!startNodeId || !endNodeId) {
        alert('Could not find reachable road nodes near selected zones.');
        return;
      }

      const result = state.calculateShortestPath(startNodeId, endNodeId);
      if (!result) {
        resultBox.style.display = 'block';
        pathText.textContent = 'No valid path found (constrained by one-way roads)';
        distText.textContent = '---';
        timeText.textContent = '---';
        state.activeRouteHighlight = null;
        return;
      }

      resultBox.style.display = 'block';
      pathText.innerHTML = result.path.join(' &rarr; ');
      distText.textContent = `${result.distance.toFixed(1)} cm`;
      const timeSec = (result.distance / 20.0).toFixed(1);
      timeText.textContent = `${timeSec} sec (@ 20cm/s miniature vehicle speed)`;

      // Set active route on state
      state.activeRouteHighlight = result.path;
      renderer.render();
    });
  }

  if (btnShowOnMap) {
    btnShowOnMap.addEventListener('click', () => {
      // Switch back to Tab 1
      const btnEditorTab = document.getElementById('btn-tab-editor');
      if (btnEditorTab) {
        btnEditorTab.click();
      }
    });
  }
}

// =========================================================================
// Status Bar Updates
// =========================================================================

function initStatusBar(state, renderer) {
  updateStatusBar(state, renderer);
}

function updateStatusBar(state, renderer) {
  const rc = document.getElementById('status-road-count');
  const nc = document.getElementById('status-node-count');
  const sc = document.getElementById('status-signal-count');
  const zc = document.getElementById('status-zone-count');
  const scale = document.getElementById('status-scale');

  if (rc) rc.textContent = state.roads.size;
  if (nc) nc.textContent = state.nodes.size;
  if (sc) sc.textContent = state.trafficLights.size;
  if (zc) zc.textContent = state.zones.size;
  if (scale) scale.textContent = `1cm = ${(state.metadata.baseScalePxPerCm * renderer.zoom).toFixed(1)}px`;
}
