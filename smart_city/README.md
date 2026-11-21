# SmartCity CAD 2D — Interactive Miniature Map Editor (160cm × 120cm)

A clean, modular, and high-performance 2D vector CAD map editor built with vanilla HTML5 Canvas, modern CSS, and ES6 JavaScript. Designed specifically for a **160cm × 120cm physical miniature smart city testbed** with edge IoT hardware (Raspberry Pi 4B master controller, ESP32-CAM overhead gantries, and multi-phase traffic signals).

---

## 🏛️ System Architecture & File Structure

```
smart city/
├── index.html              # Modern dark-mode CAD application shell & top navigation tabs
├── css/
│   └── style.css           # Engineering CAD styling, toolbars, HUD, and inspector theme
├── js/
│   ├── state.js            # Centralized JSON state store, Dijkstra routing engine & undo/redo
│   ├── renderer.js         # Crisp 2D Canvas vector engine, asphalt road marks & signal glowing
│   ├── tools.js            # Interactive tool state machine: Select, Road, Signal, Zone, Pan, Del
│   └── app.js              # UI controller, event bindings, JSON import/export, and live sim
├── assets/
│   └── reference-layout.jpg # Attached physical 160cm x 120cm miniature table reference photo
└── README.md               # Architecture documentation & hardware integration schema
```

---

## 📐 Physical Scale & Coordinates

- **World Board Dimensions:** `160.0 cm` (Width) × `120.0 cm` (Height).
- **Coordinate System:** Strictly centimeter-based world coordinates (`X: 0..160 cm`, `Y: 0..120 cm`).
- **Base Display Ratio:** `1 cm = 5.0 px` ($800 \times 600\text{ px}$ unzoomed viewport).
- **Main Horizontal Avenue:** `20.0 cm` wide dual-way corridor with double solid yellow divider and zebra crosswalks.
- **Secondary / Bypass Roads:** `14.0 cm` wide single/dual-lane arterial routes.
- **Central Roundabout:** Outer diameter `28.0 cm` with rotary circulation arrows and a central landscaped hub.
- **Master Control Hub (Raspberry Pi 4B):** Positioned at bottom-right corner (`X: 134..157 cm`, `Y: 104..117 cm`), reflecting the physical acrylic bracket mount.

---

## 🛠️ Interactive Toolset & Features

| Tool | Hotkey | Description |
| :--- | :---: | :--- |
| **Select & Move** | `V` / `1` | Click any road, node, zone, or signal to edit properties in the Inspector Panel. Drag elements with optional **Snap-to-Grid** (1, 2, 5, or 10 cm). Resizes zones via corner anchors. |
| **Add Road** | `R` / `2` | Draw straight or curved road segments. Configurable width: **20cm Main Avenue** or **14cm Secondary/Bypass**. Supports continuous node chaining (`Esc` to end). |
| **Flow Control** | — | Configure road flow: `Two-Way` (opposing lane arrows), `One-Way Forward`, `One-Way Reverse`, or `Roundabout` (rotary flow). |
| **Traffic Signals** | `T` / `3` | Place traffic units anywhere on the grid. Selectable types: **Overhead Gantry + ESP32-CAM**, **Standard 3-LED Pole**, or **Smart Sensor Node (IR / Ultrasonic)**. Rotates 0°, 90°, 180°, 270°. Double-click to cycle Red &rarr; Yellow &rarr; Green! |
| **City Zones** | `Z` / `4` | Click and drag rectangular blocks for **Hospital**, **Central Park**, **Commercial District**, **Residential Area**, **Tech Hub**, or **Control Hub**. |
| **Pan Canvas** | `H` / `Space` | Pan smoothly across the board. Mouse wheel zooms smoothly into cursor focus. |
| **Delete** | `Del` | Remove selected item or click on elements in delete mode. |
| **Undo / Redo** | `Ctrl+Z` / `Ctrl+Y` | Full 40-step history stack for all modifications. |
| **Ref Photo Overlay**| Header Slider | Fade in the actual reference photograph of the physical testbed to verify alignment with vector CAD roads. |
| **Live Sim** | HUD Button | Simulates real-time signal cycling and publishes mock MQTT telemetry packets. |

---

## 💾 Data Persistence & JSON Schema (Raspberry Pi / Flutter)

The entire map state exports as a standard JSON schema consumed directly by your Raspberry Pi Python scripts and Flutter mobile app:

```json
{
  "metadata": {
    "title": "Miniature Smart City 160cm x 120cm",
    "boardWidthCm": 160.0,
    "boardHeightCm": 120.0,
    "baseScalePxPerCm": 5.0,
    "version": "1.0.0"
  },
  "nodes": [
    { "id": "N_AVE_W", "x": 20, "y": 92, "name": "Main Ave West", "type": "junction" }
  ],
  "roads": [
    {
      "id": "R_AVE_1",
      "name": "Grand Avenue",
      "fromNode": "N_AVE_W",
      "toNode": "N_AVE_J1",
      "width": 20,
      "flow": "two-way",
      "type": "avenue",
      "lanes": 2,
      "speedLimit": 50
    }
  ],
  "trafficLights": [
    {
      "id": "TL_MAIN_J2_GANTRY_W",
      "name": "Overhead Gantry West Approach (ESP32-CAM)",
      "x": 72,
      "y": 92,
      "rotation": 90,
      "type": "overhead_gantry",
      "state": "green",
      "sensorType": "esp32_cam",
      "roadId": "R_AVE_2"
    }
  ],
  "zones": [
    {
      "id": "ZONE_HOSPITAL",
      "name": "Metro Hospital & Trauma Center",
      "category": "hospital",
      "x": 98,
      "y": 24,
      "width": 32,
      "height": 22,
      "color": "#dc2626"
    }
  ]
}
```

---

## 🧭 Live Dijkstra / A* Routing Simulation

Navigate to the **"Project Info & Live Monitor"** tab to test the built-in graph solver:
1. Select an origin zone (e.g., *Residential Area West*).
2. Select an emergency destination (e.g., *Hospital & Trauma Center*).
3. Click **Simulate Shortest Emergency Route**.
4. The engine computes the shortest path respecting **one-way** and **roundabout rotary constraints**, reports transit time in seconds, and provides a button to highlight the animated route ribbon directly on the 2D canvas!

---

## 🚀 How to Run Locally

You can launch the editor using any local HTTP static server:

```bash
# Using Python 3:
cd "/home/ms/Desktop/smart city"
python3 -m http.server 8080

# Then open in your browser:
# http://localhost:8080
```
Or open `index.html` directly in any modern web browser (Chrome, Edge, Firefox, Safari).
