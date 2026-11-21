/**
 * SmartCity CAD 2D — Canvas Rendering Engine (renderer.js)
 * High-performance, crisp 2D vector CAD renderer for 160cm x 120cm miniature smart city layout.
 * Features: High-DPI handling, pan/zoom, blueprint grid, asphalt roads with realistic markings,
 * directional flow arrows, realistic 3-LED poles, overhead ESP32-CAM gantries, IR/US sensors,
 * and reference photo alignment overlay.
 */

class CityRenderer {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = state;

    // Viewport transform
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
    this.minZoom = 0.2;
    this.maxZoom = 4.0;

    // Display options
    this.showGrid = true;
    this.snapToGrid = true;
    this.gridStepCm = 5.0; // cm
    this.showArrows = true;
    this.showLabels = true;
    this.showNodes = true;
    this.refPhotoOpacity = 0.0; // 0..1

    // Reference Photo Image
    this.refImage = new Image();
    this.refImageLoaded = false;
    this.refImage.src = 'assets/reference-layout.jpg';
    this.refImage.onload = () => {
      this.refImageLoaded = true;
      this.render();
    };

    // Animation loop & pulse effect
    this.animTime = 0;
    this.animFrameId = null;

    // Active tool preview data
    this.previewData = null; // { type, ... }

    // Bind resize
    window.addEventListener('resize', () => this.handleResize());
    this.handleResize();
    this.fitBoardToView();

