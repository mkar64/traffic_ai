/**
 * SmartCity CAD 2D — Interactive Drawing & Editing Tools (tools.js)
 * Implements tool state machine: Select & Move, Add Road, Add Traffic Signal, Add Zone, Delete, and Pan/Zoom.
 * Handles mouse events, hit-testing, drag-and-drop, corner resizing, snapping, and hotkeys.
 */

class ToolController {
  constructor(canvas, state, renderer) {
    this.canvas = canvas;
    this.state = state;
    this.renderer = renderer;

    // Active tool: 'select' | 'road' | 'traffic_light' | 'zone' | 'pan' | 'delete'
    this.activeTool = 'select';

    // Tool creation options
    this.roadOptions = {
      width: 20, // 20cm Main Avenue or 14cm Bypass
      flow: 'two-way',
      isCurved: false
    };

    this.trafficLightOptions = {
      type: 'overhead_gantry',
      rotation: 0,
      state: 'green'
    };

    this.zoneOptions = {
      category: 'hospital'
    };

    // Interaction states
    this.isMouseDown = false;
    this.isDragging = false;
    this.dragStartScreen = { x: 0, y: 0 };
    this.dragStartWorld = { x: 0, y: 0 };
    this.dragTarget = null; // { type, id, ... }
    this.resizeCorner = null; // 'tl'|'tr'|'br'|'bl'
    this.isSpacePanning = false;

    // Road drawing chain
    this.roadStartNode = null;

    // Zone drawing state
    this.zoneDrawingStart = null;

    // Bind event handlers
    this.initEventListeners();
  }

