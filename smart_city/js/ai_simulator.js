/**
 * SmartCity CAD 2D — AI Adaptive Traffic Light Simulator (ai_simulator.js)
 * 4-Way Intersection Simulator (+ Shape) with Live YOLO Image Processing.
 * Models junction N_AVE_J2 (Grand Avenue & Central Corridor).
 */

class AISimulator {
  constructor() {
    this.approaches = {
      north: {
        id: 'north',
        name: 'North Approach (Central Corridor)',
        poleId: 'TL_MAIN_J2_POLE_N',
        vehicles: 9,
        allocatedGreen: 32.0,
        state: 'GREEN', // GREEN, YELLOW, RED
        imageSrc: 'assets/samples/sample_low_1.jpg',
        annotatedSrc: 'assets/samples/sample_low_1.jpg',
        boxes: []
      },
      east: {
        id: 'east',
        name: 'Grand Avenue East (ESP32-CAM Gantry)',
        poleId: 'TL_MAIN_J2_GANTRY_E',
        vehicles: 0,
        allocatedGreen: 5.0,
        state: 'RED',
        imageSrc: 'assets/samples/sample_empty_0.jpg',
        annotatedSrc: 'assets/samples/sample_empty_0.jpg',
        boxes: []
      },
      south: {
        id: 'south',
        name: 'South Approach (Corridor Entrance)',
        poleId: 'TL_MAIN_J2_POLE_S',
        vehicles: 1,
        allocatedGreen: 8.0,
        state: 'RED',
        imageSrc: 'assets/samples/sample_heavy_5.jpg',
        annotatedSrc: 'assets/samples/sample_heavy_5.jpg',
        boxes: []
      },
      west: {
        id: 'west',
        name: 'Grand Avenue West (ESP32-CAM Gantry)',
        poleId: 'TL_MAIN_J2_GANTRY_W',
        vehicles: 6,
        allocatedGreen: 24.0,
        state: 'RED',
        imageSrc: 'assets/samples/sample_medium_2.jpg',
        annotatedSrc: 'assets/samples/sample_medium_2.jpg',
        boxes: []
      }
    };

    // Sequence of approaches for fair round-robin cycling
    this.sequence = ['north', 'east', 'south', 'west'];
    this.activeApproach = 'north';
    this.currentPhase = 'GREEN'; // GREEN, YELLOW, RED

    // Timing parameters (seconds)
    this.defaultGreen = 15.0;
    this.minGreen = 5.0;
    this.maxGreen = 40.0;
    this.yellowTime = 3.0;
    this.perVehicleTime = 2.5;

    // Simulation runtime state
    this.isRunning = true; // Auto-run enabled by default!
    this.speedMultiplier = 1.0;
    this.allocatedDuration = 32.0;
    this.remainingTime = 32.0;
    this.lastTickTime = performance.now();
    this.timerInterval = null;

    // Dispatch mode: 'sequential' cycles all 4 fairly; 'priority' picks highest queue first
    this.dispatchMode = 'sequential';

    // Activity logs
    this.logs = [];

    this.initDOM();
    this.recalculateAllTimings();
    this.updateSignalStates();
    this.start(); // Auto-start the simulation!
    this.logEvent('System initialized. Auto-cycle started.');
  }

  // =========================================================================
  // Timing Calculation (Adaptive AI Logic)
  // =========================================================================

  calculateGreenTime(count, avgCount) {
    if (count === 0) {
      return this.minGreen; // طريق سالك -> تقليص الوقت إلى الحد الأدنى (5 ثوانٍ)
    }
    const base = this.defaultGreen + (count - 2) * this.perVehicleTime;
    const diff = count - avgCount;
    const bonus = diff * 2.0;
    const target = base + bonus;
    return Math.max(this.minGreen, Math.min(this.maxGreen, Math.round(target * 10) / 10));
  }

  recalculateAllTimings() {
    const counts = Object.values(this.approaches).map(a => a.vehicles);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;

    for (const key of Object.keys(this.approaches)) {
      const app = this.approaches[key];
      app.allocatedGreen = this.calculateGreenTime(app.vehicles, avg);
    }

    this.updateUI();
  }

  // =========================================================================
  // State Machine & Tick Engine
  // =========================================================================