    // Start render loop for smooth glowing signals & arrows
    this.startLoop();
  }

  // =========================================================================
  // Viewport & Coordinate Transforms
  // =========================================================================

  handleResize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.render();
  }

  fitBoardToView() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const boardW = this.state.metadata.boardWidthCm * this.state.metadata.baseScalePxPerCm;
    const boardH = this.state.metadata.boardHeightCm * this.state.metadata.baseScalePxPerCm;

    const padding = 60; // px
    const scaleX = (rect.width - padding * 2) / boardW;
    const scaleY = (rect.height - padding * 2) / boardH;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, Math.min(scaleX, scaleY)));

    // Center the board
    this.panX = (rect.width - boardW * this.zoom) / 2;
    this.panY = (rect.height - boardH * this.zoom) / 2;
    this.render();
  }

  setZoom(newZoom, centerX = null, centerY = null) {
    const clamped = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));
    if (clamped === this.zoom) return;

    if (centerX === null || centerY === null) {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      centerX = rect.width / 2;
      centerY = rect.height / 2;
    }

    // Zoom towards center point
    const worldPos = this.screenToWorld(centerX, centerY);
    this.zoom = clamped;
    const newScreenPos = this.worldToScreen(worldPos.x, worldPos.y);

    this.panX += centerX - newScreenPos.x;
    this.panY += centerY - newScreenPos.y;
    this.render();
  }

  // Screen (pixels on canvas element) -> World (Centimeters: 0..160, 0..120)
  screenToWorld(screenX, screenY) {
    const scale = this.state.metadata.baseScalePxPerCm * this.zoom;
    const cmX = (screenX - this.panX) / scale;
    const cmY = (screenY - this.panY) / scale;
    return { x: cmX, y: cmY };
  }

  // World (Centimeters) -> Screen (pixels on canvas element)
  worldToScreen(cmX, cmY) {
    const scale = this.state.metadata.baseScalePxPerCm * this.zoom;
    const screenX = this.panX + cmX * scale;
    const screenY = this.panY + cmY * scale;
    return { x: screenX, y: screenY };
  }

  snap(cmValue, step = null) {
    if (!this.snapToGrid) return cmValue;
    const s = step || this.gridStepCm;
    return Math.round(cmValue / s) * s;
  }

  snapPoint(cmX, cmY) {
    if (!this.snapToGrid) return { x: cmX, y: cmY };
    return {
      x: this.snap(cmX),
      y: this.snap(cmY)
    };
  }

  // =========================================================================
  // Main Render Loop
  // =========================================================================

  startLoop() {
    const loop = (time) => {
      this.animTime = time / 1000;
      this.render();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  stopLoop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  render() {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();

    // Reset transform & clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Apply high-DPI + Viewport Pan/Zoom transform
    ctx.setTransform(
      dpr * this.zoom,
      0,
      0,
      dpr * this.zoom,
      dpr * this.panX,
      dpr * this.panY
    );

    const baseScale = this.state.metadata.baseScalePxPerCm;
    const boardWidthPx = this.state.metadata.boardWidthCm * baseScale;
    const boardHeightPx = this.state.metadata.boardHeightCm * baseScale;

    // --- 1. Background Table Border & CAD Surface ---
    this.renderTableFrame(ctx, boardWidthPx, boardHeightPx);

    // --- 2. Reference Photo Overlay (if opacity > 0) ---
    if (this.refPhotoOpacity > 0 && this.refImageLoaded) {
      ctx.save();
      ctx.globalAlpha = this.refPhotoOpacity;
      // Draw reference photo inside board boundaries
      ctx.drawImage(this.refImage, 0, 0, boardWidthPx, boardHeightPx);
      ctx.restore();
    }

    // --- 3. CAD Blueprint Grid & Ruler Ticks ---
    if (this.showGrid) {
      this.renderCADGrid(ctx, boardWidthPx, boardHeightPx, baseScale);
    }

    // --- 4. City Zones Blocks ---
    this.renderZones(ctx, baseScale);

    // --- 5. Road Network (Asphalt ribbons, markings, arrows) ---
    this.renderRoads(ctx, baseScale);

    // --- 6. Nodes / Junctions ---
    if (this.showNodes) {
      this.renderNodes(ctx, baseScale);
    }

    // --- 7. Traffic Lights & Sensor Nodes ---
    this.renderTrafficLights(ctx, baseScale);

    // --- 8. Dijkstra Route Simulator Highlight (if active) ---
    if (this.state.activeRouteHighlight && this.state.activeRouteHighlight.length > 1) {
      this.renderRouteHighlight(ctx, baseScale);
    }

    // --- 9. Selection & Hover Highlights ---
    this.renderSelectionHighlights(ctx, baseScale);

    // --- 10. Active Tool Drawing Ghost Previews ---
    if (this.previewData) {
      this.renderToolPreview(ctx, baseScale);
    }
  }

  // =========================================================================
  // Layer Renderers
  // =========================================================================

  renderTableFrame(ctx, w, h) {
    ctx.save();

    // Physical Table Bevel / Wood Border (simulating the physical 160x120 table)
    const bevel = 18;
    ctx.fillStyle = '#1e1b18'; // Dark wood border
    ctx.fillRect(-bevel, -bevel, w + bevel * 2, h + bevel * 2);

    ctx.strokeStyle = '#3d342a';
    ctx.lineWidth = 3;
    ctx.strokeRect(-bevel, -bevel, w + bevel * 2, h + bevel * 2);

    // Table Corner Metal Brackets
    const bracketSize = 14;
    ctx.fillStyle = '#64748b';
    ctx.fillRect(-bevel, -bevel, bracketSize, bracketSize);
    ctx.fillRect(w + bevel - bracketSize, -bevel, bracketSize, bracketSize);
    ctx.fillRect(-bevel, h + bevel - bracketSize, bracketSize, bracketSize);
    ctx.fillRect(w + bevel - bracketSize, h + bevel - bracketSize, bracketSize, bracketSize);

    // Board Work Surface
    ctx.fillStyle = '#0d131a';
    ctx.fillRect(0, 0, w, h);

    // Physical Table Boundary Line
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, w, h);

    // Board Dimension Labels
    ctx.fillStyle = '#38bdf8';
    ctx.font = '600 11px "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('160.0 cm', w / 2, -6);
    ctx.textAlign = 'left';
    ctx.fillText('120.0 cm', w + 8, h / 2);

    ctx.restore();
  }

  renderCADGrid(ctx, w, h, baseScale) {
    ctx.save();
    const boardWCm = this.state.metadata.boardWidthCm;
    const boardHCm = this.state.metadata.boardHeightCm;

    // Sub-grid: 1cm (only render if zoom is high enough)
    if (this.zoom > 1.2) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let x = 1; x < boardWCm; x++) {
        if (x % 5 === 0) continue;
        const px = x * baseScale;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
      }
      for (let y = 1; y < boardHCm; y++) {
        if (y % 5 === 0) continue;
        const py = y * baseScale;
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
      }
      ctx.stroke();
    }

    // Minor grid: 5cm
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (let x = 5; x < boardWCm; x += 5) {
      if (x % 20 === 0) continue;
      const px = x * baseScale;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (let y = 5; y < boardHCm; y += 5) {
      if (y % 20 === 0) continue;
      const py = y * baseScale;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();

    // Major grid: 20cm
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = 20; x < boardWCm; x += 20) {
      const px = x * baseScale;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (let y = 20; y < boardHCm; y += 20) {
      const py = y * baseScale;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();

    // Coordinate Ticks and numbers along edges
    ctx.fillStyle = '#64748b';
    ctx.font = '500 9px "Fira Code", monospace';
    ctx.textAlign = 'center';
    for (let x = 0; x <= boardWCm; x += 20) {
      const px = x * baseScale;
      ctx.fillRect(px - 0.5, -4, 1, 4);
      if (x > 0 && x < boardWCm) {
        ctx.fillText(`${x}`, px, -8);
      }
    }
    ctx.textAlign = 'right';
    for (let y = 0; y <= boardHCm; y += 20) {
      const py = y * baseScale;
      ctx.fillRect(-4, py - 0.5, 4, 1);
      if (y > 0 && y < boardHCm) {
        ctx.fillText(`${y}`, -8, py + 3);
      }
    }

    ctx.restore();
  }

  renderZones(ctx, baseScale) {
    ctx.save();
    for (const zone of this.state.zones.values()) {
      const x = zone.x * baseScale;
      const y = zone.y * baseScale;
      const w = zone.width * baseScale;
      const h = zone.height * baseScale;

      const isSelected = this.state.selectedItem && this.state.selectedItem.id === zone.id;
      const isHovered = this.state.hoveredItem && this.state.hoveredItem.id === zone.id;

      // Fill with soft semi-transparent color
      ctx.fillStyle = this.hexToRgba(zone.color || '#3b82f6', isSelected ? 0.32 : isHovered ? 0.24 : 0.15);
      this.roundRect(ctx, x, y, w, h, 6);
      ctx.fill();

      // Border
      ctx.strokeStyle = zone.color || '#3b82f6';
      ctx.lineWidth = isSelected ? 2.5 : 1.2;
      ctx.setLineDash(isSelected ? [] : [6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Special rendering for Control Hub (Raspberry Pi PCB mount)
      if (zone.category === 'control_hub') {
        this.renderRaspberryPiBadge(ctx, x, y, w, h);
      }

      // Zone Title Header & Dimensions with text wrapping
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 2, y + 2, w - 4, h - 4);
      ctx.clip();

      const fontSize = w < 75 ? 9 : 11;
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 ${fontSize}px var(--font-sans), sans-serif`;
      ctx.textAlign = 'left';

      // Word wrapping for narrow zones
      this.renderWrappedText(ctx, zone.name, x + 6, y + 14, w - 24, fontSize + 3);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.font = '500 8.5px "Fira Code", monospace';
      ctx.fillText(`${zone.width.toFixed(1)}×${zone.height.toFixed(1)}cm`, x + 6, y + h - 6);

      // Icon preview in top-right corner of zone
      if (w > 35) {
        this.renderZoneIcon(ctx, zone.icon || zone.category, x + w - 12, y + 14);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  renderWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let currY = y;
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line, x, currY);
        line = words[n] + ' ';
        currY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currY);
  }

  renderRaspberryPiBadge(ctx, x, y, w, h) {
    ctx.save();
    // Green PCB styling
    ctx.fillStyle = '#0f5132';
    ctx.fillRect(x + 4, y + 36, w - 8, h - 40);

    // GPIO pin header
    ctx.fillStyle = '#ffd700';
    for (let i = 0; i < 10; i++) {
      ctx.fillRect(x + 8 + i * 6, y + 40, 2, 4);
      ctx.fillRect(x + 8 + i * 6, y + 46, 2, 4);
    }

    // CPU SoC chip
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x + w / 2 - 12, y + 44, 24, 18);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + w / 2 - 12, y + 44, 24, 18);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '700 8px "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('RPi 4B', x + w / 2, y + 56);

    ctx.restore();
  }

  renderZoneIcon(ctx, icon, x, y) {
    ctx.save();
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    let char = '🏢';
    if (icon === 'hospital' || icon === 'cross') char = '🏥';
    else if (icon === 'park' || icon === 'tree') char = '🌳';
    else if (icon === 'commercial' || icon === 'cart') char = '🛍️';
    else if (icon === 'residential' || icon === 'home') char = '🏡';
    else if (icon === 'tech_hub' || icon === 'cpu') char = '💻';
    else if (icon === 'control_hub' || icon === 'server') char = '⚡';
    ctx.fillText(char, x, y);
    ctx.restore();
  }

  renderRoads(ctx, baseScale) {
    const roads = Array.from(this.state.roads.values());

    // 1. Pass 1: Asphalt Road Base
    for (const road of roads) {
      this.drawRoadSurface(ctx, road, baseScale);
    }

    // Pass 1.5: Central Roundabout Island
    this.renderRoundaboutCenterIsland(ctx, baseScale);

    // 2. Pass 2: Road Surface Markings (Yellow divider, white lane dashes, crosswalks)
    for (const road of roads) {
      this.drawRoadMarkings(ctx, road, baseScale);
    }

    // 3. Pass 3: Flow Direction Arrows
    if (this.showArrows) {
      for (const road of roads) {
        this.drawRoadArrows(ctx, road, baseScale);
      }
    }
  }

  renderRoundaboutCenterIsland(ctx, baseScale) {
    // Check if roundabout nodes exist
    const rndS = this.state.nodes.get('N_RND_S');
    const rndN = this.state.nodes.get('N_RND_N');
    const rndE = this.state.nodes.get('N_RND_E');
    const rndW = this.state.nodes.get('N_RND_W');

    if (rndS && rndN && rndE && rndW) {
      const centerX = ((rndE.x + rndW.x) / 2) * baseScale;
      const centerY = ((rndS.y + rndN.y) / 2) * baseScale;
      const radius = 5.2 * baseScale; // ~26px

      ctx.save();
      // Stone curb ring
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius + 2, 0, Math.PI * 2);
      ctx.fillStyle = '#334155';
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Landscaped Green Grass Island
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#15803d';
      ctx.fill();

      // Flowerbed / Fountain CAD Symbol
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = '#0284c7';
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⛲', centerX, centerY + 3.5);

      ctx.restore();
    }
  }

  drawRoadSurface(ctx, road, baseScale) {
    const from = this.state.nodes.get(road.fromNode);
    const to = this.state.nodes.get(road.toNode);
    if (!from || !to) return;

    const x1 = from.x * baseScale;
    const y1 = from.y * baseScale;
    const x2 = to.x * baseScale;
    const y2 = to.y * baseScale;
    const roadWidthPx = (road.width || 20) * baseScale;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Road outer border / shoulder
    ctx.strokeStyle = '#333b47';
    ctx.lineWidth = roadWidthPx + 2;
    this.strokeRoadPath(ctx, road, x1, y1, x2, y2, baseScale);

    // Asphalt surface
    ctx.strokeStyle = '#1e242d';
    ctx.lineWidth = roadWidthPx;
    this.strokeRoadPath(ctx, road, x1, y1, x2, y2, baseScale);

    ctx.restore();
  }

  strokeRoadPath(ctx, road, x1, y1, x2, y2, baseScale) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    if (road.isCurved && road.controlPoint) {
      const cx = road.controlPoint.x * baseScale;
      const cy = road.controlPoint.y * baseScale;
      ctx.quadraticCurveTo(cx, cy, x2, y2);
    } else {
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }

  drawRoadMarkings(ctx, road, baseScale) {
    const from = this.state.nodes.get(road.fromNode);
    const to = this.state.nodes.get(road.toNode);
    if (!from || !to) return;

    const x1 = from.x * baseScale;
    const y1 = from.y * baseScale;
    const x2 = to.x * baseScale;
    const y2 = to.y * baseScale;
    const roadWidthPx = (road.width || 20) * baseScale;
    const isAvenue = road.width >= 18;

    ctx.save();
    ctx.lineCap = 'butt';

    if (road.isCurved && road.controlPoint) {
      // Curved road center line
      const cx = road.controlPoint.x * baseScale;
      const cy = road.controlPoint.y * baseScale;

      ctx.strokeStyle = '#f59e0b'; // Amber yellow
      ctx.lineWidth = 2;
      if (!isAvenue) {
        ctx.setLineDash([8, 8]);
      }
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cx, cy, x2, y2);
      ctx.stroke();
    } else {
      // Straight road
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 5) {
        ctx.restore();
        return;
      }

      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;

      if (isAvenue) {
        // Double solid yellow center line for 20cm Avenue
        const gap = 2;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;

        // Line 1
        ctx.beginPath();
        ctx.moveTo(x1 + nx * gap, y1 + ny * gap);
        ctx.lineTo(x2 + nx * gap, y2 + ny * gap);
        ctx.stroke();

        // Line 2
        ctx.beginPath();
        ctx.moveTo(x1 - nx * gap, y1 - ny * gap);
        ctx.lineTo(x2 - nx * gap, y2 - ny * gap);
        ctx.stroke();

        // White dashed lane divider lines (at 1/4 and 3/4 width)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([8, 8]);

        const laneOffset = roadWidthPx * 0.25;
        // Lane divider right
        ctx.beginPath();
        ctx.moveTo(x1 + nx * laneOffset, y1 + ny * laneOffset);
        ctx.lineTo(x2 + nx * laneOffset, y2 + ny * laneOffset);
        ctx.stroke();

        // Lane divider left
        ctx.beginPath();
        ctx.moveTo(x1 - nx * laneOffset, y1 - ny * laneOffset);
        ctx.lineTo(x2 - nx * laneOffset, y2 - ny * laneOffset);
        ctx.stroke();

        ctx.setLineDash([]);
      } else {
        // 14cm Secondary road: single dashed yellow line
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Zebra Crosswalk Stripes at Avenue Intersection Approaches
      if (isAvenue && len > 40) {
        const crosswalkOffset = Math.min(18, roadWidthPx * 0.2);
        this.drawCrosswalk(ctx, x1 + ux * crosswalkOffset, y1 + uy * crosswalkOffset, ux, uy, nx, ny, roadWidthPx * 0.7);
        this.drawCrosswalk(ctx, x2 - ux * crosswalkOffset, y2 - uy * crosswalkOffset, -ux, -uy, nx, ny, roadWidthPx * 0.7);
      }
    }

    ctx.restore();
  }

  drawCrosswalk(ctx, cx, cy, ux, uy, nx, ny, width) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    const stripeCount = 6;
    const stripeW = 2.5;
    const stripeL = 8;
    const halfSpan = width / 2;

    for (let i = 0; i < stripeCount; i++) {
      const t = (i / (stripeCount - 1) - 0.5) * (width - 4);
      const sx = cx + nx * t;
      const sy = cy + ny * t;

      ctx.beginPath();
      ctx.moveTo(sx - ux * (stripeL / 2), sy - uy * (stripeL / 2));
      ctx.lineTo(sx + ux * (stripeL / 2), sy + uy * (stripeL / 2));
      ctx.lineWidth = stripeW;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRoadArrows(ctx, road, baseScale) {
    const from = this.state.nodes.get(road.fromNode);
    const to = this.state.nodes.get(road.toNode);
    if (!from || !to) return;

    const x1 = from.x * baseScale;
    const y1 = from.y * baseScale;
    const x2 = to.x * baseScale;
    const y2 = to.y * baseScale;
    const roadWidthPx = (road.width || 20) * baseScale;

    ctx.save();
    ctx.fillStyle = '#ffffff';

    if (road.isCurved && road.controlPoint) {
      // Curved road arrow (for roundabout or curves)
      const cx = road.controlPoint.x * baseScale;
      const cy = road.controlPoint.y * baseScale;

      // Sample midpoint t=0.5
      const mid = this.getQuadraticBezierPoint(x1, y1, cx, cy, x2, y2, 0.5);
      const tangent = this.getQuadraticBezierTangent(x1, y1, cx, cy, x2, y2, 0.5);
      const angle = Math.atan2(tangent.y, tangent.x);

      this.drawArrowHead(ctx, mid.x, mid.y, angle, 9);
    } else {
      // Straight road arrows
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 25) {
        ctx.restore();
        return;
      }

      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      const fwdAngle = Math.atan2(uy, ux);
      const revAngle = Math.atan2(-uy, -ux);

      const isAvenue = road.width >= 18;
      const offset = isAvenue ? roadWidthPx * 0.25 : roadWidthPx * 0.22;

      // Midpoints along road
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      if (road.flow === 'two-way') {
        // Forward arrow on right lane (+nx)
        this.drawArrowHead(ctx, midX + nx * offset, midY + ny * offset, fwdAngle, 8);
        // Reverse arrow on left lane (-nx)
        this.drawArrowHead(ctx, midX - nx * offset, midY - ny * offset, revAngle, 8);
      } else if (road.flow === 'one-way-forward') {
        this.drawArrowHead(ctx, midX, midY, fwdAngle, 9);
      } else if (road.flow === 'one-way-reverse') {
        this.drawArrowHead(ctx, midX, midY, revAngle, 9);
      } else if (road.flow === 'roundabout') {
        this.drawArrowHead(ctx, midX, midY, fwdAngle, 9);
      }
    }

    ctx.restore();
  }

  drawArrowHead(ctx, x, y, angle, size = 8) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.7, -size * 0.6);
    ctx.lineTo(-size * 0.3, 0);
    ctx.lineTo(-size * 0.7, size * 0.6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  renderNodes(ctx, baseScale) {
    ctx.save();
    for (const node of this.state.nodes.values()) {
      const x = node.x * baseScale;
      const y = node.y * baseScale;

      const isSelected = this.state.selectedItem && this.state.selectedItem.id === node.id;
      const isHovered = this.state.hoveredItem && this.state.hoveredItem.id === node.id;

      ctx.beginPath();
      ctx.arc(x, y, isSelected ? 7 : isHovered ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#3b82f6' : isHovered ? '#38bdf8' : '#64748b';
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = isSelected ? 2.5 : 1.2;
      ctx.stroke();

      // Node ID label if selected or hovered
      if (isSelected || isHovered) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 10px "Fira Code", monospace';
        ctx.fillText(node.id, x + 8, y - 8);
      }
    }
    ctx.restore();
  }

  renderTrafficLights(ctx, baseScale) {
    ctx.save();
    for (const unit of this.state.trafficLights.values()) {
      const x = unit.x * baseScale;
      const y = unit.y * baseScale;
      const isSelected = this.state.selectedItem && this.state.selectedItem.id === unit.id;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((unit.rotation * Math.PI) / 180);

      if (unit.type === 'overhead_gantry') {
        this.renderOverheadGantry(ctx, unit, isSelected);
      } else if (unit.type === 'standard_pole') {
        this.renderStandardPole(ctx, unit, isSelected);
      } else if (unit.type === 'smart_sensor') {
        this.renderSmartSensor(ctx, unit, isSelected);
      }

      ctx.restore();

      // Label below signal
      if (this.showLabels) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 9px "Fira Code", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(unit.id, x, y + 20);

        // State indicator dot
        const stateColor = unit.state === 'green' ? '#10b981' : unit.state === 'yellow' ? '#f59e0b' : '#ef4444';
        ctx.beginPath();
        ctx.arc(x, y + 28, 3, 0, Math.PI * 2);
        ctx.fillStyle = stateColor;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  renderOverheadGantry(ctx, unit, isSelected) {
    const trussWidth = 52;
    const trussHeight = 12;

    // Metal Truss Beam
    ctx.fillStyle = '#334155';
    ctx.fillRect(-trussWidth / 2, -trussHeight / 2, trussWidth, trussHeight);
    ctx.strokeStyle = isSelected ? '#38bdf8' : '#94a3b8';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(-trussWidth / 2, -trussHeight / 2, trussWidth, trussHeight);

    // Lattice Truss diagonals
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = -trussWidth / 2; i < trussWidth / 2; i += 10) {
      ctx.moveTo(i, -trussHeight / 2);
      ctx.lineTo(i + 10, trussHeight / 2);
      ctx.moveTo(i + 10, -trussHeight / 2);
      ctx.lineTo(i, trussHeight / 2);
    }
    ctx.stroke();

    // ESP32-CAM Housing in center
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-8, -12, 16, 12);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    ctx.strokeRect(-8, -12, 16, 12);

    // Camera lens aperture
    ctx.beginPath();
    ctx.arc(0, -6, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#06b6d4';
    ctx.fill();

    // Blinking telemetry status LED
    const blink = Math.sin(this.animTime * 6) > 0;
    ctx.beginPath();
    ctx.arc(5, -10, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = blink ? '#22c55e' : '#14532d';
    ctx.fill();

    // Overhead Signal Lamps (Left and Right)
    this.renderSignalHead(ctx, -18, 0, unit.state);
    this.renderSignalHead(ctx, 18, 0, unit.state);
  }

  renderStandardPole(ctx, unit, isSelected) {
    // Mounting base pole
    ctx.fillStyle = '#475569';
    ctx.fillRect(-2, 0, 4, 14);

    // Traffic Signal Box (3-LED vertical head)
    const boxW = 10;
    const boxH = 26;
    ctx.fillStyle = '#1e293b';
    this.roundRect(ctx, -boxW / 2, -boxH + 2, boxW, boxH, 3);
    ctx.fill();

    ctx.strokeStyle = isSelected ? '#38bdf8' : '#0f172a';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();

    // 3 Lamps: Red, Amber/Yellow, Green
    const redActive = unit.state === 'red';
    const yellowActive = unit.state === 'yellow';
    const greenActive = unit.state === 'green';

    this.drawTrafficLamp(ctx, 0, -boxH + 7, redActive ? '#ef4444' : '#450a0a', redActive);
    this.drawTrafficLamp(ctx, 0, -boxH + 15, yellowActive ? '#f59e0b' : '#451a03', yellowActive);
    this.drawTrafficLamp(ctx, 0, -boxH + 23, greenActive ? '#10b981' : '#064e3b', greenActive);
  }

  drawTrafficLamp(ctx, x, y, color, active) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;

    if (active) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
    }
    ctx.fill();

    // Lamp hood visor
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 3.8, Math.PI, 0);
    ctx.stroke();

    ctx.restore();
  }

  renderSignalHead(ctx, x, y, state) {
    ctx.save();
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x - 4, y - 4, 8, 8);

    const activeColor = state === 'green' ? '#10b981' : state === 'yellow' ? '#f59e0b' : '#ef4444';
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = activeColor;
    ctx.shadowColor = activeColor;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();
  }

  renderSmartSensor(ctx, unit, isSelected) {
    // Mounting Cylinder
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = isSelected ? '#38bdf8' : '#0ea5e9';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();

    // Sensor Transducers (dual ultrasonic eyes)
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(-2.5, -2, 1.8, 0, Math.PI * 2);
    ctx.arc(2.5, -2, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Animated Sensor Detection Radar Waves
    const waveRadius = 12 + (this.animTime * 15) % 18;
    ctx.strokeStyle = `rgba(14, 165, 233, ${1 - waveRadius / 30})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, waveRadius, -Math.PI * 0.75, -Math.PI * 0.25);
    ctx.stroke();
  }

  renderRouteHighlight(ctx, baseScale) {
    const route = this.state.activeRouteHighlight;
    ctx.save();
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 12;

    ctx.beginPath();
    for (let i = 0; i < route.length; i++) {
      const node = this.state.nodes.get(route[i]);
      if (!node) continue;
      const px = node.x * baseScale;
      const py = node.y * baseScale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Animated pulse dots along the route
    const dotCount = 8;
    for (let i = 0; i < dotCount; i++) {
      const t = ((this.animTime * 0.4 + i / dotCount) % 1);
      // Interpolate along route path
      const pos = this.getPointAlongNodePath(route, t, baseScale);
      if (pos) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 8;
        ctx.fill();
      }
    }

    ctx.restore();
  }

  getPointAlongNodePath(route, t, baseScale) {
    let totalLen = 0;
    const segs = [];
    for (let i = 0; i < route.length - 1; i++) {
      const n1 = this.state.nodes.get(route[i]);
      const n2 = this.state.nodes.get(route[i + 1]);
      if (!n1 || !n2) continue;
      const d = Math.hypot((n2.x - n1.x) * baseScale, (n2.y - n1.y) * baseScale);
      segs.push({ n1, n2, len: d });
      totalLen += d;
    }
    if (totalLen === 0) return null;

    let targetDist = t * totalLen;
    for (const seg of segs) {
      if (targetDist <= seg.len) {
        const segT = targetDist / seg.len;
        return {
          x: (seg.n1.x + (seg.n2.x - seg.n1.x) * segT) * baseScale,
          y: (seg.n1.y + (seg.n2.y - seg.n1.y) * segT) * baseScale
        };
      }
      targetDist -= seg.len;
    }
    return null;
  }

  renderSelectionHighlights(ctx, baseScale) {
    const sel = this.state.getSelectedItem();
    if (!sel) return;

    ctx.save();
    if (sel.type === 'road') {
      const road = sel.data;
      const from = this.state.nodes.get(road.fromNode);
      const to = this.state.nodes.get(road.toNode);
      if (from && to) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = (road.width || 20) * baseScale + 6;
        ctx.globalAlpha = 0.35;
        this.strokeRoadPath(ctx, road, from.x * baseScale, from.y * baseScale, to.x * baseScale, to.y * baseScale, baseScale);

        // Control point handle if curved
        if (road.isCurved && road.controlPoint) {
          const cx = road.controlPoint.x * baseScale;
          const cy = road.controlPoint.y * baseScale;
          ctx.globalAlpha = 1.0;
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(cx, cy, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    } else if (sel.type === 'zone') {
      const zone = sel.data;
      const x = zone.x * baseScale;
      const y = zone.y * baseScale;
      const w = zone.width * baseScale;
      const h = zone.height * baseScale;

      // 4 Corner resize handles
      const handleSize = 7;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;

      const corners = [
        { x: x, y: y },
        { x: x + w, y: y },
        { x: x + w, y: y + h },
        { x: x, y: y + h }
      ];
      for (const c of corners) {
        ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
      }
    }
    ctx.restore();
  }

  renderToolPreview(ctx, baseScale) {
    const p = this.previewData;
    if (!p) return;
    ctx.save();

    if (p.type === 'road_drawing') {
      const x1 = p.startX * baseScale;
      const y1 = p.startY * baseScale;
      const x2 = p.currentX * baseScale;
      const y2 = p.currentY * baseScale;
      const widthPx = (p.width || 20) * baseScale;

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = widthPx;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Dimension badge showing length in cm
      const lenCm = Math.hypot(p.currentX - p.startX, p.currentY - p.startY);
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(midX - 30, midY - 10, 60, 20);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.strokeRect(midX - 30, midY - 10, 60, 20);

      ctx.fillStyle = '#38bdf8';
      ctx.font = '600 10px "Fira Code", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${lenCm.toFixed(1)} cm`, midX, midY + 4);
    } else if (p.type === 'zone_drawing') {
      const x = Math.min(p.startX, p.currentX) * baseScale;
      const y = Math.min(p.startY, p.currentY) * baseScale;
      const w = Math.abs(p.currentX - p.startX) * baseScale;
      const h = Math.abs(p.currentY - p.startY) * baseScale;

      ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, w, h);

      const wCm = Math.abs(p.currentX - p.startX);
      const hCm = Math.abs(p.currentY - p.startY);
      ctx.fillStyle = '#ffffff';
      ctx.font = '500 10px "Fira Code", monospace';
      ctx.fillText(`${wCm.toFixed(1)} × ${hCm.toFixed(1)} cm`, x + 6, y + 16);
    } else if (p.type === 'signal_placement') {
      const x = p.x * baseScale;
      const y = p.y * baseScale;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  // =========================================================================
  // Math & Geometry Utilities
  // =========================================================================

  roundRect(ctx, x, y, width, height, radius = 5) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  hexToRgba(hex, alpha = 1) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }

  getQuadraticBezierPoint(x0, y0, cx, cy, x1, y1, t) {
    const inv = 1 - t;
    return {
      x: inv * inv * x0 + 2 * inv * t * cx + t * t * x1,
      y: inv * inv * y0 + 2 * inv * t * cy + t * t * y1
    };
  }

  getQuadraticBezierTangent(x0, y0, cx, cy, x1, y1, t) {
    const inv = 1 - t;
    return {
      x: 2 * inv * (cx - x0) + 2 * t * (x1 - cx),
      y: 2 * inv * (cy - y0) + 2 * t * (y1 - cy)
    };
  }
}

window.CityRenderer = CityRenderer;
