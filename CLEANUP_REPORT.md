# AquaSystem — Code Cleanup & Refactoring Report

**Date:** 2026-06-12  
**Scope:** `index.html`, `style.css`, `script.js`  
**Methodology:** Full dependency map built across all three files before any deletion. Every removed item was confirmed absent in HTML, absent as a dynamic JS class/ID reference, and absent from any active call chain.

---

## Summary

| File | Original | Cleaned | Saved | Reduction |
|------|----------|---------|-------|-----------|
| `index.html` | 75,787 B | 75,787 B | 0 B | 0% — no dead code found |
| `style.css` | 36,581 B | 33,132 B | 3,449 B | **9.4%** |
| `script.js` | 86,862 B | 80,993 B | 5,869 B | **6.8%** |
| **Total** | **199,230 B** | **189,912 B** | **9,318 B** | **4.7%** |

**Active functionality changed:** None. All API integrations, sensor polling, actuator control, chart rendering, camera module, alarm system, authentication, RBAC, and export features remain fully intact.

---

## Dependency Map (Pre-Cleanup)

Before any deletion, the following mapping was built:

- **HTML → CSS:** Every `class=` attribute was extracted and matched against CSS selectors.
- **HTML → JS:** Every `id=`, `onclick=`, `onchange=`, and `oninput=` was mapped to JS function calls.
- **JS → HTML:** Every `getElementById()`, `querySelector()`, and dynamic `className` injection was verified against HTML IDs and CSS selectors.
- **JS → JS:** All function calls were traced to confirm no removed function is called by an active code path.

---

## index.html

**Result: No changes made.**

The HTML file was clean. All elements, IDs, classes, and event handler bindings map to active CSS rules or JavaScript functions. The file was left byte-for-byte identical.

---

## style.css — Items Removed

### 1. `@keyframes float`
- **Why:** Only consumer was `.tank-wave`, which itself is dead (never used in HTML or JS).
- **Safe:** Removing the only consumer and its keyframe together — no other animation references `float`.

### 2. `@keyframes water`
- **Why:** No CSS selector, HTML element, or JS code ever references this animation.
- **Safe:** Confirmed zero usage anywhere in the codebase.

### 3. `.theme-toggle`
- **Why:** No HTML element carries this class. No JS adds it dynamically.
- **Safe:** Fully orphaned selector.

### 4. `.pill-warn`
- **Why:** Not present in any HTML element. Not injected by JavaScript (`.pill-ok`, `.pill-danger`, and `.pill-dot` are used by JS and were kept).
- **Safe:** The active pill variants (`pill-ok`, `pill-danger`, `pill-dot`, `.status-pill`) were preserved.

### 5. `.act-runtime`
- **Why:** Not in any static HTML. Not in any `innerHTML` template in JS (the active `buildActuatorGroupReal` template was checked — it does not include `act-runtime`).
- **Safe:** Pure orphan.

### 6. `.sc-danger::before`
- **Why:** No HTML sensor card uses class `sc-danger`. No JS adds `sc-danger` to any element.
- **Safe:** `.sc-ok`, `.sc-warn`, `.sc-cyan` (all used) were preserved.

### 7. `.si-danger`, `.si-purple`
- **Why:** No HTML stat icon uses these classes. No JS injects them. Active variants `si-cyan`, `si-green`, `si-warn` preserved.
- **Safe:** Confirmed zero HTML/JS usage.

### 8. `.ss-danger`, `.ss-cyan`
- **Why:** No HTML sensor status badge uses these. No JS produces them. Active variants `ss-ok`, `ss-warn` preserved.
- **Safe:** Confirmed zero HTML/JS usage.

### 9. `.val-danger`
- **Why:** No HTML element uses this class. Not injected by JS (which uses `val-cyan`, `val-ok`, `val-warn` — all preserved).
- **Safe:** Confirmed zero usage.

### 10. `.badge-purple`
- **Why:** No HTML uses this badge variant. No JS injects it. Active badge variants preserved.
- **Safe:** Confirmed zero usage.

### 11. `.btn-success`
- **Why:** No HTML button uses this class. No JS adds it. Active button variants preserved.
- **Safe:** Confirmed zero usage.

### 12. `.dev-status`
- **Why:** `.dev-name` and `.dev-sub` (siblings in device rows) are used; `.dev-status` is not referenced in any HTML element or JS template.
- **Safe:** Confirmed zero usage.

### 13. `.code-block`
- **Why:** No HTML element uses this class. No JS injects it.
- **Safe:** Confirmed zero usage.