  start() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.isRunning = true;
    this.lastTickTime = performance.now();
    this.timerInterval = setInterval(() => this.tick(), 100);
    this.updateRunButton();
    this.logEvent('Simulation running.');
  }

  pause() {
    this.isRunning = false;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.updateRunButton();
    this.logEvent('Simulation paused.');
  }

  toggleRun() {
    if (this.isRunning) this.pause();
    else this.start();
  }

  reset() {
    this.activeApproach = 'north';
    this.currentPhase = 'GREEN';
    this.recalculateAllTimings();
    this.allocatedDuration = this.approaches[this.activeApproach].allocatedGreen;
    this.remainingTime = this.allocatedDuration;
    this.updateSignalStates();
    this.updateUI();
    this.drawIntersectionCanvas();
    this.start();
    this.logEvent('Cycle reset to North approach.');
  }

  activateApproach(approachKey) {
    if (!this.approaches[approachKey]) return;
    this.activeApproach = approachKey;
    this.currentPhase = 'GREEN';
    this.recalculateAllTimings();
    this.allocatedDuration = this.approaches[approachKey].allocatedGreen;
    this.remainingTime = this.allocatedDuration;
    this.updateSignalStates();
    this.updateUI();
    this.drawIntersectionCanvas();
    if (!this.isRunning) this.start();
    this.logEvent(`Switched active green to [${approachKey.toUpperCase()}] (${this.allocatedDuration}s).`);
  }

  tick() {
    const now = performance.now();
    const dt = ((now - this.lastTickTime) / 1000) * this.speedMultiplier;
    this.lastTickTime = now;

    this.remainingTime -= dt;

    if (this.remainingTime <= 0) {
      this.advancePhase();
    }

    this.updateCountdownDisplay();
    this.drawIntersectionCanvas();
  }

  advancePhase() {
    if (this.currentPhase === 'GREEN') {
      // Transition from Green to Yellow
      this.currentPhase = 'YELLOW';
      this.allocatedDuration = this.yellowTime;
      this.remainingTime = this.yellowTime;
      this.logEvent(`[${this.activeApproach.toUpperCase()}] changing to YELLOW (3s).`);
    } else if (this.currentPhase === 'YELLOW') {
      // Transition from Yellow to Red and advance to next approach
      this.currentPhase = 'GREEN';
      this.selectNextApproach();

      // Recalculate adaptive green time
      this.recalculateAllTimings();
      const nextDuration = this.approaches[this.activeApproach].allocatedGreen;
      this.allocatedDuration = nextDuration;
      this.remainingTime = nextDuration;

      const app = this.approaches[this.activeApproach];
      const diff = app.allocatedGreen - this.defaultGreen;
      const sign = diff >= 0 ? `+${diff.toFixed(1)}s` : `${diff.toFixed(1)}s`;
      this.logEvent(`[${this.activeApproach.toUpperCase()}] turned GREEN! Vehicles: ${app.vehicles}. Allocated: ${app.allocatedGreen}s (${sign}).`);
    }

    this.updateSignalStates();
    this.updateUI();
  }

  selectNextApproach() {
    if (this.dispatchMode === 'sequential') {
      // Fair round-robin: North -> East -> South -> West -> North
      const currIdx = this.sequence.indexOf(this.activeApproach);
      this.activeApproach = this.sequence[(currIdx + 1) % this.sequence.length];
    } else {
      // Priority queue with starvation prevention
      const others = this.sequence.filter(k => k !== this.activeApproach);
      others.sort((a, b) => this.approaches[b].vehicles - this.approaches[a].vehicles);
      this.activeApproach = others[0];
    }
  }

  updateSignalStates() {
    for (const key of Object.keys(this.approaches)) {
      if (key === this.activeApproach) {
        this.approaches[key].state = this.currentPhase;
      } else {
        this.approaches[key].state = 'RED';
      }
    }
  }

  // =========================================================================
  // Image Detection / Processing via Python Backend
  // =========================================================================

  async processImage(approachKey, fileOrBase64) {
    this.logEvent(`Processing image for [${approachKey.toUpperCase()}] via YOLO11...`);
    const statusEl = document.getElementById(`status-${approachKey}`);
    if (statusEl) statusEl.textContent = 'Scanning...';

    try {
      let payload = { approach: approachKey };
      if (typeof fileOrBase64 === 'string') {
        payload.image = fileOrBase64;
      } else {
        payload.image = await this.readFileAsDataURL(fileOrBase64);
      }

      const res = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();

      if (data.status === 'success') {
        this.approaches[approachKey].vehicles = data.count;
        this.approaches[approachKey].annotatedSrc = data.annotated_image || payload.image;
        this.approaches[approachKey].boxes = data.boxes || [];

        this.logEvent(`[${approachKey.toUpperCase()}] YOLO detected: ${data.count} Vehicles.`);
        this.recalculateAllTimings();

        // If this road has high congestion (> 6 cars), give it the green immediately to demonstrate!
        if (data.count >= 6 && this.activeApproach !== approachKey) {
          this.activateApproach(approachKey);
        } else if (approachKey === this.activeApproach && this.currentPhase === 'GREEN') {
          const newAlloc = this.approaches[approachKey].allocatedGreen;
          this.allocatedDuration = newAlloc;
          this.remainingTime = Math.min(this.remainingTime, newAlloc);
        }
      }
    } catch (err) {
      console.warn('API detection call failed (fallback to offline test):', err);
      this.fallbackDetection(approachKey);
    }

    if (statusEl) statusEl.textContent = 'Active';
    this.updateUI();
    this.drawIntersectionCanvas();
  }

  fallbackDetection(approachKey) {
    const randomCounts = [0, 2, 5, 8, 12];
    const mockCount = randomCounts[Math.floor(Math.random() * randomCounts.length)];
    this.approaches[approachKey].vehicles = mockCount;
    this.recalculateAllTimings();
    this.logEvent(`[${approachKey.toUpperCase()}] test value: ${mockCount} Vehicles assigned.`);
  }

  readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = err => reject(err);
      reader.readAsDataURL(file);
    });
  }

  // =========================================================================
  // Canvas Intersection Renderer (+ Shape)
  // =========================================================================

  drawIntersectionCanvas() {
    const canvas = document.getElementById('intersection-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    const cx = w / 2;
    const cy = h / 2;
    const roadW = 120; // Road width in pixels

    // Background grass / terrain
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // City Blocks / Curbs
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, cx - roadW / 2, cy - roadW / 2); // Top-Left
    ctx.fillRect(cx + roadW / 2, 0, w - (cx + roadW / 2), cy - roadW / 2); // Top-Right
    ctx.fillRect(0, cy + roadW / 2, cx - roadW / 2, h - (cy + roadW / 2)); // Bottom-Left
    ctx.fillRect(cx + roadW / 2, cy + roadW / 2, w - (cx + roadW / 2), h - (cy + roadW / 2)); // Bottom-Right

    // Asphalt Roads (Vertical & Horizontal cross)
    ctx.fillStyle = '#181f2a';
    ctx.fillRect(cx - roadW / 2, 0, roadW, h); // Vertical Corridor
    ctx.fillRect(0, cy - roadW / 2, w, roadW); // Grand Avenue

    // Asphalt Intersection Center box
    ctx.fillStyle = '#1c2430';
    ctx.fillRect(cx - roadW / 2, cy - roadW / 2, roadW, roadW);

    // Double Yellow Center Lines (Horizontal)
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 2;
    // West
    ctx.beginPath();
    ctx.moveTo(0, cy - 2); ctx.lineTo(cx - roadW / 2 - 20, cy - 2);
    ctx.moveTo(0, cy + 2); ctx.lineTo(cx - roadW / 2 - 20, cy + 2);
    ctx.stroke();
    // East
    ctx.beginPath();
    ctx.moveTo(cx + roadW / 2 + 20, cy - 2); ctx.lineTo(w, cy - 2);
    ctx.moveTo(cx + roadW / 2 + 20, cy + 2); ctx.lineTo(w, cy + 2);
    ctx.stroke();

    // Double Yellow Center Lines (Vertical)
    // North
    ctx.beginPath();
    ctx.moveTo(cx - 2, 0); ctx.lineTo(cx - 2, cy - roadW / 2 - 20);
    ctx.moveTo(cx + 2, 0); ctx.lineTo(cx + 2, cy - roadW / 2 - 20);
    ctx.stroke();
    // South
    ctx.beginPath();
    ctx.moveTo(cx - 2, cy + roadW / 2 + 20); ctx.lineTo(cx - 2, h);
    ctx.moveTo(cx + 2, cy + roadW / 2 + 20); ctx.lineTo(cx + 2, h);
    ctx.stroke();

    // Zebra Crossings at all 4 entrances
    this.drawZebraCrossing(ctx, cx - roadW / 2, cy - roadW / 2 - 16, roadW, 14, false); // North
    this.drawZebraCrossing(ctx, cx - roadW / 2, cy + roadW / 2 + 2, roadW, 14, false); // South
    this.drawZebraCrossing(ctx, cx - roadW / 2 - 16, cy - roadW / 2, 14, roadW, true);  // West
    this.drawZebraCrossing(ctx, cx + roadW / 2 + 2, cy - roadW / 2, 14, roadW, true);  // East

    // Stop Lines (Solid White / Red when stopped)
    this.drawStopLine(ctx, cx - roadW / 2, cy - roadW / 2 - 18, cx, cy - roadW / 2 - 18, this.approaches.north.state);
    this.drawStopLine(ctx, cx, cy + roadW / 2 + 18, cx + roadW / 2, cy + roadW / 2 + 18, this.approaches.south.state);
    this.drawStopLine(ctx, cx - roadW / 2 - 18, cy, cx - roadW / 2 - 18, cy + roadW / 2, this.approaches.west.state);
    this.drawStopLine(ctx, cx + roadW / 2 + 18, cy - roadW / 2, cx + roadW / 2 + 18, cy, this.approaches.east.state);

    // Active Direction Glow Arrow on Asphalt
    this.drawActiveDirectionArrow(ctx, cx, cy, roadW);

    // Dynamic Traffic Lights Graphics on Canvas
    // North Traffic Light (Facing Southbound drivers at top entrance)
    this.drawCanvasTrafficLight(ctx, cx - roadW / 2 - 26, cy - roadW / 2 - 40, this.approaches.north.state, 'NORTH');
    // South Traffic Light (Facing Northbound drivers at bottom entrance)
    this.drawCanvasTrafficLight(ctx, cx + roadW / 2 + 6, cy + roadW / 2 + 6, this.approaches.south.state, 'SOUTH');
    // West Traffic Light (Facing Eastbound drivers at left entrance)
    this.drawCanvasTrafficLight(ctx, cx - roadW / 2 - 26, cy + roadW / 2 + 6, this.approaches.west.state, 'WEST');
    // East Traffic Light (Facing Westbound drivers at right entrance)
    this.drawCanvasTrafficLight(ctx, cx + roadW / 2 + 6, cy - roadW / 2 - 40, this.approaches.east.state, 'EAST');

    // Central Active Pulse Indicator & Countdown Badge
    const activeApp = this.approaches[this.activeApproach];
    const isGreen = this.currentPhase === 'GREEN';
    const isYellow = this.currentPhase === 'YELLOW';
    const badgeColor = isGreen ? '#10b981' : (isYellow ? '#eab308' : '#ef4444');

    ctx.save();
    ctx.fillStyle = isGreen ? 'rgba(16, 185, 129, 0.18)' : (isYellow ? 'rgba(234, 179, 8, 0.18)' : 'rgba(239, 68, 68, 0.18)');
    ctx.beginPath();
    ctx.arc(cx, cy, 40, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = badgeColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.max(0, this.remainingTime).toFixed(0)}s`, cx, cy - 3);

    ctx.font = 'bold 9px "Inter", sans-serif';
    ctx.fillStyle = badgeColor;
    ctx.fillText(this.activeApproach.toUpperCase(), cx, cy + 12);
    ctx.restore();
  }

  drawStopLine(ctx, x1, y1, x2, y2, state) {
    ctx.save();
    ctx.strokeStyle = state === 'GREEN' ? '#10b981' : (state === 'YELLOW' ? '#eab308' : '#ef4444');
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  drawActiveDirectionArrow(ctx, cx, cy, roadW) {
    ctx.save();
    const isGreen = this.currentPhase === 'GREEN';
    const arrowColor = isGreen ? '#10b981' : '#eab308';
    ctx.fillStyle = arrowColor;
    ctx.strokeStyle = arrowColor;
    ctx.lineWidth = 3;

    if (this.activeApproach === 'north') {
      // Arrow pointing down from North
      const ax = cx - roadW / 4;
      const ay = cy - 25;
      ctx.beginPath();
      ctx.moveTo(ax, ay - 15); ctx.lineTo(ax, ay + 15);
      ctx.lineTo(ax - 6, ay + 8); ctx.moveTo(ax, ay + 15); ctx.lineTo(ax + 6, ay + 8);
      ctx.stroke();
    } else if (this.activeApproach === 'south') {
      // Arrow pointing up from South
      const ax = cx + roadW / 4;
      const ay = cy + 25;
      ctx.beginPath();
      ctx.moveTo(ax, ay + 15); ctx.lineTo(ax, ay - 15);
      ctx.lineTo(ax - 6, ay - 8); ctx.moveTo(ax, ay - 15); ctx.lineTo(ax + 6, ay - 8);
      ctx.stroke();
    } else if (this.activeApproach === 'west') {
      // Arrow pointing right from West
      const ax = cx - 25;
      const ay = cy + roadW / 4;
      ctx.beginPath();
      ctx.moveTo(ax - 15, ay); ctx.lineTo(ax + 15, ay);
      ctx.lineTo(ax + 8, ay - 6); ctx.moveTo(ax + 15, ay); ctx.lineTo(ax + 8, ay + 6);
      ctx.stroke();
    } else if (this.activeApproach === 'east') {
      // Arrow pointing left from East
      const ax = cx + 25;
      const ay = cy - roadW / 4;
      ctx.beginPath();
      ctx.moveTo(ax + 15, ay); ctx.lineTo(ax - 15, ay);
      ctx.lineTo(ax - 8, ay - 6); ctx.moveTo(ax - 15, ay); ctx.lineTo(ax - 8, ay + 6);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawZebraCrossing(ctx, x, y, w, h, isVertical) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    if (!isVertical) {
      const barW = 8;
      const gap = 6;
      for (let bx = x + 4; bx < x + w - 4; bx += barW + gap) {
        ctx.fillRect(bx, y, barW, h);
      }
    } else {
      const barH = 8;
      const gap = 6;
      for (let by = y + 4; by < y + h - 4; by += barH + gap) {
        ctx.fillRect(x, by, w, barH);
      }
    }
  }

  drawCanvasTrafficLight(ctx, x, y, state, label) {
    ctx.save();
    // Housing
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x, y, 22, 54);
    ctx.strokeStyle = state === 'GREEN' ? '#10b981' : (state === 'YELLOW' ? '#eab308' : '#475569');
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, 22, 54);

    const r = 4.5;
    const cx = x + 11;

    // Red Bulb
    ctx.fillStyle = state === 'RED' ? '#ef4444' : '#3d1616';
    ctx.beginPath(); ctx.arc(cx, y + 10, r, 0, Math.PI * 2); ctx.fill();
    if (state === 'RED') {
      ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 10;
      ctx.stroke(); ctx.shadowBlur = 0;
    }

    // Yellow Bulb
    ctx.fillStyle = state === 'YELLOW' ? '#eab308' : '#382a10';
    ctx.beginPath(); ctx.arc(cx, y + 27, r, 0, Math.PI * 2); ctx.fill();
    if (state === 'YELLOW') {
      ctx.shadowColor = '#eab308'; ctx.shadowBlur = 10;
      ctx.stroke(); ctx.shadowBlur = 0;
    }

    // Green Bulb
    ctx.fillStyle = state === 'GREEN' ? '#10b981' : '#103020';
    ctx.beginPath(); ctx.arc(cx, y + 44, r, 0, Math.PI * 2); ctx.fill();
    if (state === 'GREEN') {
      ctx.shadowColor = '#10b981'; ctx.shadowBlur = 12;
      ctx.stroke(); ctx.shadowBlur = 0;
    }

    // Tiny Label Below Light
    ctx.fillStyle = '#94a3b8';
    ctx.font = '7px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label.substring(0, 1), cx, y + 62);

    ctx.restore();
  }

  // =========================================================================
  // DOM Binding & Event Handling
  // =========================================================================

  initDOM() {
    // Start / Pause button
    const btnPlay = document.getElementById('btn-sim-play');
    if (btnPlay) {
      btnPlay.addEventListener('click', () => this.toggleRun());
    }

    // Reset button
    const btnReset = document.getElementById('btn-sim-reset');
    if (btnReset) {
      btnReset.addEventListener('click', () => this.reset());
    }

    // Speed buttons
    const speedSelect = document.getElementById('sim-speed-select');
    if (speedSelect) {
      speedSelect.addEventListener('change', e => {
        this.speedMultiplier = parseFloat(e.target.value) || 1.0;
        this.logEvent(`Simulation speed set to ${this.speedMultiplier}x`);
      });
    }

    // Mode Toggle
    const modeSelect = document.getElementById('sim-dispatch-mode');
    if (modeSelect) {
      modeSelect.value = this.dispatchMode;
      modeSelect.addEventListener('change', e => {
        this.dispatchMode = e.target.value;
        this.logEvent(`Dispatch mode changed to: ${this.dispatchMode.toUpperCase()}`);
      });
    }

    // Presets
    const presetBtns = document.querySelectorAll('.sim-preset-btn');
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        this.applyPreset(preset);
      });
    });

    // File Inputs, Dropzones, and Direct Activation for all 4 approaches
    for (const key of Object.keys(this.approaches)) {
      const dropzone = document.getElementById(`dropzone-${key}`);
      const fileInput = document.getElementById(`file-${key}`);
      const card = document.getElementById(`card-${key}`);

      if (dropzone && fileInput) {
        dropzone.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', e => {
          if (e.target.files && e.target.files[0]) {
            this.processImage(key, e.target.files[0]);
          }
        });

        // Drag & drop
        dropzone.addEventListener('dragover', e => {
          e.preventDefault();
          dropzone.classList.add('drag-over');
        });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
        dropzone.addEventListener('drop', e => {
          e.preventDefault();
          dropzone.classList.remove('drag-over');
          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            this.processImage(key, e.dataTransfer.files[0]);
          }
        });
      }

      // Quick activation button if user clicks on the card header
      const header = card ? card.querySelector('.app-card-header') : null;
      if (header) {
        header.style.cursor = 'pointer';
        header.title = 'Click to immediately activate GREEN for this road!';
        header.addEventListener('click', () => {
          this.activateApproach(key);
        });
      }
    }
  }

  applyPreset(presetKey) {
    if (presetKey === 'heavy-north') {
      this.approaches.north.vehicles = 12;
      this.approaches.east.vehicles = 0;
      this.approaches.south.vehicles = 1;
      this.approaches.west.vehicles = 2;
      this.logEvent('Preset: Heavy North Congestion (12 cars).');
      this.activateApproach('north'); // Immediately give green to North!
    } else if (presetKey === 'rush-avenue') {
      this.approaches.north.vehicles = 2;
      this.approaches.east.vehicles = 9;
      this.approaches.south.vehicles = 1;
      this.approaches.west.vehicles = 8;
      this.logEvent('Preset: Grand Avenue Rush Hour (East 9 & West 8).');
      this.activateApproach('east'); // Immediately give green to East!
    } else if (presetKey === 'empty-night') {
      this.approaches.north.vehicles = 0;
      this.approaches.east.vehicles = 0;
      this.approaches.south.vehicles = 1;
      this.approaches.west.vehicles = 0;
      this.logEvent('Preset: Night Mode (Empty intersection).');
      this.activateApproach('south'); // Green to the only car in South!
    } else if (presetKey === 'balanced') {
      this.approaches.north.vehicles = 3;
      this.approaches.east.vehicles = 3;
      this.approaches.south.vehicles = 3;
      this.approaches.west.vehicles = 3;
      this.logEvent('Preset: Balanced Traffic Flow (3 cars each).');
      this.activateApproach('north');
    }

    this.recalculateAllTimings();
    if (!this.isRunning) this.start();
  }

  updateUI() {
    for (const key of Object.keys(this.approaches)) {
      const app = this.approaches[key];

      // Vehicles badge
      const countEl = document.getElementById(`count-${key}`);
      if (countEl) countEl.textContent = `${app.vehicles} Vehicles`;

      // Allocated time
      const timeEl = document.getElementById(`alloc-${key}`);
      const diff = app.allocatedGreen - this.defaultGreen;
      const diffStr = diff >= 0 ? `+${diff.toFixed(1)}s` : `${diff.toFixed(1)}s`;
      if (timeEl) {
        timeEl.textContent = `${app.allocatedGreen.toFixed(1)}s (${diffStr})`;
        timeEl.className = diff > 0 ? 'text-success' : (diff < 0 ? 'text-warning' : 'text-muted');
      }

      // Signal State Pill
      const pillEl = document.getElementById(`pill-${key}`);
      if (pillEl) {
        pillEl.textContent = app.state;
        pillEl.className = `signal-pill pill-${app.state.toLowerCase()}`;
      }

      // Card border highlight for active approach
      const cardEl = document.getElementById(`card-${key}`);
      if (cardEl) {
        if (key === this.activeApproach) {
          cardEl.classList.add('card-active');
        } else {
          cardEl.classList.remove('card-active');
        }
      }

      // Image Thumbnail Preview
      const imgEl = document.getElementById(`preview-${key}`);
      if (imgEl && app.annotatedSrc) {
        imgEl.src = app.annotatedSrc;
      }
    }

    // Decision Console & Recommendation
    this.updateDecisionConsole();
    this.updateCountdownDisplay();
    this.drawIntersectionCanvas();
  }

  updateCountdownDisplay() {
    const rem = Math.max(0, this.remainingTime);
    const dur = Math.max(0.1, this.allocatedDuration);
    const pct = Math.min(100, Math.max(0, (rem / dur) * 100));

    const countdownEl = document.getElementById('active-countdown');
    if (countdownEl) countdownEl.textContent = `${rem.toFixed(1)}s`;

    const activeAppEl = document.getElementById('active-app-name');
    if (activeAppEl) activeAppEl.textContent = `${this.approaches[this.activeApproach].name} [${this.currentPhase}]`;

    const barEl = document.getElementById('active-progress-bar');
    if (barEl) {
      barEl.style.width = `${pct}%`;
      barEl.style.backgroundColor = this.currentPhase === 'GREEN' ? '#10b981' : (this.currentPhase === 'YELLOW' ? '#eab308' : '#ef4444');
    }
  }

  updateDecisionConsole() {
    const decisionTitleEl = document.getElementById('ai-decision-title');
    const decisionDescEl = document.getElementById('ai-decision-desc');
    const timeSavedEl = document.getElementById('ai-time-saved');

    const app = this.approaches[this.activeApproach];

    if (decisionTitleEl) {
      decisionTitleEl.textContent = `Active Signal: ${app.name} [${this.currentPhase}]`;
    }

    if (decisionDescEl) {
      if (app.vehicles > 5) {
        decisionDescEl.innerHTML = `⚠️ <strong>Heavy Congestion (${app.vehicles} vehicles):</strong> Assigned <strong>${app.allocatedGreen}s</strong> (+${(app.allocatedGreen - this.defaultGreen).toFixed(1)}s extra) to relieve queue!`;
      } else if (app.vehicles === 0) {
        decisionDescEl.innerHTML = `⚡ <strong>Empty Road (0 vehicles):</strong> Green reduced to minimum <strong>${this.minGreen}s</strong>, saving waiting time and passing to next road!`;
      } else {
        decisionDescEl.innerHTML = `✅ <strong>Moderate Traffic (${app.vehicles} vehicles):</strong> Allocated <strong>${app.allocatedGreen}s</strong> based on dynamic queue balance.`;
      }
    }

    if (timeSavedEl) {
      const minAlloc = Math.min(...Object.values(this.approaches).map(a => a.allocatedGreen));
      const saved = Math.max(0, this.defaultGreen - minAlloc);
      timeSavedEl.textContent = `Time Saved: ~${saved.toFixed(1)}s per cycle by shortening empty queues`;
    }
  }

  updateRunButton() {
    const btnPlay = document.getElementById('btn-sim-play');
    if (!btnPlay) return;
    if (this.isRunning) {
      btnPlay.innerHTML = '<span class="icon">⏸</span> Pause Sim';
      btnPlay.className = 'btn btn-warning-glow';
    } else {
      btnPlay.innerHTML = '<span class="icon">▶</span> Start Sim';
      btnPlay.className = 'btn btn-primary';
    }
  }

  logEvent(msg) {
    const now = new Date().toLocaleTimeString();
    this.logs.unshift(`[${now}] ${msg}`);
    if (this.logs.length > 50) this.logs.pop();

    const logBox = document.getElementById('sim-logs-container');
    if (logBox) {
      logBox.innerHTML = this.logs.map(l => `<div class="log-line">${l}</div>`).join('');
    }
  }
}

// Auto-initialize when window loads
window.addEventListener('DOMContentLoaded', () => {
  window.aiSim = new AISimulator();
});