  setTool(toolName) {
    this.activeTool = toolName;
    this.renderer.previewData = null;
    this.roadStartNode = null;
    this.zoneDrawingStart = null;
    this.dragTarget = null;
    this.resizeCorner = null;

    // Update UI buttons
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === toolName);
    });

    // Update tool options subpanels
    const roadOpt = document.getElementById('opt-road-panel');
    const trafficOpt = document.getElementById('opt-traffic-panel');
    const zoneOpt = document.getElementById('opt-zone-panel');

    if (roadOpt) roadOpt.style.display = toolName === 'road' ? 'flex' : 'none';
    if (trafficOpt) trafficOpt.style.display = toolName === 'traffic_light' ? 'flex' : 'none';
    if (zoneOpt) zoneOpt.style.display = toolName === 'zone' ? 'flex' : 'none';

    // Update cursor & toast guide
    this.updateCursor();
    this.updateGuideToast();
    this.renderer.render();
  }

  updateCursor() {
    if (this.isSpacePanning || this.activeTool === 'pan') {
      this.canvas.style.cursor = this.isMouseDown ? 'grabbing' : 'grab';
    } else if (this.activeTool === 'road' || this.activeTool === 'zone') {
      this.canvas.style.cursor = 'crosshair';
    } else if (this.activeTool === 'delete') {
      this.canvas.style.cursor = 'not-allowed';
    } else if (this.activeTool === 'traffic_light') {
      this.canvas.style.cursor = 'cell';
    } else {
      this.canvas.style.cursor = 'default';
    }
  }

  updateGuideToast() {
    const toast = document.getElementById('tool-guide-toast');
    if (!toast) return;

    const msgs = {
      select: 'Select Mode: Click roads, zones, or signals to inspect and drag.',
      road: 'Road Tool: Click start point/node, then click end point. (Esc to cancel)',
      traffic_light: 'Signal Tool: Click anywhere on roads/junctions to place a traffic unit.',
      zone: 'Zone Tool: Click and drag to create a city zone block.',
      pan: 'Pan Tool: Click and drag to navigate the canvas.',
      delete: 'Delete Tool: Click any element to remove it.'
    };

    toast.querySelector('.guide-msg').textContent = msgs[this.activeTool] || '';
  }

  // =========================================================================
  // Event Listeners
  // =========================================================================

  initEventListeners() {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  // =========================================================================
  // Mouse Handling
  // =========================================================================

  onMouseDown(e) {
    if (e.target !== this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPos = this.renderer.screenToWorld(screenX, screenY);
    const snappedWorld = this.renderer.snapPoint(worldPos.x, worldPos.y);

    this.isMouseDown = true;
    this.isDragging = false;
    this.dragStartScreen = { x: screenX, y: screenY };
    this.dragStartWorld = { ...worldPos };

    // Middle click or Spacebar => Pan canvas immediately
    if (e.button === 1 || this.isSpacePanning || this.activeTool === 'pan') {
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return; // Left click only for drawing/selecting

    // --- Delete Tool ---
    if (this.activeTool === 'delete') {
      const hit = this.hitTest(worldPos.x, worldPos.y);
      if (hit) {
        this.state.selectItem(hit.type, hit.id);
        this.state.deleteSelected();
        this.renderer.render();
      }
      return;
    }

    // --- Select Tool ---
    if (this.activeTool === 'select') {
      // 1. Check if clicking a zone resize handle
      if (this.state.selectedItem && this.state.selectedItem.type === 'zone') {
        const zone = this.state.zones.get(this.state.selectedItem.id);
        if (zone) {
          const handle = this.hitTestZoneResizeHandles(zone, worldPos.x, worldPos.y);
          if (handle) {
            this.resizeCorner = handle;
            this.dragTarget = { type: 'zone_resize', id: zone.id, initial: { ...zone } };
            return;
          }
        }
      }

      // 2. Normal hit-test
      const hit = this.hitTest(worldPos.x, worldPos.y);
      if (hit) {
        this.state.selectItem(hit.type, hit.id);
        this.dragTarget = {
          type: hit.type,
          id: hit.id,
          initial: this.cloneEntity(hit.type, hit.id)
        };
      } else {
        this.state.selectItem(null);
      }
      this.renderer.render();
      return;
    }

    // --- Add Road Tool ---
    if (this.activeTool === 'road') {
      // Find or create start node
      let node = this.state.findNodeNear(worldPos.x, worldPos.y, 4.0);
      if (!this.roadStartNode) {
        if (!node) {
          node = this.state.addNode(snappedWorld.x, snappedWorld.y);
        }
        this.roadStartNode = node;
        this.renderer.previewData = {
          type: 'road_drawing',
          startX: node.x,
          startY: node.y,
          currentX: snappedWorld.x,
          currentY: snappedWorld.y,
          width: this.roadOptions.width
        };
      } else {
        // Complete road segment
        let endNode = node;
        if (!endNode) {
          endNode = this.state.addNode(snappedWorld.x, snappedWorld.y);
        }

        if (endNode.id !== this.roadStartNode.id) {
          let controlPoint = null;
          if (this.roadOptions.isCurved) {
            // Default arc control point perpendicular to midpoint
            const mx = (this.roadStartNode.x + endNode.x) / 2;
            const my = (this.roadStartNode.y + endNode.y) / 2;
            const dx = endNode.x - this.roadStartNode.x;
            const dy = endNode.y - this.roadStartNode.y;
            controlPoint = { x: mx - dy * 0.25, y: my + dx * 0.25 };
          }

          const newRoad = this.state.addRoad(this.roadStartNode.id, endNode.id, {
            width: this.roadOptions.width,
            flow: this.roadOptions.flow,
            isCurved: this.roadOptions.isCurved,
            controlPoint
          });
          this.state.selectItem('road', newRoad.id);
        }

        // Keep chaining from end node!
        this.roadStartNode = endNode;
        this.renderer.previewData = {
          type: 'road_drawing',
          startX: endNode.x,
          startY: endNode.y,
          currentX: snappedWorld.x,
          currentY: snappedWorld.y,
          width: this.roadOptions.width
        };
      }
      this.renderer.render();
      return;
    }

    // --- Add Traffic Light / Sensor Tool ---
    if (this.activeTool === 'traffic_light') {
      const nearestRoad = this.findNearestRoad(worldPos.x, worldPos.y, 10.0);
      const newTL = this.state.addTrafficLight({
        x: snappedWorld.x,
        y: snappedWorld.y,
        type: this.trafficLightOptions.type,
        rotation: this.trafficLightOptions.rotation,
        state: this.trafficLightOptions.state,
        roadId: nearestRoad ? nearestRoad.id : null,
        sensorType: this.trafficLightOptions.type === 'overhead_gantry' ? 'esp32_cam' :
                    this.trafficLightOptions.type === 'smart_sensor' ? 'ultrasonic' : 'none'
      });
      this.state.selectItem('traffic_light', newTL.id);
      this.renderer.render();
      return;
    }

    // --- Add Zone Tool ---
    if (this.activeTool === 'zone') {
      this.zoneDrawingStart = { ...snappedWorld };
      this.renderer.previewData = {
        type: 'zone_drawing',
        startX: snappedWorld.x,
        startY: snappedWorld.y,
        currentX: snappedWorld.x,
        currentY: snappedWorld.y
      };
      return;
    }
  }

  onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPos = this.renderer.screenToWorld(screenX, screenY);
    const snappedWorld = this.renderer.snapPoint(worldPos.x, worldPos.y);

    // Update status bar coordinates
    const statusCoords = document.getElementById('status-coords');
    if (statusCoords) {
      statusCoords.textContent = `X: ${worldPos.x.toFixed(1)} cm, Y: ${worldPos.y.toFixed(1)} cm`;
    }

    // Pan Canvas
    if (this.isMouseDown && (e.buttons === 4 || this.isSpacePanning || this.activeTool === 'pan')) {
      const dx = screenX - this.dragStartScreen.x;
      const dy = screenY - this.dragStartScreen.y;
      this.renderer.panX += dx;
      this.renderer.panY += dy;
      this.dragStartScreen = { x: screenX, y: screenY };
      this.renderer.render();
      return;
    }

    // Check drag threshold
    if (this.isMouseDown && !this.isDragging) {
      const dist = Math.hypot(screenX - this.dragStartScreen.x, screenY - this.dragStartScreen.y);
      if (dist > 3) {
        this.isDragging = true;
        if (this.dragTarget) {
          this.state.recordHistory();
        }
      }
    }

    // Handle Dragging in Select Tool
    if (this.isDragging && this.dragTarget) {
      const dt = this.dragTarget;
      const dx = snappedWorld.x - this.renderer.snap(this.dragStartWorld.x);
      const dy = snappedWorld.y - this.renderer.snap(this.dragStartWorld.y);

      if (dt.type === 'node') {
        const node = this.state.nodes.get(dt.id);
        if (node) {
          node.x = dt.initial.x + dx;
          node.y = dt.initial.y + dy;
          this.state.notify('node_updated', node);
        }
      } else if (dt.type === 'traffic_light') {
        const tl = this.state.trafficLights.get(dt.id);
        if (tl) {
          tl.x = dt.initial.x + dx;
          tl.y = dt.initial.y + dy;
          this.state.notify('traffic_light_updated', tl);
        }
      } else if (dt.type === 'zone') {
        const zone = this.state.zones.get(dt.id);
        if (zone) {
          zone.x = dt.initial.x + dx;
          zone.y = dt.initial.y + dy;
          this.state.notify('zone_updated', zone);
        }
      } else if (dt.type === 'zone_resize') {
        const zone = this.state.zones.get(dt.id);
        if (zone && this.resizeCorner) {
          this.handleZoneResize(zone, dt.initial, snappedWorld, this.resizeCorner);
          this.state.notify('zone_updated', zone);
        }
      } else if (dt.type === 'road') {
        // Move connected nodes
        const road = this.state.roads.get(dt.id);
        if (road) {
          const from = this.state.nodes.get(road.fromNode);
          const to = this.state.nodes.get(road.toNode);
          if (from && dt.initial.from) {
            from.x = dt.initial.from.x + dx;
            from.y = dt.initial.from.y + dy;
          }
          if (to && dt.initial.to) {
            to.x = dt.initial.to.x + dx;
            to.y = dt.initial.to.y + dy;
          }
          if (road.isCurved && road.controlPoint && dt.initial.ctrl) {
            road.controlPoint.x = dt.initial.ctrl.x + dx;
            road.controlPoint.y = dt.initial.ctrl.y + dy;
          }
          this.state.notify('road_updated', road);
        }
      }
      this.renderer.render();
      return;
    }

    // Road preview update
    if (this.activeTool === 'road' && this.roadStartNode) {
      this.renderer.previewData = {
        type: 'road_drawing',
        startX: this.roadStartNode.x,
        startY: this.roadStartNode.y,
        currentX: snappedWorld.x,
        currentY: snappedWorld.y,
        width: this.roadOptions.width
      };
      this.renderer.render();
      return;
    }

    // Zone preview update
    if (this.activeTool === 'zone' && this.zoneDrawingStart && this.isMouseDown) {
      this.renderer.previewData = {
        type: 'zone_drawing',
        startX: this.zoneDrawingStart.x,
        startY: this.zoneDrawingStart.y,
        currentX: snappedWorld.x,
        currentY: snappedWorld.y
      };
      this.renderer.render();
      return;
    }

    // Hover detection for cursor & tooltips
    if (!this.isMouseDown && this.activeTool === 'select') {
      const hit = this.hitTest(worldPos.x, worldPos.y);
      this.state.hoveredItem = hit;
      this.canvas.style.cursor = hit ? 'pointer' : 'default';
      this.renderer.render();
    }
  }

  onMouseUp(e) {
    this.isMouseDown = false;

    // Finalize zone drawing
    if (this.activeTool === 'zone' && this.zoneDrawingStart) {
      const rect = this.canvas.getBoundingClientRect();
      const worldPos = this.renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const snappedWorld = this.renderer.snapPoint(worldPos.x, worldPos.y);

      let w = Math.abs(snappedWorld.x - this.zoneDrawingStart.x);
      let h = Math.abs(snappedWorld.y - this.zoneDrawingStart.y);
      let x = Math.min(this.zoneDrawingStart.x, snappedWorld.x);
      let y = Math.min(this.zoneDrawingStart.y, snappedWorld.y);

      // If user merely clicked without dragging, place a default 25x20 block
      if (w < 4 || h < 4) {
        w = 25;
        h = 20;
        x = snappedWorld.x - w / 2;
        y = snappedWorld.y - h / 2;
      }

      const newZone = this.state.addZone({
        category: this.zoneOptions.category,
        x,
        y,
        width: w,
        height: h
      });

      this.state.selectItem('zone', newZone.id);
      this.zoneDrawingStart = null;
      this.renderer.previewData = null;
      this.renderer.render();
    }

    this.isDragging = false;
    this.dragTarget = null;
    this.resizeCorner = null;
    this.updateCursor();
  }

  onWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    this.renderer.setZoom(this.renderer.zoom * zoomFactor, mouseX, mouseY);

    // Update HUD
    const hudZoom = document.getElementById('hud-zoom-level');
    if (hudZoom) {
      hudZoom.textContent = `${Math.round(this.renderer.zoom * 100)}%`;
    }
  }

  onDoubleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const worldPos = this.renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hit = this.hitTest(worldPos.x, worldPos.y);

    if (hit && hit.type === 'traffic_light') {
      // Direct double-click cycles signal state: Red -> Yellow -> Green!
      this.state.cycleTrafficLightState(hit.id);
      this.renderer.render();
    }
  }

  // =========================================================================
  // Keyboard Shortcuts
  // =========================================================================

  onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    const key = e.key.toLowerCase();

    // Hotkeys
    if (key === 'v' || key === '1') this.setTool('select');
    else if (key === 'r' || key === '2') this.setTool('road');
    else if (key === 't' || key === '3') this.setTool('traffic_light');
    else if (key === 'z' && !e.ctrlKey && !e.metaKey) this.setTool('zone');
    else if (key === 'h') this.setTool('pan');
    else if (key === 'delete' || key === 'backspace') {
      e.preventDefault();
      this.state.deleteSelected();
      this.renderer.render();
    }
    else if (key === 'escape') {
      // Cancel road chaining or drawing
      this.roadStartNode = null;
      this.zoneDrawingStart = null;
      this.renderer.previewData = null;
      this.state.selectItem(null);
      this.renderer.render();
    }
    else if (key === ' ' && !this.isSpacePanning) {
      this.isSpacePanning = true;
      this.updateCursor();
    }
    // Undo / Redo
    else if ((e.ctrlKey || e.metaKey) && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        this.state.redo();
      } else {
        this.state.undo();
      }
      this.renderer.render();
    }
    else if ((e.ctrlKey || e.metaKey) && key === 'y') {
      e.preventDefault();
      this.state.redo();
      this.renderer.render();
    }
  }

  onKeyUp(e) {
    if (e.key === ' ') {
      this.isSpacePanning = false;
      this.updateCursor();
    }
  }

  // =========================================================================
  // Hit-Testing Algorithms
  // =========================================================================

  hitTest(worldX, worldY) {
    // 1. Traffic Lights (highest priority)
    for (const tl of this.state.trafficLights.values()) {
      const dist = Math.hypot(tl.x - worldX, tl.y - worldY);
      if (dist <= 4.5) {
        return { type: 'traffic_light', id: tl.id };
      }
    }

    // 2. Nodes
    for (const node of this.state.nodes.values()) {
      const dist = Math.hypot(node.x - worldX, node.y - worldY);
      if (dist <= 3.5) {
        return { type: 'node', id: node.id };
      }
    }

    // 3. Roads
    for (const road of this.state.roads.values()) {
      const from = this.state.nodes.get(road.fromNode);
      const to = this.state.nodes.get(road.toNode);
      if (!from || !to) continue;

      const halfW = (road.width || 20) / 2 + 1.5;
      if (road.isCurved && road.controlPoint) {
        // Curve approximation hit-test
        const dist = this.distToQuadraticBezier(worldX, worldY, from.x, from.y, road.controlPoint.x, road.controlPoint.y, to.x, to.y);
        if (dist <= halfW) {
          return { type: 'road', id: road.id };
        }
      } else {
        // Straight line segment hit-test
        const dist = this.distToSegment(worldX, worldY, from.x, from.y, to.x, to.y);
        if (dist <= halfW) {
          return { type: 'road', id: road.id };
        }
      }
    }

    // 4. Zones
    for (const zone of this.state.zones.values()) {
      if (
        worldX >= zone.x &&
        worldX <= zone.x + zone.width &&
        worldY >= zone.y &&
        worldY <= zone.y + zone.height
      ) {
        return { type: 'zone', id: zone.id };
      }
    }

    return null;
  }

  distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);

    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
  }

  distToQuadraticBezier(px, py, x0, y0, cx, cy, x1, y1) {
    let minDist = Infinity;
    const steps = 15;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pt = this.renderer.getQuadraticBezierPoint(x0, y0, cx, cy, x1, y1, t);
      const d = Math.hypot(px - pt.x, py - pt.y);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  hitTestZoneResizeHandles(zone, worldX, worldY) {
    const handleRadius = 2.0; // cm
    const corners = {
      tl: { x: zone.x, y: zone.y },
      tr: { x: zone.x + zone.width, y: zone.y },
      br: { x: zone.x + zone.width, y: zone.y + zone.height },
      bl: { x: zone.x, y: zone.y + zone.height }
    };

    for (const [key, c] of Object.entries(corners)) {
      if (Math.hypot(worldX - c.x, worldY - c.y) <= handleRadius) {
        return key;
      }
    }
    return null;
  }

  handleZoneResize(zone, initial, snappedWorld, corner) {
    if (corner === 'br') {
      zone.width = Math.max(5, snappedWorld.x - initial.x);
      zone.height = Math.max(5, snappedWorld.y - initial.y);
    } else if (corner === 'bl') {
      const right = initial.x + initial.width;
      zone.x = Math.min(right - 5, snappedWorld.x);
      zone.width = right - zone.x;
      zone.height = Math.max(5, snappedWorld.y - initial.y);
    } else if (corner === 'tr') {
      const bottom = initial.y + initial.height;
      zone.width = Math.max(5, snappedWorld.x - initial.x);
      zone.y = Math.min(bottom - 5, snappedWorld.y);
      zone.height = bottom - zone.y;
    } else if (corner === 'tl') {
      const right = initial.x + initial.width;
      const bottom = initial.y + initial.height;
      zone.x = Math.min(right - 5, snappedWorld.x);
      zone.y = Math.min(bottom - 5, snappedWorld.y);
      zone.width = right - zone.x;
      zone.height = bottom - zone.y;
    }
  }

  findNearestRoad(x, y, maxDist = 8.0) {
    let nearest = null;
    let minDist = maxDist;
    for (const road of this.state.roads.values()) {
      const from = this.state.nodes.get(road.fromNode);
      const to = this.state.nodes.get(road.toNode);
      if (!from || !to) continue;
      const d = this.distToSegment(x, y, from.x, from.y, to.x, to.y);
      if (d < minDist) {
        minDist = d;
        nearest = road;
      }
    }
    return nearest;
  }

  cloneEntity(type, id) {
    if (type === 'node') {
      const n = this.state.nodes.get(id);
      return n ? { ...n } : null;
    }
    if (type === 'traffic_light') {
      const tl = this.state.trafficLights.get(id);
      return tl ? { ...tl } : null;
    }
    if (type === 'zone') {
      const z = this.state.zones.get(id);
      return z ? { ...z } : null;
    }
    if (type === 'road') {
      const r = this.state.roads.get(id);
      if (!r) return null;
      const from = this.state.nodes.get(r.fromNode);
      const to = this.state.nodes.get(r.toNode);
      return {
        ...r,
        from: from ? { ...from } : null,
        to: to ? { ...to } : null,
        ctrl: r.controlPoint ? { ...r.controlPoint } : null
      };
    }
    return null;
  }
}

window.ToolController = ToolController;