### 14. `.divider`
- **Why:** No HTML element uses this class. Not to be confused with `.sidebar-divider` (kept, used in HTML).
- **Safe:** Confirmed zero usage.

### 15. `.tag`, `.tag-blue`
- **Why:** No HTML element uses either class. No JS injects them.
- **Safe:** Confirmed zero usage.

### 16. `.text-danger`
- **Why:** No HTML element uses this class. No JS injects it. Active text utility `.text-warn`, `.text-cyan`, `.text-green`, `.text-muted`, `.text-dim` preserved.
- **Safe:** Confirmed zero usage.

### 17. `.flex-1`, `.flex-col`, `.flex-gap`
- **Why:** None present in any HTML element class list. Not injected by JS.
- **Safe:** Active layout helpers `.flex`, `.gap1`, `.gap2` preserved.

### 18. `.g3`, `.g4`
- **Why:** No HTML element uses 3-column or 4-column grid. Only `.g2` (2-column) is used.
- **Safe:** `.g2` and `.gauto`/`.gauto-sm` preserved.

### 19. `.mb05`, `.mb1` (from compound margin line)
- **Why:** Neither class appears in any HTML element. Only `.mb15` is used (it was on the same CSS line and was preserved).
- **Safe:** `.mb15` and `.mt15` (both used in HTML) were carefully extracted and kept.

### 20. `.mt05`, `.mt1` (from compound margin line)
- **Why:** Same as above — neither class in HTML. `.mt15` is used and was preserved.

### 21. `.prog-bar`, `.prog-fill`
- **Why:** No HTML element uses either class. Not injected by JS. (The sensor progress bars use `.sc-bar` / `.sc-fill`, which are different selectors — both kept.)
- **Safe:** Confirmed zero usage.

### 22. `.tab-panel`, `.tab-panel.active`
- **Why:** No HTML element uses `.tab-panel`. Only `.tab-btn` is used in the alarm center. Not injected by JS.
- **Safe:** `.tab-bar`, `.tab-btn`, `.tab-btn.active` preserved.

### 23. `.separator`, `.separator::before`, `.separator::after`, `.separator span`
- **Why:** No HTML element uses the `.separator` class. Not injected by JS.
- **Safe:** Confirmed zero usage.

### 24. Tank Visualization block: `.tank-container`, `.tank-body`, `.tank-fill`, `.tank-wave`, `.tank-label`, `.tank-pct`, `.tank-status-dot`
- **Why:** These 7 selectors form a complete tank SVG visualization system that was removed from the HTML. The tank overview now uses `.stat-card` + `.sc-bar`/`.sc-fill` (via `renderTankGrid()` in JS). Not a single one of the 7 tank-viz classes appears in any HTML element or JS template.
- **Note:** `.tank-grid` was **kept** — it is the layout grid container used in `#ov-tanks` and styled in HTML with `class="tank-grid"`. Only the inner visualization classes were removed.
- **Safe:** `.tank-grid` preserved. All 7 inner tank-viz classes confirmed dead.

---

## script.js — Items Removed

### 1. First (overridden) `buildActuatorPanels()` function — lines ~1345–1356
- **Why:** JavaScript allows function re-declaration; the second `buildActuatorPanels()` defined later in the file overrides this one completely. The first version calls `buildActuatorGroup()` (a dead helper) and `wirePumpSpeedSlider()` (a function that is never defined anywhere in the file), so it was already broken before removal.
- **Safe:** The second (active) `buildActuatorPanels()` using `buildActuatorGroupReal()` is preserved intact.

### 2. `buildActuatorGroup()` function — helper for dead first `buildActuatorPanels`
- **Why:** Only ever called by the now-removed first `buildActuatorPanels()`. Not called from HTML or any other active JS path. Used `buildActuatorCard()` (also dead) and referenced `act-toggle-PLACEHOLDER-${name}` IDs that were never created.
- **Safe:** The active equivalent is `buildActuatorGroupReal()` (preserved).

### 3. `buildActuatorCard()` function — helper for dead `buildActuatorGroup`
- **Why:** Only called by the now-removed `buildActuatorGroup()`. Generated cards with `id="act-toggle-PLACEHOLDER-${name}"` — a placeholder string indicating it was a draft. The active implementation is in `buildActuatorGroupReal()` using correct namespaced IDs.
- **Safe:** `buildActuatorGroupReal()` (preserved) is the production implementation.

### 4. `renderAIInsights()` function + its call in `renderSensors()`
- **Why:** This function exclusively targets `document.getElementById('ai-insights')`, which does not exist anywhere in `index.html`. The function early-returns on line 1 of its body (`if (!el) return`), meaning it has been silently doing nothing on every sensor poll cycle.
- **Safe:** No HTML element or active feature depends on this function.

### 5. `updateSystemStatusPill()` function + its call in `fetchSensors()`
- **Why:** This function exclusively targets `document.getElementById('system-status-pill')`, which does not exist in `index.html`. The function early-returns immediately. It was being called on every sensor poll, silently doing nothing.
- **Note:** A `.topbar .status-pill:not(#system-status-pill)` querySelector also appeared in `renderCameraLatest()` as a companion reference — also removed (see item 6).
- **Safe:** No HTML element or active feature depends on this function.

### 6. Dead DOM references in `renderCameraLatest()` — `ecp-status-pill` block
- **Why:** The three lines targeting `document.getElementById('ecp-status-pill')` and `.topbar .status-pill:not(#system-status-pill)` reference elements that don't exist in HTML. Both are guarded by `if (pill)` so no runtime error occurred, but the code was permanently dead.
- **Note:** The camera status is correctly shown in the `#ecp-cam-status` mini-stat element (preserved) and in the overview `#esp-camera-val` card (preserved via `_fetchESP32CameraStatus()`).
- **Safe:** `renderCameraLatest()` still renders the image, timestamp, download button, and all existing overlay logic.

### 7. `setCameraOffline()` — dead `ecp-status-pill` reference inside it
- **Why:** The function body only contained a reference to `#ecp-status-pill` (non-existent). The function itself is still called from `fetchCameraLatest()`'s catch block so it must exist — a minimal stub was left in its place. The camera offline state is now handled by `_applyDeviceCardState()` via `_fetchESP32CameraStatus()`.
- **Safe:** Function kept as a stub. Call site in `fetchCameraLatest` preserved.

### 8. Dead `controlIds` entries in `applyRoleUI()`
- **Why:** The `controlIds` array contained 4 IDs that don't exist in HTML: `sup-valve3-toggle`, `pump1-speed-slider`, `alarm-buzzer-toggle`, `alarm-led-toggle`. The code was guarded (`if (el) el.disabled = !admin`) so no error occurred, but it was dead iteration on every login/session-restore.
- **Kept:** `pump2-toggle` — the only ID from the array that actually exists in HTML and controls the Pump 2 on/off toggle.
- **Safe:** RBAC for dynamically generated actuator toggles is handled by the `actContainers` loop (preserved) and by `buildActuatorGroupReal()` which calls `applyRoleUI()` after DOM rebuild.

### 9. `ecpRefreshLatest()` function
- **Why:** This one-line wrapper (`{ fetchCameraLatest(); }`) is not called from any HTML `onclick`/`onchange`/`oninput` handler, nor from any active JS code path. It was dead code.
- **Safe:** `fetchCameraLatest()` itself (preserved) is called directly by `startAllPolls()` and `ecpTriggerCapture()`.

---

## Confirmation: No Active Functionality Changed

| Feature | Status |
|---------|--------|
| Login / Register / Logout | ✅ Unchanged |
| Session restore (sessionStorage) | ✅ Unchanged |
| RBAC (Admin/Viewer/Operator) | ✅ Unchanged — pump2-toggle still in controlIds |
| Sensor polling (MQTT/API) | ✅ Unchanged |
| Sensor Management table + range editor | ✅ Unchanged |
| Sensor alert modal | ✅ Unchanged |
| Actuator control (all 13 relays) | ✅ Unchanged — uses buildActuatorGroupReal |
| PWM pump speed slider | ✅ Unchanged — buildPumpSpeedControls preserved |
| Pump 2 ON/OFF toggle | ✅ Unchanged — wirePumpToggle preserved |
| Alarm center (fetch, resolve, filter) | ✅ Unchanged |
| Historical analytics charts | ✅ Unchanged |
| Data history table + CSV export | ✅ Unchanged |
| Custom reports | ✅ Unchanged |
| Automation settings | ✅ Unchanged |
| User management panel | ✅ Unchanged |
| Plants & Fish reference panel | ✅ Unchanged |
| ESP32 Camera (capture, gallery, timelapse) | ✅ Unchanged |
| ESP32 device status polling | ✅ Unchanged |
| Overview dashboard (stat cards, tank grid) | ✅ Unchanged |
| Notification panel | ✅ Unchanged |
| Profile panel | ✅ Unchanged |
| All 6 monitoring panels | ✅ Unchanged |
| Flow monitoring + pipe visualization | ✅ Unchanged |

---

*Report generated by Senior Frontend Engineer / Code Refactoring Expert analysis.*
