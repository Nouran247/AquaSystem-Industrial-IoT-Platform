/**
 * AquaSystem — Industrial IoT Dashboard
 * Production JavaScript · Full API Integration
 * Version: 2.0.0
 */

'use strict';

/* =====================================================================
   CONFIG
   ===================================================================== */
const API_BASE = 'https://web-production-53e821.up.railway.app';   // same-origin; change to 'http://HOST' if needed

const ENDPOINTS = {
  login:          '/api/auth/login',
  register:       '/api/auth/register',
  latestSensors:  '/api/system/latest_sensor_readings',
  history:        '/api/system/history',
  actuatorsLatest:'/api/system/actuators/latest',
  actuatorUpdate: '/api/system/actuators/single-update',
  alarmsActive:   '/api/alarms/active',
  alarmResolve:   (id) => `/api/alarms/resolve/${id}`,
  cameraLatest:   '/api/camera/latest',
  cameraHistory:  '/api/camera/history',
  cameraCapture:  '/api/camera/trigger-capture',
};

const POLL = {
  sensors:   4000,
  actuators: 4000,
  alarms:    8000,
  camera:    12000,
  history:   30000,
};

const IMG_BASE = 'http://localhost:8080';;   // prepend if images are on a different host/path

/* =====================================================================
   STATE
   ===================================================================== */
const State = {
  auth: {
    token: null,
    username: null,
    role: null,   // 'ROLE_ADMIN' | 'ROLE_OPERATOR' | 'ROLE_VIEWER'
  },
  sensors: {
    last: {},        // last valid value per field
    raw:  {},        // most recent API response (may contain nulls)
  },
  actuators: {
    current:  {},    // confirmed backend state
    pending:  new Set(),  // actuator names currently being toggled
  },
  alarms: {
    list: [],
    filter: 'all',
  },
  camera: {
    latest:   null,
    history:  [],
    tlIndex:  0,
    tlTimer:  null,
    tlSpeed:  1000,
    view:     'gallery',
  },
  history: {
    records: [],
  },
  charts: {},      // Chart.js instances by id
  timers: {},      // setInterval handles
  rt: { buffers: {}, timer: null }, // real-time chart rolling buffers + ticker
  activePanel: 'overview',
  sidebarOpen: false,
  notifOpen: false,
  modalCallback: null,
  // Normal Range definitions — { min, max } per sensor field
  // Persisted to localStorage under key 'aqua_sensor_ranges'
  sensorRanges: {
    phValue:        { min: 6.8,  max: 7.4  },
    tdsRaw:         { min: 400,  max: 700  },
    turbidityRaw:   { min: 0,    max: 30   },
    waterTemp:      { min: 22,   max: 28   },
    sht31Temp:      { min: 20,   max: 35   },
    sht31Humidity:  { min: 50,   max: 80   },
    waterLevel3:    { min: 0,    max: 60   },
    waterLevel4:    { min: 20,   max: 95   },
    flowMeter1:     { min: 0,    max: 20   },
    flowMeter2:     { min: 0,    max: 20   },
  },
};

/* =====================================================================
   UTILITIES
   ===================================================================== */

/** Authenticated fetch wrapper */
async function apiFetch(path, options = {}) {
  const url = API_BASE + path;
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (State.auth.token) headers['Authorization'] = `Bearer ${State.auth.token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) { doLogout(); throw new Error('Unauthorized'); }
  return res;
}

/** Safe JSON parse from Response */
async function parseJSON(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Format ISO timestamp to human-readable */
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('en-GB', { hour12: false }).replace(',', '');
}

/** Format relative time */
function fmtRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5000)   return 'Just now';
  if (diff < 60000)  return `${Math.floor(diff/1000)}s ago`;
  if (diff < 3600000)return `${Math.floor(diff/60000)}m ago`;
  return `${Math.floor(diff/3600000)}h ago`;
}

/** Coerce backend boolean/numeric to ON state */
function isOn(val) {
  if (val === true  || val === 1 || val === 1.0) return true;
  if (val === false || val === 0 || val === 0.0) return false;
  if (typeof val === 'string') return val.toUpperCase() === 'ON';
  return false;
}

/** Format number or return N/A */
function fmtNum(v, decimals = 1) {
  if (v === null || v === undefined) return 'N/A';
  const n = Number(v);
  if (isNaN(n)) return 'N/A';
  return decimals === 0 ? n.toFixed(0) : n.toFixed(decimals);
}

/** Set element text safely */
function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

/** Show/hide element */
function setHidden(id, hidden) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('hidden', hidden);
}

/* =====================================================================
   ROLE HELPERS
   ===================================================================== */

/** Returns true only when the logged-in user has ROLE_ADMIN */
function isAdminUser() {
  const r = State.auth.role;
  if (!r) return false;
  return r.toUpperCase() === 'ROLE_ADMIN';
}

/**
 * Apply (or remove) read-only restrictions based on the current role.
 * Called once after login/session-restore.
 */
function applyRoleUI() {
  const admin = isAdminUser();

  // All actuator toggle inputs (generated dynamically — use event delegation guard instead)
  // Disable / enable all known static control elements
  const controlIds = [
    'pump2-toggle',   // Only static toggle remaining in HTML
  ];
  controlIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !admin;
  });

  // Disable actuator-section range sliders and toggles by container
  const actContainers = [
    'act-fish-tank', 'act-filter-tank', 'act-supply-tank',
    'act-alarm-devices', 'ft-actuators', 'filt-actuators',
  ];
  actContainers.forEach(cid => {
    const el = document.getElementById(cid);
    if (!el) return;
    el.querySelectorAll('input[type=checkbox], input[type=range]').forEach(inp => {
      inp.disabled = !admin;
    });
  });

  // Hide / show the Automation Settings sidebar nav item for non-admins
  const automationNav = document.getElementById('sb-automation');
  if (automationNav) automationNav.style.display = admin ? '' : 'none';

  // Show a role indicator banner if non-admin
  let banner = document.getElementById('rbac-banner');
  if (!admin) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'rbac-banner';
      banner.style.cssText = [
        'position:fixed;top:0;left:0;right:0;z-index:8000',
        'background:rgba(245,158,11,.13);border-bottom:1px solid rgba(245,158,11,.3)',
        'color:#f59e0b;font-size:.74rem;text-align:center;padding:.32rem .5rem',
        'font-family:Inter,sans-serif;font-weight:500;letter-spacing:.3px',
        'pointer-events:none',
      ].join(';');
      banner.textContent = '🔒 Read-Only Mode — Actuator controls and settings are disabled for your role';
      document.body.appendChild(banner);
    }
    banner.style.display = '';
  } else {
    if (banner) banner.style.display = 'none';
  }
}

/* =====================================================================
   NORMAL RANGE HELPERS
   ===================================================================== */

const SENSOR_RANGES_KEY = 'aqua_sensor_ranges';

/** Load persisted ranges from localStorage, merging with defaults */
function loadSensorRanges() {
  try {
    const saved = localStorage.getItem(SENSOR_RANGES_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge: keep defaults for any field not in saved
      Object.keys(parsed).forEach(k => {
        if (State.sensorRanges[k] !== undefined) {
          State.sensorRanges[k] = parsed[k];
        }
      });
    }
  } catch (e) { /* ignore */ }
}

/** Persist current ranges to localStorage */
function saveSensorRanges() {
  try {
    localStorage.setItem(SENSOR_RANGES_KEY, JSON.stringify(State.sensorRanges));
  } catch (e) { /* ignore */ }
}

/**
 * Compare a numeric value against the stored range for a field.
 * Returns { label, badgeClass } for the "Normal Range" status cell.
 */
function getRangeStatus(field, rawVal) {
  if (rawVal === null || rawVal === undefined) {
    return { label: 'N/A', badgeClass: 'badge-info' };
  }
  const val = Number(rawVal);
  if (isNaN(val)) return { label: 'N/A', badgeClass: 'badge-info' };

  const range = State.sensorRanges[field];
  if (!range) return { label: 'Normal', badgeClass: 'badge-ok' };

  if (val > range.max) return { label: '▲ Above Normal Range', badgeClass: 'badge-warn' };
  if (val < range.min) return { label: '▼ Below Normal Range', badgeClass: 'badge-warn' };
  return { label: '● Normal', badgeClass: 'badge-ok' };
}

/**
 * Open an inline range editor for a sensor field.
 * Renders a small form in the Normal Range cell identified by cellId.
 * Admin-only.
 */
function openRangeEditor(field, cellId) {
  if (!isAdminUser()) {
    showToast('Admin access required to edit sensor ranges.', 'warn');
    return;
  }
  const cell = document.getElementById(cellId);
  if (!cell) return;

  const range = State.sensorRanges[field] || { min: 0, max: 100 };

  cell.innerHTML = `
    <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">
      <input id="re-min-${field}" type="number" step="0.01" value="${range.min}"
        style="width:58px;padding:.18rem .3rem;background:var(--bg);border:1px solid var(--card-b);
               border-radius:5px;color:var(--text);font-size:.72rem;font-family:inherit">
      <span style="color:var(--text3);font-size:.72rem">–</span>
      <input id="re-max-${field}" type="number" step="0.01" value="${range.max}"
        style="width:58px;padding:.18rem .3rem;background:var(--bg);border:1px solid var(--card-b);
               border-radius:5px;color:var(--text);font-size:.72rem;font-family:inherit">
      <button onclick="saveRangeEditor('${field}','${cellId}')"
        style="padding:.18rem .45rem;font-size:.68rem;background:var(--cyan);color:#000;
               border:none;border-radius:4px;cursor:pointer;font-weight:600">✓</button>
      <button onclick="cancelRangeEditor('${field}','${cellId}')"
        style="padding:.18rem .4rem;font-size:.68rem;background:var(--card-b);color:var(--text2);
               border:none;border-radius:4px;cursor:pointer">✗</button>
    </div>`;
}

/** Save the edited range and re-render the cell */
function saveRangeEditor(field, cellId) {
  const minEl = document.getElementById(`re-min-${field}`);
  const maxEl = document.getElementById(`re-max-${field}`);
  if (!minEl || !maxEl) return;

  const minVal = parseFloat(minEl.value);
  const maxVal = parseFloat(maxEl.value);
  if (isNaN(minVal) || isNaN(maxVal) || minVal >= maxVal) {
    showToast('Invalid range: min must be less than max.', 'error');
    return;
  }
  State.sensorRanges[field] = { min: minVal, max: maxVal };
  saveSensorRanges();
  showToast(`Range for ${field} updated: ${minVal} – ${maxVal}`, 'success', 2500);
  // Clear the cell's edit controls so updateSensorTable renders display mode
  const cell = document.getElementById(cellId);
  if (cell) cell.innerHTML = '';
  // Re-render the sensor table to show the new range & updated status
  updateSensorTable();
}

/** Cancel editing without saving */
function cancelRangeEditor(field, cellId) {
  // Clear the cell's edit controls so updateSensorTable renders display mode
  const cell = document.getElementById(cellId);
  if (cell) cell.innerHTML = '';
  updateSensorTable(); // restores cell to display mode
}

/** Show toast notification */
let _toastEl = null;
let _toastTimer = null;
function showToast(msg, type = 'info', duration = 4000) {
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.id = 'aq-toast';
    _toastEl.style.cssText = [
      'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999',
      'max-width:340px;padding:.75rem 1rem;border-radius:10px',
      'font-size:.82rem;font-weight:500;line-height:1.45',
      'box-shadow:0 8px 32px rgba(0,0,0,.5);transition:opacity .25s',
      'pointer-events:none;font-family:Inter,sans-serif'
    ].join(';');
    document.body.appendChild(_toastEl);
  }
  const colors = {
    info:    'background:rgba(0,212,255,.12);border:1px solid rgba(0,212,255,.3);color:#e2e8f0',
    success: 'background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);color:#e2e8f0',
    warn:    'background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);color:#e2e8f0',
    error:   'background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#e2e8f0',
  };
  _toastEl.style.cssText += ';' + (colors[type] || colors.info);
  _toastEl.textContent = msg;
  _toastEl.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { _toastEl.style.opacity = '0'; }, duration);
}

/* =====================================================================
   SENSOR ALERT SYSTEM
   ===================================================================== */

/**
 * Tracks active sensor alerts.
 * Key: "<field>:<direction>" e.g. "phValue:above" | "phValue:below"
 * Value: { field, sensorName, value, min, max, direction, alertType }
 */
const _sensorAlerts = new Map();

// Human-readable labels for each sensor field
const SENSOR_FIELD_LABELS = {
  phValue:        'pH',
  tdsRaw:         'TDS',
  turbidityRaw:   'Turbidity',
  waterTemp:      'Water Temperature',
  sht31Temp:      'Air Temperature (SHT31)',
  sht31Humidity:  'Humidity (SHT31)',
  waterLevel3:    'Water Level 3 (Drain Tank)',
  waterLevel4:    'Water Level 4 (Supply Tank)',
  flowMeter1:     'Flow Meter 1 (Filter→Hydro)',
  flowMeter2:     'Flow Meter 2 (Fish→Filter)',
};

/**
 * Check all sensor values against their configured normal ranges.
 * Called after every sensor fetch (from renderSensors).
 * Adds new alerts, removes resolved ones, updates the modal.
 */
function checkSensorAlerts() {
  const L = State.sensors.last;
  const fields = Object.keys(State.sensorRanges);
  let changed = false;

  fields.forEach(field => {
    const rawVal = L[field];
    if (rawVal === null || rawVal === undefined) return;
    const val   = Number(rawVal);
    if (isNaN(val)) return;

    const range = State.sensorRanges[field];
    if (!range) return;

    const keyAbove = `${field}:above`;
    const keyBelow = `${field}:below`;
    const name     = SENSOR_FIELD_LABELS[field] || field;

    // -- Above max -----------------------------------------------
    if (val > range.max) {
      if (!_sensorAlerts.has(keyAbove)) {
        _sensorAlerts.set(keyAbove, {
          field, sensorName: name, value: val,
          min: range.min, max: range.max,
          direction: 'above',
          alertType: 'Above Normal Range',
        });
        changed = true;
      } else {
        // Update the live value without re-triggering a new alert
        _sensorAlerts.get(keyAbove).value = val;
      }
      // If it was previously below, clear that alert
      if (_sensorAlerts.has(keyBelow)) { _sensorAlerts.delete(keyBelow); changed = true; }
    }
    // -- Below min -----------------------------------------------
    else if (val < range.min) {
      if (!_sensorAlerts.has(keyBelow)) {
        _sensorAlerts.set(keyBelow, {
          field, sensorName: name, value: val,
          min: range.min, max: range.max,
          direction: 'below',
          alertType: 'Below Normal Range',
        });
        changed = true;
      } else {
        _sensorAlerts.get(keyBelow).value = val;
      }
      if (_sensorAlerts.has(keyAbove)) { _sensorAlerts.delete(keyAbove); changed = true; }
    }
    // -- Back in range: auto-clear both --------------------------
    else {
      if (_sensorAlerts.has(keyAbove)) { _sensorAlerts.delete(keyAbove); changed = true; }
      if (_sensorAlerts.has(keyBelow)) { _sensorAlerts.delete(keyBelow); changed = true; }
    }
  });

  if (changed) {
    renderSensorAlertModal();
  }
}

/** Build / update the sensor alert modal contents and show/hide it */
function renderSensorAlertModal() {
  const overlay = document.getElementById('sensor-alert-overlay');
  if (!overlay) return;

  if (_sensorAlerts.size === 0) {
    overlay.style.display = 'none';
    return;
  }

  const alertsHtml = Array.from(_sensorAlerts.values()).map(a => {
    const isAbove = a.direction === 'above';
    const icon    = isAbove ? '▲' : '▼';
    const color   = isAbove ? 'var(--warn)' : 'var(--aqua)';
    const valFmt  = Number.isInteger(a.value) ? a.value : a.value.toFixed(2);
    return `
      <div class="sa-alert-item" style="border-left:3px solid ${color}">
        <div class="sa-alert-type" style="color:${color}">${icon} ${a.alertType}</div>
        <div class="sa-alert-sensor">${a.sensorName}</div>
        <div class="sa-alert-detail">
          <span>Current: <strong style="color:${color}">${valFmt}</strong></span>
          <span>Range: ${a.min} – ${a.max}</span>
        </div>
      </div>`;
  }).join('');

  const box = overlay.querySelector('.sa-box');
  if (!box) return;

  box.querySelector('.sa-body').innerHTML = alertsHtml;
  box.querySelector('.sa-count').textContent =
    `${_sensorAlerts.size} sensor${_sensorAlerts.size !== 1 ? 's' : ''} out of range`;

  overlay.style.display = 'flex';
}

/** Acknowledge -- close the alert modal */
function acknowledgeSensorAlerts() {
  const overlay = document.getElementById('sensor-alert-overlay');
  if (overlay) overlay.style.display = 'none';
}

/* =====================================================================
   AUTHENTICATION
   ===================================================================== */ 
async function doLogin() {
  const username = document.getElementById('login-user')?.value.trim();
  const password = document.getElementById('login-pass')?.value;
  if (!username || !password) { showToast('Please enter username and password.', 'warn'); return; }

  const errEl = document.getElementById('login-error');
  if (errEl) errEl.style.display = 'none';

  try {
    const res = await apiFetch(ENDPOINTS.login, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      if (errEl) errEl.style.display = 'block';
      return;
    }
    const data = await parseJSON(res);
    // Store token if returned; fall back to session-based
    State.auth.token    = data?.token || data?.accessToken || null;
    State.auth.username = username;
    // Capture role from response; default to ROLE_ADMIN for backwards-compat
    State.auth.role     = data?.role || data?.roles?.[0] || data?.authority || 'ROLE_ADMIN';

    // Persist auth state across page refreshes
    const authState = { token: State.auth.token, username, role: State.auth.role };
    sessionStorage.setItem('aqua_auth', JSON.stringify(authState));

    // Update UI username display
    document.querySelectorAll('.user-chip span').forEach((el, i) => { if (i === 0) el.textContent = username; });
    document.querySelectorAll('.user-avatar').forEach(el => { el.textContent = username.slice(0,2).toUpperCase(); });

    // Switch to dashboard
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    initDashboard();
    applyRoleUI();
  } catch (err) {
    console.error('Login error:', err);
    if (errEl) errEl.style.display = 'block';
  }
}

async function doRegister() {
  const wrap = document.getElementById('register-form-wrap');
  if (!wrap) return;
  const inputs = wrap.querySelectorAll('.form-inp');
  const username = inputs[0]?.value.trim();
  const email    = inputs[1]?.value.trim();
  const password = inputs[2]?.value;
  const role     = wrap.querySelector('.form-select-inp')?.value || 'ROLE_VIEWER';

  if (!username || !email || !password) { showToast('Please fill all fields.', 'warn'); return; }

  try {
    const res = await apiFetch(ENDPOINTS.register, {
      method: 'POST',
      body: JSON.stringify({ username, email, password, role }),
    });
    if (res.ok) {
      showToast('Account created! You can now sign in.', 'success');
      showLoginForm();
    } else {
      const d = await parseJSON(res);
      showToast(d?.message || 'Registration failed.', 'error');
    }
  } catch (err) {
    console.error('Register error:', err);
    showToast('Server unreachable. Please try again.', 'error');
  }
}

function doLogout() {
  clearAllTimers();
  State.auth.token = null;
  State.auth.username = null;
  sessionStorage.removeItem('aqua_auth');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('login-page').classList.remove('hidden');
}

function showRegForm() {
  setHidden('login-form-wrap', true);
  setHidden('register-form-wrap', false);
  // Wire register button
  const btn = document.querySelector('#register-form-wrap .btn-block');
  if (btn) btn.onclick = doRegister;
}

function showLoginForm() {
  setHidden('login-form-wrap', false);
  setHidden('register-form-wrap', true);
}

/* =====================================================================
   INIT
   ===================================================================== */
const ACTIVE_PANEL_KEY = 'aqua_active_panel';

function initDashboard() {
  loadSensorRanges();
  startClock();

  // Restore the panel the user was on before a browser refresh, if valid.
  let startPanel = 'overview';
  try {
    const saved = sessionStorage.getItem(ACTIVE_PANEL_KEY);
    if (saved && document.getElementById(`panel-${saved}`)) startPanel = saved;
  } catch (e) { /* ignore */ }

  switchPanel(startPanel);
  initRealtimeCharts();
  startAllPolls();
  buildActuatorPanels();
}

function startClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  const tick = () => { el.textContent = new Date().toLocaleTimeString('en-GB'); };
  tick();
  setInterval(tick, 1000);
}

function clearAllTimers() {
  Object.values(State.timers).forEach(t => clearInterval(t));
  State.timers = {};
}

function startAllPolls() {
  clearAllTimers();
  // Immediate calls
  fetchSensors();
  fetchActuators();
  fetchAlarms();
  fetchCameraLatest();
  fetchHistory();
  pollDeviceStatus();

  // Recurring polls
  State.timers.sensors      = setInterval(fetchSensors,      POLL.sensors);
  State.timers.actuators    = setInterval(fetchActuators,    POLL.actuators);
  State.timers.alarms       = setInterval(fetchAlarms,       POLL.alarms);
  State.timers.camera       = setInterval(fetchCameraLatest, POLL.camera);
  State.timers.deviceStatus = setInterval(pollDeviceStatus,  10000);
  State.timers.history      = setInterval(fetchHistory,      POLL.history);
}

/* =====================================================================
   SENSOR POLLING & UI UPDATE
   ===================================================================== */
async function fetchSensors() {
  try {
    const res = await apiFetch(ENDPOINTS.latestSensors);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await parseJSON(res);
    if (!data) return;
    State.sensors.raw = data;
    // Update last-known cache — only overwrite when value is non-null
    const fields = ['phValue','turbidityRaw','tdsRaw','waterTemp','sht31Temp',
                    'sht31Humidity','fishTankFloat',
                    'waterLevel3','waterLevel4','flowMeter1','flowMeter2',
                    'filterTankFloat',
                    'filterTankFloat_overflow','fishTankFloat_underflow',
                    'filterTankFloat_underflow','fishTankFloat_overflow',
                    'loggedAt'];
    fields.forEach(f => {
      if (data[f] !== null && data[f] !== undefined) {
        State.sensors.last[f] = data[f];
      }
    });
    renderSensors();
    } catch (err) {
    console.warn('Sensor fetch failed:', err.message);
    // Keep previous values in UI — do not blank them
  }
}

/**
 * Resolve the display state of a boolean float-switch field.
 * known=false when no reading has ever been received.
 * triggered=true means the switch has tripped (overflow/underflow condition).
 */
function floatSwitchState(field) {
  const v = State.sensors.last[field];
  const known = v !== null && v !== undefined;
  const triggered = known && isOn(v);
  return { known, triggered };
}

/** Render one of the four float-switch dashboard cards + its status badge. */
function renderFloatSwitchCard(field, cardId, valId, statusId) {
  const { known, triggered } = floatSwitchState(field);
  const card   = document.getElementById(cardId);
  const valEl  = document.getElementById(valId);
  const stEl   = document.getElementById(statusId);

  if (valEl) {
    valEl.textContent = known ? (triggered ? 'TRIGGERED' : 'NORMAL') : 'N/A';
    valEl.className   = 'sc-val ' + (known ? (triggered ? 'val-danger' : 'val-ok') : 'text-dim');
  }
  if (stEl) {
    stEl.textContent = known ? (triggered ? '● Triggered' : '● Normal') : '○ Unknown';
    stEl.className   = 'sc-status ' + (known ? (triggered ? 'ss-danger' : 'ss-ok') : 'ss-warn');
  }
  if (card) {
    card.classList.remove('sc-ok', 'sc-warn', 'sc-cyan', 'sc-danger');
    card.classList.add(known ? (triggered ? 'sc-danger' : 'sc-ok') : 'sc-warn');
  }
}

function sv(field, decimals = 1) {
  // Returns last-known sensor value formatted, or 'N/A' on first load
  const v = State.sensors.last[field];
  if (v === null || v === undefined) return 'N/A';
  return fmtNum(v, decimals);
}

function renderSensors() {
  const L = State.sensors.last;

  // ── Overview Stat Cards ──────────────────────────────────────
  setText('ov-ph',   sv('phValue'));
  setText('ov-tds',  sv('tdsRaw', 0));
  setText('ov-temp', sv('waterTemp'));
  setText('ov-hum',  sv('sht31Humidity', 0));
  setText('ov-turb', sv('turbidityRaw', 0));

  // ── Fish Tank Panel ──────────────────────────────────────────
  setText('ft-temp',   sv('waterTemp'));
  setText('ft-tds',    sv('tdsRaw', 0));
  setText('ft-ph',     sv('phValue'));
  setText('ft-turb',   sv('turbidityRaw', 0));
  setText('ft-airtemp',sv('sht31Temp'));
  setText('ft-hum',    sv('sht31Humidity', 0));

  // Float switch
  const fsEl = document.getElementById('ft-float-val');
  if (fsEl) {
    const fval = L.fishTankFloat;
    fsEl.textContent = fval === null || fval === undefined ? 'N/A' : (fval ? 'HIGH' : 'LOW');
    fsEl.className   = 'sc-val ' + (fval ? 'text-green' : 'val-warn');
  }

  // Fish Tank overflow / underflow float switches
  renderFloatSwitchCard('fishTankFloat_overflow',  'card-ft-float-of', 'ft-float-of-val', 'ft-float-of-status');
  renderFloatSwitchCard('fishTankFloat_underflow', 'card-ft-float-uf', 'ft-float-uf-val', 'ft-float-uf-status');

  // ── Filtration Tank Panel ────────────────────────────────────
  // Filter Tank overflow / underflow float switches
  renderFloatSwitchCard('filterTankFloat_overflow',  'card-filt-float-of', 'filt-float-of-val', 'filt-float-of-status');
  renderFloatSwitchCard('filterTankFloat_underflow', 'card-filt-float-uf', 'filt-float-uf-val', 'filt-float-uf-status');

  // Flow Meter 1 (Filter Tank → Growing Beds)
  const fm1Val = L.flowMeter1;
  const fm1Fmt = fm1Val !== null && fm1Val !== undefined ? fmtNum(fm1Val) : '—';
  setText('filt-fm1',   fm1Fmt);
  setText('flow-fm1',   fm1Fmt);
  setText('hydro-fm1',  fm1Fmt);
  if (fm1Val !== null && fm1Val !== undefined) {
    const fm1Pct = Math.max(0, Math.min(100, (Number(fm1Val) / 20) * 100));
    const fm1Bar = document.getElementById('flow-fm1-bar');
    if (fm1Bar) fm1Bar.style.width = fm1Pct + '%';
    const daily1 = (Number(fm1Val) * 60 * 24).toFixed(0);
    setText('flow-fm1-daily', `Daily: ${Number(daily1).toLocaleString()} L`);
  }

  // Flow Meter 2 (Fish Tank → Filter Tank)
  const fm2Val = L.flowMeter2;
  const fm2Fmt = fm2Val !== null && fm2Val !== undefined ? fmtNum(fm2Val) : '—';
  setText('filt-fm2',   fm2Fmt);
  setText('flow-fm2',   fm2Fmt);
  if (fm2Val !== null && fm2Val !== undefined) {
    const fm2Pct = Math.max(0, Math.min(100, (Number(fm2Val) / 20) * 100));
    const fm2Bar = document.getElementById('flow-fm2-bar');
    if (fm2Bar) fm2Bar.style.width = fm2Pct + '%';
    const daily2 = (Number(fm2Val) * 60 * 24).toFixed(0);
    setText('flow-fm2-daily', `Daily: ${Number(daily2).toLocaleString()} L`);
  }

  // Filter Tank Float Switch
  const filtFloatEl     = document.getElementById('filt-float-val');
  const filtFloatStatus = document.getElementById('filt-float-status');
  const ftfVal = L.filterTankFloat;
  if (filtFloatEl) {
    if (ftfVal === null || ftfVal === undefined) {
      filtFloatEl.textContent = '—';
      filtFloatEl.className   = 'sc-val text-dim';
    } else {
      const ftfOn = isOn(ftfVal);
      filtFloatEl.textContent = ftfOn ? 'ON' : 'OFF';
      filtFloatEl.className   = 'sc-val ' + (ftfOn ? 'text-green' : 'val-warn');
      if (filtFloatStatus) filtFloatStatus.textContent = ftfOn ? '● Activated' : '○ Inactive';
    }
  }

  // ── Drain / Supply Tanks ─────────────────────────────────────
  setText('drain-wl3', sv('waterLevel3', 0));
  setText('sup-wl4',   sv('waterLevel4', 0));

  // ── Hydroponic Section — live values from same API fields ────
  setText('hydro-tds', sv('tdsRaw', 0));
  setText('hydro-ph',  sv('phValue'));

  // ── Sensor Bars (progress) ───────────────────────────────────
  updateSensorBar('drain-wl3', L.waterLevel3, 0, 100);
  updateSensorBar('sup-wl4',  L.waterLevel4,  0, 100);

  // ── Overview Tank Grid ───────────────────────────────────────
  renderTankGrid();

  // ── Sensor Management Table ──────────────────────────────────
  updateSensorTable();

  // ── Plants & Fish live values ────────────────────────────────
  updatePlantsTable();

  // ── Sensor Alert Check ────────────────────────────────────────────
  checkSensorAlerts();
}

function updateSensorBar(id, val, min, max) {
  // Find nearest .sc-bar sibling or child relative to the ID element's parent card
  const valEl = document.getElementById(id);
  if (!valEl) return;
  const card = valEl.closest('.sensor-card');
  if (!card) return;
  const fill = card.querySelector('.sc-fill');
  if (!fill || val === null || val === undefined) return;
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  fill.style.width = pct + '%';
}

function renderTankGrid() {
  const el = document.getElementById('ov-tanks');
  if (!el) return;
  const L = State.sensors.last;
  const tanks = [
    { label: 'Drain Tank (WL3)',  val: L.waterLevel3, icon: '⬇' },
    { label: 'Supply Tank (WL4)', val: L.waterLevel4, icon: '🔺' },
  ];
  el.innerHTML = tanks.map(t => {
    const pct = t.val !== null && t.val !== undefined ? Number(t.val) : null;
    const display = pct !== null ? pct.toFixed(0) + '%' : 'N/A';
    const color = pct === null ? 'var(--text2)' : pct < 25 ? 'var(--danger)' : pct < 50 ? 'var(--warn)' : 'var(--cyan)';
    const barPct = pct !== null ? Math.max(0, Math.min(100, pct)) : 0;
    return `
      <div class="stat-card">
        <div class="stat-icon si-cyan">${t.icon}</div>
        <div class="stat-info">
          <div class="lbl">${t.label}</div>
          <div class="val" style="color:${color}">${display}</div>
          <div class="sc-bar" style="margin-top:.4rem">
            <div class="sc-fill" style="width:${barPct}%;background:${color}"></div>
          </div>
        </div>
      </div>`;
  }).join('');
}

function updateSensorTable() {
  const L = State.sensors.last;
  const admin = isAdminUser();

  // ── Mini sensor-management card IDs (top panel) ──────────────────
  const rows = [
    { id: 'sm-ph',    val: sv('phValue'),           unit: '' },
    { id: 'sm-tds',   val: sv('tdsRaw', 0),         unit: ' ppm' },
    { id: 'sm-turb',  val: sv('turbidityRaw', 0),   unit: ' NTU' },
    { id: 'sm-wtemp', val: sv('waterTemp'),          unit: '°C' },
    { id: 'sm-atemp', val: sv('sht31Temp'),          unit: '°C' },
    { id: 'sm-hum',   val: sv('sht31Humidity', 0),  unit: '%' },
    { id: 'sm-float', val: L.fishTankFloat !== null && L.fishTankFloat !== undefined ? (L.fishTankFloat ? 'HIGH' : 'LOW') : 'N/A', unit: '' },
    { id: 'sm-ft-of',   val: floatSwitchState('fishTankFloat_overflow').known   ? (floatSwitchState('fishTankFloat_overflow').triggered   ? 'TRIGGERED' : 'NORMAL') : 'N/A', unit: '' },
    { id: 'sm-ft-uf',   val: floatSwitchState('fishTankFloat_underflow').known  ? (floatSwitchState('fishTankFloat_underflow').triggered  ? 'TRIGGERED' : 'NORMAL') : 'N/A', unit: '' },
    { id: 'sm-wl3',   val: sv('waterLevel3', 0),    unit: '%' },
    { id: 'sm-wl4',   val: sv('waterLevel4', 0),    unit: '%' },
    { id: 'sm-filt-of', val: floatSwitchState('filterTankFloat_overflow').known  ? (floatSwitchState('filterTankFloat_overflow').triggered  ? 'TRIGGERED' : 'NORMAL') : 'N/A', unit: '' },
    { id: 'sm-filt-uf', val: floatSwitchState('filterTankFloat_underflow').known ? (floatSwitchState('filterTankFloat_underflow').triggered ? 'TRIGGERED' : 'NORMAL') : 'N/A', unit: '' },
    { id: 'sm-fm1',   val: sv('flowMeter1'),         unit: ' L/min' },
    { id: 'sm-fm2',   val: sv('flowMeter2'),         unit: ' L/min' },
  ];
  rows.forEach(r => { setText(r.id, r.val + (r.val === 'N/A' ? '' : r.unit)); });

  // ── Full Sensor Management table in #panel-sensors ──────────────────
  const tbody = document.querySelector('#panel-sensors table tbody');
  if (!tbody) return;

  // Map each table row to: field key, live value, unit suffix
  const tableRows = [
    { field: 'phValue',       liveVal: L.phValue,       disp: sv('phValue'),          unit: ''      },
    { field: 'tdsRaw',        liveVal: L.tdsRaw,        disp: sv('tdsRaw',0)+' ppm',  unit: ' ppm'  },
    { field: 'turbidityRaw',  liveVal: L.turbidityRaw,  disp: sv('turbidityRaw',0)+' NTU', unit: ' NTU' },
    { field: 'waterTemp',     liveVal: L.waterTemp,     disp: sv('waterTemp')+'°C',   unit: '°C'    },
    { field: 'sht31Temp',     liveVal: L.sht31Temp,     disp: sv('sht31Temp')+'°C',   unit: '°C'    },
    { field: 'sht31Humidity', liveVal: L.sht31Humidity, disp: sv('sht31Humidity',0)+'%', unit: '%'  },
    { field: null,            liveVal: null,             disp: L.fishTankFloat !== null && L.fishTankFloat !== undefined ? (L.fishTankFloat ? 'HIGH' : 'LOW') : 'N/A', unit: '' }, // Float switch — no numeric range
    { field: null, floatField: 'fishTankFloat_overflow',   liveVal: null, disp: null, unit: '' },
    { field: null, floatField: 'fishTankFloat_underflow',  liveVal: null, disp: null, unit: '' },
    { field: 'waterLevel3',   liveVal: L.waterLevel3,   disp: sv('waterLevel3',0)+'%',unit: '%'     },
    { field: 'waterLevel4',   liveVal: L.waterLevel4,   disp: sv('waterLevel4',0)+'%',unit: '%'     },
    { field: null, floatField: 'filterTankFloat_overflow',  liveVal: null, disp: null, unit: '' },
    { field: null, floatField: 'filterTankFloat_underflow', liveVal: null, disp: null, unit: '' },
    { field: 'flowMeter1',    liveVal: L.flowMeter1,    disp: sv('flowMeter1')+' L/min', unit: ' L/min' },
    { field: 'flowMeter2',    liveVal: L.flowMeter2,    disp: sv('flowMeter2')+' L/min', unit: ' L/min' },
  ];

  const trs = tbody.querySelectorAll('tr');
  tableRows.forEach((info, i) => {
    const tr = trs[i];
    if (!tr) return;

    // Boolean float-switch rows (no numeric range) — resolve their display text/status here
    if (info.floatField) {
      const { known, triggered } = floatSwitchState(info.floatField);
      info.disp = known ? (triggered ? 'TRIGGERED' : 'NORMAL') : 'N/A';
      const valTd = tr.querySelector('td:nth-child(4)');
      if (valTd) valTd.textContent = info.disp;
      const statusTd = tr.querySelector('td:nth-child(6)');
      if (statusTd) {
        const span = statusTd.querySelector('span') || document.createElement('span');
        span.className   = `badge ${known ? (triggered ? 'badge-danger' : 'badge-ok') : 'badge-info'}`;
        span.textContent = known ? (triggered ? '● Triggered' : '● Normal') : 'N/A';
        if (!statusTd.querySelector('span')) statusTd.appendChild(span);
      }
      return;
    }

    // Column 4 (index 3) — Current Value
    const valTd = tr.querySelector('td:nth-child(4)');
    if (valTd) valTd.textContent = info.disp;

    // Column 5 (index 4) — Normal Range: show editable range + edit button for admin
    const rangeTd = tr.querySelector('td:nth-child(5)');
    if (rangeTd && info.field) {
      const range   = State.sensorRanges[info.field];
      const cellId  = `nr-cell-${info.field}`;
      rangeTd.id    = cellId;
      if (!rangeTd.querySelector('input')) {
        // Not currently in edit mode — render display
        if (admin) {
          rangeTd.innerHTML = `<span style="cursor:pointer;text-decoration:underline dotted;color:var(--cyan)"
            onclick="openRangeEditor('${info.field}','${cellId}')"
            title="Click to edit range">${range.min}&ndash;${range.max}</span>`;
        } else {
          rangeTd.textContent = `${range.min}–${range.max}`;
        }
      }
    }

    // Column 6 (index 5) — Status: compare live value against range
    const statusTd = tr.querySelector('td:nth-child(6)');
    if (statusTd && info.field) {
      const { label, badgeClass } = getRangeStatus(info.field, info.liveVal);
      const span = statusTd.querySelector('span') || document.createElement('span');
      span.className   = `badge ${badgeClass}`;
      span.textContent = label;
      if (!statusTd.querySelector('span')) statusTd.appendChild(span);
    }
  });

  // Also update the named status badges for flow meters (used elsewhere in the DOM)
  const fm1Status = getRangeStatus('flowMeter1', L.flowMeter1);
  const fm2Status = getRangeStatus('flowMeter2', L.flowMeter2);
  const fm1El = document.getElementById('sm-fm1-status');
  const fm2El = document.getElementById('sm-fm2-status');
  if (fm1El) { fm1El.className = `badge ${fm1Status.badgeClass}`; fm1El.textContent = fm1Status.label; }
  if (fm2El) { fm2El.className = `badge ${fm2Status.badgeClass}`; fm2El.textContent = fm2Status.label; }
}

function updatePlantsTable() {
  const L = State.sensors.last;
  const tbody = document.querySelector('#panel-plants-fish table tbody');
  if (!tbody) return;
  const trs = tbody.querySelectorAll('tr');
  const phDisp   = sv('phValue');
  const tempDisp = sv('waterTemp') + '°C';
  trs.forEach(tr => {
    const ph6   = tr.querySelector('td:nth-child(6)');
    const tmp7  = tr.querySelector('td:nth-child(7)');
    if (ph6)  ph6.textContent  = phDisp;
    if (tmp7) tmp7.textContent = tempDisp;
  });
}

/* =====================================================================
   ESP32 DEVICE STATUS & CAMERA STATUS — NEW IMPLEMENTATION
   Endpoints:
     Device : GET /api/system/ESPstatus
     Camera : GET /api/camera/status
   Cards   : #card-esp-device  (overview dashboard)
             #card-esp-camera  (overview dashboard)
   Also mirrors camera status into the camera panel mini-stat: #ecp-cam-status
   ===================================================================== */

/**
 * Resolve any response shape the backend might return into a plain boolean.
 * Accepts: boolean · number (1/0) · "true"/"false" · "online"/"offline"
 *          · "ON"/"OFF" · objects with .online / .status / .connected / .active
 */
function _resolveOnlineFlag(data) {
  if (data === null || data === undefined) return null;
  if (typeof data === 'boolean') return data;
  if (typeof data === 'number')  return data !== 0;
  if (typeof data === 'string') {
    const s = data.trim().toLowerCase();
    if (['true','1','on','online','connected','active'].includes(s)) return true;
    if (['false','0','off','offline','disconnected','inactive'].includes(s)) return false;
    return null;
  }
  if (typeof data === 'object') {
    // Try each common field name in priority order
    const candidates = [
      data.online, data.status, data.connected, data.active,
      data.Online, data.Status, data.isOnline, data.isConnected,
    ];
    for (const v of candidates) {
      if (v !== undefined && v !== null) return _resolveOnlineFlag(v);
    }
  }
  return null;
}

/** Apply ON / OFF / UNREACHABLE to a status card's DOM elements */
function _applyDeviceCardState(cardId, valId, subId, iconId, state, subText) {
  // state: 'on' | 'off' | 'unreachable'
  const cardEl = document.getElementById(cardId);
  const valEl  = document.getElementById(valId);
  const subEl  = document.getElementById(subId);
  const iconEl = document.getElementById(iconId);

  if (!valEl) return; // card not yet in DOM

  const cfg = {
    on:          { label: 'ON',          color: 'var(--green)',  icon: '🟢', border: 'rgba(34,197,94,.25)' },
    off:         { label: 'OFF',         color: 'var(--warn)',   icon: '🔴', border: 'rgba(245,158,11,.25)' },
    unreachable: { label: 'UNREACHABLE', color: 'var(--danger)', icon: '⚠️', border: 'rgba(239,68,68,.25)' },
  }[state] || { label: '—', color: 'var(--text3)', icon: '📡', border: 'var(--card-b)' };

  valEl.textContent    = cfg.label;
  valEl.style.color    = cfg.color;
  if (subEl)  subEl.textContent  = subText || '';
  if (iconEl) iconEl.textContent = cfg.icon;
  if (cardEl) cardEl.style.borderColor = cfg.border;
}

/** Fetch ESP32 device status from /api/system/ESPstatus */
async function _fetchESP32DeviceStatus() {
  console.log('[DeviceStatus] Polling GET /api/system/ESPstatus …');
  try {
    const res  = await apiFetch('/api/system/ESPstatus');
    const data = await parseJSON(res);

    console.log('[DeviceStatus] Response status:', res.status, '| Body:', data);

    if (!res.ok) {
      console.warn('[DeviceStatus] Non-OK response:', res.status);
      _applyDeviceCardState('card-esp-device','esp-device-val','esp-device-sub','esp-device-icon',
        'unreachable', `HTTP ${res.status}`);
      return;
    }

    const online = _resolveOnlineFlag(data);
    console.log('[DeviceStatus] Resolved online flag:', online);

    if (online === true) {
      _applyDeviceCardState('card-esp-device','esp-device-val','esp-device-sub','esp-device-icon',
        'on', 'ESP32 main node reachable');
    } else if (online === false) {
      _applyDeviceCardState('card-esp-device','esp-device-val','esp-device-sub','esp-device-icon',
        'off', 'ESP32 main node offline');
    } else {
      // API responded but payload could not be interpreted
      console.warn('[DeviceStatus] Unrecognised payload shape:', data);
      _applyDeviceCardState('card-esp-device','esp-device-val','esp-device-sub','esp-device-icon',
        'unreachable', 'Unexpected response format');
    }
  } catch (err) {
    console.error('[DeviceStatus] Fetch error:', err.message);
    _applyDeviceCardState('card-esp-device','esp-device-val','esp-device-sub','esp-device-icon',
      'unreachable', 'API unreachable');
  }
}

/** Fetch ESP32 camera status from /api/camera/status */
async function _fetchESP32CameraStatus() {
  console.log('[CameraStatus] Polling GET /api/camera/status …');
  try {
    const res  = await apiFetch('/api/camera/status');
    const data = await parseJSON(res);

    console.log('[CameraStatus] Response status:', res.status, '| Body:', data);

    if (!res.ok) {
      console.warn('[CameraStatus] Non-OK response:', res.status);
      _applyDeviceCardState('card-esp-camera','esp-camera-val','esp-camera-sub','esp-camera-icon',
        'unreachable', `HTTP ${res.status}`);
      _syncCameraStatusMiniStat('UNREACHABLE', 'val-warn');
      return;
    }

    const online = _resolveOnlineFlag(data);
    console.log('[CameraStatus] Resolved online flag:', online);

    if (online === true) {
      _applyDeviceCardState('card-esp-camera','esp-camera-val','esp-camera-sub','esp-camera-icon',
        'on', 'ESP32-CAM OV2640 reachable');
      _syncCameraStatusMiniStat('ON', 'val-cyan');
    } else if (online === false) {
      _applyDeviceCardState('card-esp-camera','esp-camera-val','esp-camera-sub','esp-camera-icon',
        'off', 'ESP32-CAM offline');
      _syncCameraStatusMiniStat('OFF', 'val-warn');
    } else {
      console.warn('[CameraStatus] Unrecognised payload shape:', data);
      _applyDeviceCardState('card-esp-camera','esp-camera-val','esp-camera-sub','esp-camera-icon',
        'unreachable', 'Unexpected response format');
      _syncCameraStatusMiniStat('UNREACHABLE', 'val-warn');
    }
  } catch (err) {
    console.error('[CameraStatus] Fetch error:', err.message);
    _applyDeviceCardState('card-esp-camera','esp-camera-val','esp-camera-sub','esp-camera-icon',
      'unreachable', 'API unreachable');
    _syncCameraStatusMiniStat('UNREACHABLE', 'val-warn');
  }
}

/** Mirror camera status into the camera panel mini-stat element */
function _syncCameraStatusMiniStat(text, cssClass) {
  const el = document.getElementById('ecp-cam-status');
  if (!el) return;
  el.textContent = text;
  el.className   = `ecp-stat-val ${cssClass}`;
}

/** Single entry point — runs both fetches in parallel */
async function pollDeviceStatus() {
  await Promise.allSettled([
    _fetchESP32DeviceStatus(),
    _fetchESP32CameraStatus(),
  ]);
}

async function fetchHistory() {
  try {
    const res = await apiFetch(ENDPOINTS.history);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await parseJSON(res);
    if (!Array.isArray(data)) return;
    // Sort newest first
    State.history.records = data.sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt));
    renderHistoryTable();
    renderAllCharts();
  } catch (err) {
    console.warn('History fetch failed:', err.message);
  }
}

function renderHistoryTable() {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;
  const recs = State.history.records.slice(0, 200); // cap at 200 rows
  if (!recs.length) {
    tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;color:var(--text3);padding:1.5rem">No history records available.</td></tr>`;
    return;
  }
  const floatCell = (v) => {
    if (v === null || v === undefined) return 'N/A';
    return isOn(v) ? 'TRIGGERED' : 'NORMAL';
  };
  tbody.innerHTML = recs.map(r => `
    <tr>
      <td class="monospace" style="white-space:nowrap">${fmtTime(r.loggedAt)}</td>
      <td>${fmtNum(r.phValue)}</td>
      <td>${fmtNum(r.tdsRaw, 0)}</td>
      <td>${fmtNum(r.turbidityRaw, 0)}</td>
      <td>${fmtNum(r.waterTemp)}</td>
      <td>${fmtNum(r.sht31Temp)}</td>
      <td>${fmtNum(r.sht31Humidity, 0)}</td>
      <td>${floatCell(r.fishTankFloat_overflow)}</td>
      <td>${floatCell(r.fishTankFloat_underflow)}</td>
      <td>${fmtNum(r.waterLevel3, 0)}</td>
      <td>${fmtNum(r.waterLevel4, 0)}</td>
      <td>${floatCell(r.filterTankFloat_overflow)}</td>
      <td>${floatCell(r.filterTankFloat_underflow)}</td>
    </tr>`).join('');
}

/* =====================================================================
   CHARTS
   ===================================================================== */
const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 400 },
  plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
  scales: {
    x: { ticks: { color: '#475569', font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,.04)' } },
    y: { ticks: { color: '#475569', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.05)' } },
  },
};

function makeLineDataset(label, data, color) {
  return {
    label, data,
    borderColor: color,
    backgroundColor: color.replace(')', ',.08)').replace('rgb', 'rgba'),
    borderWidth: 1.5,
    pointRadius: 0,
    tension: 0.3,
    fill: true,
  };
}

function filterByRange(records, rangeVal) {
  const now = Date.now();
  const msMap = { '24h': 86400000, '7d': 604800000, '30d': 2592000000, '90d': 7776000000 };
  const ms = msMap[rangeVal] || msMap['7d'];
  return records.filter(r => (now - new Date(r.loggedAt).getTime()) <= ms);
}

function upsertChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (State.charts[canvasId]) {
    State.charts[canvasId].destroy();
  }
  State.charts[canvasId] = new Chart(canvas.getContext('2d'), config);
}

function renderAllCharts() {
  initRealtimeCharts();
  renderAnalyticsCharts();
}

/* =====================================================================
   REAL-TIME SCROLLING CHARTS
   Fixed rolling time window; ticks forward every second even when no
   new backend reading has arrived, so the timeline never freezes.
   ===================================================================== */
const RT_WINDOW_MS = 60000; // default rolling window: last 60 seconds
const RT_TICK_MS   = 1000;  // advance the timeline once per second

// Overview pH/Temp trend widgets show a longer 60-minute rolling window
// while every other real-time chart keeps the default 60-second window.
const RT_WINDOW_MS_60MIN = 60 * 60 * 1000;

const RT_CHARTS = [
  { canvas: 'chart-ov-ph',     field: 'phValue',       label: 'pH',           color: '#00D4FF', windowMs: RT_WINDOW_MS_60MIN },
  { canvas: 'chart-ov-temp',   field: 'waterTemp',     label: 'Water Temp',   color: '#F59E0B', windowMs: RT_WINDOW_MS_60MIN },
  { canvas: 'chart-ft-ph',     field: 'phValue',       label: 'pH',           color: '#00D4FF', windowMs: RT_WINDOW_MS_60MIN },
  { canvas: 'chart-ft-temp',   field: 'waterTemp',     label: 'Temp °C',      color: '#F59E0B', windowMs: RT_WINDOW_MS_60MIN },
  { canvas: 'chart-ft-tds',    field: 'tdsRaw',        label: 'TDS ppm',      color: '#22C55E', windowMs: RT_WINDOW_MS_60MIN },
  { canvas: 'chart-ft-turb',   field: 'turbidityRaw',  label: 'Turbidity',    color: '#8B5CF6', windowMs: RT_WINDOW_MS_60MIN },
  { canvas: 'chart-drain-wl3', field: 'waterLevel3',   label: 'WL3 %',        color: '#22C55E' },
  { canvas: 'chart-sup-wl4',   field: 'waterLevel4',   label: 'WL4 %',        color: '#F59E0B' },
  { canvas: 'chart-flow1',     field: 'flowMeter1',    label: 'Flow 1 L/min', color: '#00D4FF' },
  { canvas: 'chart-flow2',     field: 'flowMeter2',    label: 'Flow 2 L/min', color: '#22C55E' },
];

/** Create (once) every real-time chart instance and (re)start the shared ticker. */
function initRealtimeCharts() {
  RT_CHARTS.forEach(cfg => {
    const canvas = document.getElementById(cfg.canvas);
    if (!canvas) return;
    if (!State.rt.buffers[cfg.canvas]) State.rt.buffers[cfg.canvas] = [];
    if (!State.charts[cfg.canvas]) {
      State.charts[cfg.canvas] = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels: [], datasets: [makeLineDataset(cfg.label, [], cfg.color)] },
        options: { ...CHART_DEFAULTS, animation: false },
      });
    }
  });

  if (!State.rt.timer) {
    State.rt.timer = setInterval(tickRealtimeCharts, RT_TICK_MS);
  }
  tickRealtimeCharts();
}

/** Advance every real-time chart by one tick: append latest value, drop stale points. */
function tickRealtimeCharts() {
  const now = Date.now();
  RT_CHARTS.forEach(cfg => {
    const chart = State.charts[cfg.canvas];
    const buf   = State.rt.buffers[cfg.canvas];
    if (!chart || !buf) return;

    const raw = State.sensors.last[cfg.field];
    const hasNew = raw !== null && raw !== undefined;
    // Keep scrolling forward with the last known value when no fresh reading exists yet.
    const v = hasNew ? Number(raw) : (buf.length ? buf[buf.length - 1].v : null);
    buf.push({ t: now, v });

    // Trim anything outside this chart's rolling window to cap memory use.
    const windowMs = cfg.windowMs || RT_WINDOW_MS;
    while (buf.length && now - buf[0].t > windowMs) buf.shift();

    // Longer (minutes-scale) windows don't need second-level precision on the axis.
    const labelOpts = windowMs > 5 * 60 * 1000
      ? { hour12: false, hour: '2-digit', minute: '2-digit' }
      : { hour12: false };
    chart.data.labels = buf.map(p => new Date(p.t).toLocaleTimeString('en-GB', labelOpts));
    chart.data.datasets[0].data = buf.map(p => p.v);
    chart.update('none'); // in-place redraw — no destroy, no flicker
  });
}

function renderAnalyticsCharts() {
  const rangeEl = document.getElementById('analytics-range');
  const range   = rangeEl ? rangeEl.value : '7d';
  const recs    = filterByRange(State.history.records, range).slice(0, 200).reverse();

  const mkCfg = (field, label, color) => ({
    type: 'line',
    data: {
      labels: recs.map(r => {
        const d = new Date(r.loggedAt);
        return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
      }),
      datasets: [makeLineDataset(label, recs.map(r => r[field] ?? null), color)],
    },
    options: { ...CHART_DEFAULTS },
  });

  upsertChart('chart-an-ph',     mkCfg('phValue',      'pH',         '#00D4FF'));
  upsertChart('chart-an-tds',    mkCfg('tdsRaw',       'TDS ppm',    '#22C55E'));
  upsertChart('chart-an-temp',   mkCfg('waterTemp',    'Water Temp', '#F59E0B'));
  upsertChart('chart-an-hum',    mkCfg('sht31Humidity','Humidity %', '#38BDF8'));
  upsertChart('chart-an-turb',   mkCfg('turbidityRaw', 'Turbidity',  '#8B5CF6'));

  // Multi-line water levels
  upsertChart('chart-an-levels', {
    type: 'line',
    data: {
      labels: recs.map(r => {
        const d = new Date(r.loggedAt);
        return `${d.getMonth()+1}/${d.getDate()}`;
      }),
      datasets: [
        makeLineDataset('WL3 Drain',  recs.map(r => r.waterLevel3 ?? null), '#F59E0B'),
        makeLineDataset('WL4 Supply', recs.map(r => r.waterLevel4 ?? null), '#8B5CF6'),
      ],
    },
    options: { ...CHART_DEFAULTS, plugins: { legend: { display: true, labels: { color: '#94A3B8', font: { size: 10 } } }, tooltip: { mode: 'index', intersect: false } } },
  });
}

function updateAnalyticsCharts() { renderAnalyticsCharts(); }

/* =====================================================================
   ACTUATORS
   ===================================================================== */

// Map: actuator name → UI label, tank group, icon
const ACTUATOR_META = {
  waterPump:    { label: 'Water Pump',       tank: 'fish',   icon: '🔄' },
  aerator:      { label: 'Aerator',          tank: 'fish',   icon: '💨' },
  heater:       { label: 'Heater',           tank: 'fish',   icon: '🌡' },
  filterPump:   { label: 'Filter Pump',      tank: 'filter', icon: '🔵' },
  acidPump:     { label: 'Acid Dosing Pump', tank: 'filter', icon: '🧪' },
  basePump:     { label: 'Base Dosing Pump', tank: 'filter', icon: '🧫' },
  nutrientPump: { label: 'Nutrient Pump',    tank: 'filter', icon: '🌿' },
  valve1:       { label: 'Valve 1',          tank: 'filter', icon: '🔧' },
  valve2:       { label: 'Valve 2',          tank: 'filter', icon: '🔧' },
  valve3:       { label: 'Valve 3 (Supply)', tank: 'supply', icon: '🔺' },
  valve4:       { label: 'Valve 4',          tank: 'filter', icon: '🔧' },
  alarmBuzzer:  { label: 'Alarm Buzzer',     tank: 'alarm',  icon: '🔊' },
  alarmLed:     { label: 'Alarm LED',        tank: 'alarm',  icon: '💡' },
};

// Build actuator cards with proper IDs for each container
function buildActuatorGroupReal(containerId, names) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  names.forEach(name => {
    const meta = ACTUATOR_META[name] || { label: name, icon: '⚙' };
    const state = State.actuators.current[name];
    const on = isOn(state);
    const card = document.createElement('div');
    card.className = `act-card${on ? ' on' : ''}`;
    card.id = `actcard-${containerId}-${name}`;
    card.innerHTML = `
      <div class="act-header">
        <div>
          <div class="act-name">${meta.icon} ${meta.label}</div>
          <div class="act-tank" style="font-size:.62rem;color:var(--text3)">${name}</div>
        </div>
      </div>
      <div class="act-state-row">
        <div>
          <div class="act-state" id="actst-${containerId}-${name}"
               style="color:${on ? 'var(--cyan)' : 'var(--text3)'}">
            ${on ? 'ON' : 'OFF'}
          </div>
        </div>
        <label class="toggle-wrap">
          <input type="checkbox" id="acttog-${containerId}-${name}" ${on ? 'checked' : ''}>
          <div class="toggle-track"></div>
        </label>
      </div>`;
    el.appendChild(card);
    const toggle = card.querySelector('input[type=checkbox]');
    toggle.addEventListener('change', () => handleActuatorToggle(name, toggle, containerId));
    // Apply RBAC on newly created toggle
    if (!isAdminUser()) toggle.disabled = true;
  });
}

// Override buildActuatorPanels with real implementation
function buildActuatorPanels() {
  buildActuatorGroupReal('act-fish-tank',    ['waterPump','aerator','heater']);
  buildActuatorGroupReal('act-filter-tank',  ['filterPump','acidPump','basePump','nutrientPump','valve1','valve2','valve4']);
  buildActuatorGroupReal('act-supply-tank',  ['valve3']);
  buildActuatorGroupReal('act-alarm-devices',['alarmBuzzer','alarmLed']);
  buildActuatorGroupReal('ft-actuators',     ['waterPump','aerator','heater']);
  buildActuatorGroupReal('filt-actuators',   ['filterPump','acidPump','basePump','nutrientPump']);
  buildPumpSpeedControls();
  wirePumpToggle();
  // Re-apply RBAC after dynamic DOM rebuild
  applyRoleUI();
}

function buildPumpSpeedControls() {
  // Pump 1 speed slider (already exists in HTML, but we hook it up)
  const slider1 = document.querySelector('#panel-actuators .range-group input[type=range]');
  if (slider1) {
    slider1.id = 'pump1-speed-slider';
    slider1.addEventListener('input', () => {
      setText('pump-spd-val', slider1.value + '%');
    });
    slider1.addEventListener('change', () => {
      sendActuatorValue('pump1Speed', parseFloat(slider1.value));
    });
  }
}

function wirePumpToggle() {
  // Pump2 on/off toggle in the HTML
  const p2Toggle = document.getElementById('pump2-toggle');
  if (p2Toggle) {
    // Remove any inline onchange
    p2Toggle.removeAttribute('onchange');
    p2Toggle.addEventListener('change', () => handleActuatorToggle('pump2Speed', p2Toggle, 'panel-actuators'));
  }
}

async function fetchActuators() {
  try {
    const res = await apiFetch(ENDPOINTS.actuatorsLatest);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await parseJSON(res);
    if (!data) return;
    // Backend state always wins — update state
    const prev = { ...State.actuators.current };
    State.actuators.current = { ...data };
    // Re-render all actuator UIs (backend override)
    syncAllActuatorUIs(prev, data);
    updateActuatorOverview();
    updatePumpSpeedUI(data);
  } catch (err) {
    console.warn('Actuator fetch failed:', err.message);
  }
}

function syncAllActuatorUIs(prev, data) {
  const containers = [
    'act-fish-tank', 'act-filter-tank', 'act-supply-tank',
    'act-alarm-devices', 'ft-actuators', 'filt-actuators'
  ];
  const allNames = Object.keys(ACTUATOR_META);
  allNames.forEach(name => {
    const backendOn = isOn(data[name]);
    containers.forEach(cid => {
      const stateEl  = document.getElementById(`actst-${cid}-${name}`);
      const toggleEl = document.getElementById(`acttog-${cid}-${name}`);
      const cardEl   = document.getElementById(`actcard-${cid}-${name}`);
      if (stateEl) {
        stateEl.textContent = backendOn ? 'ON' : 'OFF';
        stateEl.style.color = backendOn ? 'var(--cyan)' : 'var(--text3)';
      }
      if (toggleEl) toggleEl.checked = backendOn;
      if (cardEl)   cardEl.classList.toggle('on', backendOn);
    });
    // Also sync supply valve3 in supply-tank panel
    syncNamedToggle('sup-valve3-toggle', 'sup-valve3-state', name, data[name]);
  });
  // Alarm LED/Buzzer panel
  syncNamedToggle('alarm-buzzer-toggle', 'alarm-buzzer-state', 'alarmBuzzer', data.alarmBuzzer);
  syncNamedToggle('alarm-led-toggle',    'alarm-led-state',    'alarmLed',    data.alarmLed);
}

function syncNamedToggle(toggleId, stateId, actuatorName, val) {
  const toggle = document.getElementById(toggleId);
  const stEl   = document.getElementById(stateId);
  if (!toggle && !stEl) return;
  const on = isOn(val);
  if (toggle) toggle.checked = on;
  if (stEl)   stEl.textContent = on ? 'ON' : 'OFF';
}

function updateActuatorOverview() {
  const el = document.getElementById('ov-actuators');
  if (!el) return;
  const data = State.actuators.current;
  const names = Object.keys(ACTUATOR_META);
  let onCount = 0;
  el.innerHTML = names.map(name => {
    const meta = ACTUATOR_META[name] || { label: name, icon: '⚙' };
    const on = isOn(data[name]);
    if (on) onCount++;
    return `
      <div style="background:var(--card);border:1px solid ${on ? 'rgba(0,212,255,.2)' : 'var(--card-b)'};
           border-radius:8px;padding:.6rem .75rem;display:flex;align-items:center;gap:.5rem;font-size:.78rem">
        <span>${meta.icon}</span>
        <span style="flex:1;color:var(--text2)">${meta.label}</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:.7rem;
              color:${on ? 'var(--cyan)' : 'var(--text3)'}">${on ? 'ON' : 'OFF'}</span>
      </div>`;
  }).join('');

  // Update "X Running" badge in actuator panel header
  const badge = document.querySelector('#panel-actuators .badge-ok');
  if (badge) badge.textContent = `${onCount} Running`;
  // Update overview stat card
  setText('ov-active-actuators', `${onCount}/${names.length}`);
}

function updatePumpSpeedUI(data) {
  // Pump 1 speed
  const slider1 = document.getElementById('pump1-speed-slider');
  const spd1    = data.pump1Speed;
  if (slider1 && spd1 !== null && spd1 !== undefined) {
    if (!State.actuators.pending.has('pump1Speed')) {
      slider1.value = Math.round(spd1);
      setText('pump-spd-val', Math.round(spd1) + '%');
    }
  }
  // Pump 2 state (ON/OFF via pump2Speed > 0)
  const p2  = data.pump2Speed;
  const p2On = p2 !== null && p2 !== undefined && p2 > 0;
  const p2Toggle = document.getElementById('pump2-toggle');
  const p2State  = document.getElementById('p2-state');
  if (p2Toggle && !State.actuators.pending.has('pump2Speed')) p2Toggle.checked = p2On;
  if (p2State) { p2State.textContent = p2On ? 'ON' : 'OFF'; }
}

/** Handle toggle event (user-initiated) */
async function handleActuatorToggle(name, checkboxEl, sourceContainerId) {
  // RBAC: block write operations for non-admin users
  if (!isAdminUser()) {
    checkboxEl.checked = !checkboxEl.checked; // revert optimistic UI change
    showToast('⛔ Actuator control requires Admin role.', 'warn');
    return;
  }
  if (State.actuators.pending.has(name)) { checkboxEl.checked = !checkboxEl.checked; return; }
  const wantedOn = checkboxEl.checked;
  const value    = wantedOn ? 1.0 : 0.0;

  // Optimistically disable the toggle to prevent double-click
  State.actuators.pending.add(name);
  checkboxEl.disabled = true;

  try {
    await sendActuatorValue(name, value);
    // Let the next poll confirm state
  } catch (err) {
    // Revert UI
    checkboxEl.checked = !wantedOn;
    showToast(`Failed to update ${name}: ${err.message}`, 'error');
  } finally {
    State.actuators.pending.delete(name);
    checkboxEl.disabled = false;
  }
}

async function sendActuatorValue(actuatorName, value) {
  // RBAC: prevent write requests from non-admin users at the API layer
  if (!isAdminUser()) {
    showToast('⛔ Write operations require Admin role.', 'warn');
    throw new Error('Insufficient role');
  }
  const url = `${ENDPOINTS.actuatorUpdate}?actuatorName=${encodeURIComponent(actuatorName)}&value=${value}`;
  const res = await apiFetch(url, { method: 'PATCH' });
  if (!res.ok) {
    const errData = await parseJSON(res);
    throw new Error(errData?.message || `HTTP ${res.status}`);
  }
  // Immediately fetch updated state to confirm
  await fetchActuators();
}

// Legacy function called by inline onchange handlers in HTML
async function toggleActuator(name, checkboxEl) {
  await handleActuatorToggle(name, checkboxEl, '');
}

/* =====================================================================
   ALARMS
   ===================================================================== */
async function fetchAlarms() {
  try {
    const res = await apiFetch(ENDPOINTS.alarmsActive);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await parseJSON(res);
    if (!Array.isArray(data)) return;
    State.alarms.list = data;
    renderAlarms();
    updateAlarmBadges();
  } catch (err) {
    console.warn('Alarm fetch failed:', err.message);
  }
}

function getSeverityClass(alarmType) {
  if (!alarmType) return { item: 'ai-info', dot: 'sev-info', type: 'at-info', label: 'INFO' };
  const t = alarmType.toUpperCase();
  if (t.startsWith('CRITICAL') || t.includes('CRITICAL')) return { item: 'ai-critical', dot: 'sev-critical', type: 'at-critical', label: 'CRITICAL' };
  if (t.startsWith('EMERGENCY'))                           return { item: 'ai-emergency', dot: 'sev-emergency', type: 'at-emergency', label: 'EMERGENCY' };
  if (t.startsWith('WARNING') || t.includes('WARNING'))   return { item: 'ai-warn',     dot: 'sev-warn',     type: 'at-warn',     label: 'WARNING' };
  return { item: 'ai-info', dot: 'sev-info', type: 'at-info', label: 'INFO' };
}

function renderAlarms() {
  const el = document.getElementById('alarm-list');
  if (!el) return;
  const alarms = State.alarms.list;
  const filter = State.alarms.filter;

  let filtered = alarms;
  if (filter === 'active')   filtered = alarms.filter(a => !a.resolved);
  if (filter === 'resolved') filtered = alarms.filter(a =>  a.resolved);
  if (filter === 'critical') filtered = alarms.filter(a => a.alarmType?.toUpperCase().includes('CRITICAL'));
  if (filter === 'warn')     filtered = alarms.filter(a => a.alarmType?.toUpperCase().includes('WARNING'));

  if (!filtered.length) {
    el.innerHTML = `
      <div style="text-align:center;padding:2.5rem;color:var(--text3);font-size:.85rem">
        ${filter === 'active' ? '✅ No active alarms. System running normally.' : '📭 No alarms match the current filter.'}
      </div>`;
    return;
  }

  el.innerHTML = filtered.map(alarm => {
    const sev = getSeverityClass(alarm.alarmType);
    return `
      <div class="alarm-item ${sev.item}" data-id="${alarm.id}" data-sev="${sev.label.toLowerCase()}" data-resolved="${alarm.resolved}">
        <div class="alarm-sev-dot ${sev.dot}"></div>
        <div class="alarm-body">
          <div class="alarm-type ${sev.type}">${sev.label} — ${alarm.alarmType || 'UNKNOWN'}</div>
          <div class="alarm-msg">${alarm.message || '—'}</div>
          <div class="alarm-meta">
            <span>📅 ${fmtTime(alarm.triggeredAt)}</span>
            <span>🔧 ${alarm.deviceId || 'Unknown'}</span>
            ${alarm.resolved ? `<span>✅ Resolved: ${fmtTime(alarm.resolvedAt)}</span>` : ''}
          </div>
        </div>
        <div class="alarm-actions">
          ${!alarm.resolved ? `<button class="btn-xs btn-resolve" onclick="resolveAlarmById(${alarm.id})">Resolve</button>` : ''}
          <button class="btn-xs btn-detail">Details</button>
        </div>
      </div>`;
  }).join('');
}

function updateAlarmBadges() {
  const activeCount = State.alarms.list.filter(a => !a.resolved).length;
  // Sidebar badge
  const sbBadge = document.querySelector('#sb-alarms .nav-badge');
  if (sbBadge) sbBadge.textContent = activeCount || '';
  if (sbBadge) sbBadge.style.display = activeCount ? '' : 'none';
  // Notification count
  setText('notif-count', activeCount);
  const notifBadgeEl = document.getElementById('notif-count');
  if (notifBadgeEl) notifBadgeEl.style.display = activeCount ? 'flex' : 'none';
}

async function resolveAlarmById(id) {
  // RBAC
  if (!isAdminUser()) {
    showToast('⛔ Resolving alarms requires Admin role.', 'warn');
    return;
  }
  try {
    const res = await apiFetch(ENDPOINTS.alarmResolve(id), { method: 'PUT' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast('Alarm resolved.', 'success');
    await fetchAlarms();
  } catch (err) {
    showToast(`Failed to resolve alarm: ${err.message}`, 'error');
  }
}

// Legacy inline handler
async function resolveAlarm(btn) {
  const item = btn.closest('[data-id]');
  if (!item) return;
  const id = item.dataset.id;
  if (id) await resolveAlarmById(id);
}

function filterAlarms(filter, btn) {
  State.alarms.filter = filter;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderAlarms();
}

function markAllRead() {
  // RBAC
  if (!isAdminUser()) {
    showToast('⛔ Resolving alarms requires Admin role.', 'warn');
    return;
  }
  const ids = State.alarms.list.filter(a => !a.resolved).map(a => a.id);
  if (!ids.length) return;
  Promise.all(ids.map(id => apiFetch(ENDPOINTS.alarmResolve(id), { method: 'PUT' }))).then(() => {
    showToast('All alarms resolved.', 'success');
    fetchAlarms();
  }).catch(err => showToast('Failed to resolve some alarms: ' + err.message, 'error'));
}

/* =====================================================================
   CAMERA
   ===================================================================== */
async function fetchCameraLatest() {
  try {
    const res = await apiFetch(ENDPOINTS.cameraLatest);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await parseJSON(res);
    if (!data) return;
    State.camera.latest = data;
    renderCameraLatest(data);
  } catch (err) {
    console.warn('Camera latest failed:', err.message);
    setCameraOffline();
  }
}

function imgUrl(path) {
  if (!path) return '';
  // If path is already a full URL return as-is, otherwise prepend IMG_BASE
  if (path.startsWith('http')) return path;
  return IMG_BASE + '/' + path.replace(/^\//, '');
}

function renderCameraLatest(data) {
  const url = imgUrl(data.imagePath);
  const ts  = fmtTime(data.timestamp);

  setText('ecp-latest-ts', ts);
  setText('ecp-last-time', fmtRelative(data.timestamp));

  const img     = document.getElementById('ecp-latest-img');
  const ph      = document.getElementById('ecp-placeholder');
  const overlay = document.getElementById('ecp-img-overlay');
  const dlBtn   = document.getElementById('ecp-download-btn');

  if (img && url) {
    img.src = url;
    img.onload = () => {
      img.classList.remove('hidden');
      if (ph) ph.classList.add('hidden');
      if (overlay) overlay.style.display = '';
    };
    img.onerror = () => {
      img.classList.add('hidden');
      if (ph) { ph.classList.remove('hidden'); ph.querySelector('.ecp-placeholder-txt').textContent = 'Image load failed'; }
    };
  }

  if (dlBtn) dlBtn.disabled = !url;

}

function setCameraOffline() {
  // Camera offline — status shown via esp-camera card
}

async function ecpTriggerCapture() {
  // RBAC: camera capture is a device command
  if (!isAdminUser()) {
    showToast('⛔ Device commands require Admin role.', 'warn');
    return;
  }
  const btn  = document.getElementById('ecp-capture-btn');
  const icon = document.getElementById('ecp-capture-icon');
  const txt  = document.getElementById('ecp-capture-txt');
  if (btn) btn.disabled = true;
  if (icon) icon.textContent = '⏳';
  if (txt)  txt.textContent  = 'Capturing…';

  try {
    const res = await apiFetch(ENDPOINTS.cameraCapture, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast('Image captured successfully!', 'success');
    await fetchCameraLatest();
    await ecpLoadHistory();
  } catch (err) {
    showToast(`Capture failed: ${err.message}`, 'error');
  } finally {
    if (btn)  btn.disabled = false;
    if (icon) icon.textContent = '📸';
    if (txt)  txt.textContent  = 'Capture Image';
  }
}

async function ecpLoadHistory() {
  setHidden('ecp-history-loading', false);
  setHidden('ecp-history-empty', true);
  setHidden('ecp-view-gallery', true);
  setHidden('ecp-view-timelapse', true);

  try {
    const res = await apiFetch(ENDPOINTS.cameraHistory);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await parseJSON(res);
    if (!Array.isArray(data) || !data.length) {
      setHidden('ecp-history-loading', true);
      setHidden('ecp-history-empty', false);
      return;
    }
    State.camera.history = data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Update stats
    setText('ecp-total', data.length);
    setText('ecp-storage', (data.length * 0.12).toFixed(1) + ' MB'); // estimated

    setHidden('ecp-history-loading', true);

    if (State.camera.view === 'gallery') {
      renderCameraGallery();
    } else {
      ecpSetView('timelapse');
    }
  } catch (err) {
    setHidden('ecp-history-loading', true);
    setHidden('ecp-history-empty', false);
    showToast(`History load failed: ${err.message}`, 'error');
  }
}

function renderCameraGallery() {
  const grid = document.getElementById('ecp-gallery-grid');
  const meta = document.getElementById('ecp-gallery-meta');
  if (!grid) return;
  setHidden('ecp-view-gallery', false);
  const hist = State.camera.history;
  if (meta) meta.textContent = `${hist.length} image${hist.length !== 1 ? 's' : ''} · sorted newest first`;

  grid.innerHTML = hist.map((item, idx) => `
    <div class="ecp-thumb-card ${State.camera.latest?.id === item.id ? 'ecp-active-thumb' : ''}"
         onclick="ecpGalleryClick(${idx})">
      <img class="ecp-thumb-img" src="${imgUrl(item.imagePath)}" alt="Capture ${idx+1}"
           onerror="this.style.display='none'" loading="lazy" />
      <div class="ecp-thumb-info">
        <div class="ecp-thumb-ts">${fmtTime(item.timestamp)}</div>
        <div class="ecp-thumb-num">#${hist.length - idx}</div>
      </div>
    </div>`).join('');
}

function ecpGalleryClick(idx) {
  const item = State.camera.history[idx];
  if (!item) return;
  const fsImg  = document.getElementById('ecp-fs-img');
  const fsMeta = document.getElementById('ecp-fs-meta');
  if (fsImg)  fsImg.src = imgUrl(item.imagePath);
  if (fsMeta) fsMeta.textContent = fmtTime(item.timestamp);
  setHidden('ecp-fullscreen-overlay', false);
}

function ecpOpenFullscreen() {
  const latest = State.camera.latest;
  if (!latest) return;
  const fsImg  = document.getElementById('ecp-fs-img');
  const fsMeta = document.getElementById('ecp-fs-meta');
  if (fsImg)  fsImg.src = imgUrl(latest.imagePath);
  if (fsMeta) fsMeta.textContent = fmtTime(latest.timestamp);
  setHidden('ecp-fullscreen-overlay', false);
}

function ecpCloseFullscreen() { setHidden('ecp-fullscreen-overlay', true); }

function ecpDownloadLatest() {
  const latest = State.camera.latest;
  if (!latest) return;
  const a = document.createElement('a');
  a.href = imgUrl(latest.imagePath);
  a.download = `aquasystem_${latest.timestamp || Date.now()}.jpg`;
  a.click();
}

function ecpSetView(view) {
  State.camera.view = view;
  document.getElementById('ecp-btn-gallery')?.classList.toggle('active', view === 'gallery');
  document.getElementById('ecp-btn-timelapse')?.classList.toggle('active', view === 'timelapse');
  setHidden('ecp-view-gallery', view !== 'gallery');
  setHidden('ecp-view-timelapse', view !== 'timelapse');

  if (view === 'gallery') {
    renderCameraGallery();
  } else {
    initTimelapse();
  }
}

// ── Timelapse ─────────────────────────────────────────────────
function initTimelapse() {
  const hist = State.camera.history;
  if (!hist.length) return;
  State.camera.tlIndex = hist.length - 1; // start from oldest
  const scrub = document.getElementById('ecp-tl-scrub');
  if (scrub) { scrub.max = hist.length - 1; scrub.value = hist.length - 1; }
  ecpRenderFrame(State.camera.tlIndex);
}

function ecpRenderFrame(idx) {
  const hist = State.camera.history;
  if (!hist.length) return;
  // history is newest-first; timelapse plays oldest→newest so invert
  const realIdx = hist.length - 1 - idx;
  const item = hist[realIdx];
  if (!item) return;
  State.camera.tlIndex = idx;

  const img    = document.getElementById('ecp-tl-img');
  const badge  = document.getElementById('ecp-tl-frame-badge');
  const tsEl   = document.getElementById('ecp-tl-ts');
  const prog   = document.getElementById('ecp-tl-progress');
  const scrub  = document.getElementById('ecp-tl-scrub');
  const total  = hist.length;
  const pct    = total > 1 ? (idx / (total - 1)) * 100 : 100;

  if (img) { img.classList.add('ecp-fade'); setTimeout(() => { img.src = imgUrl(item.imagePath); img.classList.remove('ecp-fade'); }, 120); }
  if (badge) badge.textContent = `Frame ${idx + 1} / ${total}`;
  if (tsEl)  tsEl.textContent  = fmtTime(item.timestamp);
  if (prog)  prog.style.width  = pct + '%';
  if (scrub) scrub.value = idx;
}

function ecpTLFirst()  { stopTimelapse(); ecpRenderFrame(0); }
function ecpTLLast()   { stopTimelapse(); ecpRenderFrame(Math.max(0, State.camera.history.length - 1)); }
function ecpTLPrev()   { stopTimelapse(); ecpRenderFrame(Math.max(0, State.camera.tlIndex - 1)); }
function ecpTLNext()   { stopTimelapse(); ecpRenderFrame(Math.min(State.camera.history.length - 1, State.camera.tlIndex + 1)); }
function ecpScrubTo(v) { ecpRenderFrame(parseInt(v)); }
function ecpSetSpeed(v){ State.camera.tlSpeed = parseInt(v); if (State.camera.tlTimer) { stopTimelapse(); startTimelapse(); } }

function ecpTLTogglePlay() {
  if (State.camera.tlTimer) { stopTimelapse(); } else { startTimelapse(); }
}

function startTimelapse() {
  const btn = document.getElementById('ecp-play-btn');
  if (btn) { btn.textContent = '⏸'; btn.classList.add('ecp-playing'); }
  State.camera.tlTimer = setInterval(() => {
    const next = State.camera.tlIndex + 1;
    if (next >= State.camera.history.length) { stopTimelapse(); return; }
    ecpRenderFrame(next);
  }, State.camera.tlSpeed);
}

function stopTimelapse() {
  clearInterval(State.camera.tlTimer);
  State.camera.tlTimer = null;
  const btn = document.getElementById('ecp-play-btn');
  if (btn) { btn.textContent = '▶'; btn.classList.remove('ecp-playing'); }
}

/* =====================================================================
   CSV EXPORT
   ===================================================================== */
function exportHistoryCSV() {
  const recs = State.history.records;
  if (!recs.length) { showToast('No history data to export.', 'warn'); return; }
  const headers = ['Timestamp','pH','TDS_ppm','Turbidity_NTU','WaterTemp_C','AirTemp_C','Humidity_%',
                    'FishTankFloat_Overflow','FishTankFloat_Underflow','WL3_%','WL4_%',
                    'FilterTankFloat_Overflow','FilterTankFloat_Underflow'];
  const rows = recs.map(r => [
    r.loggedAt, r.phValue, r.tdsRaw, r.turbidityRaw,
    r.waterTemp, r.sht31Temp, r.sht31Humidity,
    r.fishTankFloat_overflow, r.fishTankFloat_underflow, r.waterLevel3, r.waterLevel4,
    r.filterTankFloat_overflow, r.filterTankFloat_underflow
  ].map(v => v ?? '').join(','));
  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `aquasystem_history_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('CSV downloaded.', 'success');
}

function exportReport(type) {
  // Reuse history data for all report types
  exportHistoryCSV();
}

function exportCustomReport() {
  const from   = document.getElementById('rpt-from')?.value;
  const to     = document.getElementById('rpt-to')?.value;
  const format = document.getElementById('rpt-format')?.value || 'csv';
  if (!from || !to) { showToast('Please select a date range.', 'warn'); return; }

  const filtered = State.history.records.filter(r => {
    const d = new Date(r.loggedAt).toISOString().slice(0,10);
    return d >= from && d <= to;
  });
  if (!filtered.length) { showToast('No records in the selected range.', 'warn'); return; }

  if (format === 'json') {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `aquasystem_${from}_${to}.json`;
    a.click();
  } else {
    const headers = ['Timestamp','pH','TDS','Turbidity','WaterTemp','AirTemp','Humidity',
                      'FishFloatOverflow','FishFloatUnderflow','WL3','WL4','FilterFloatOverflow','FilterFloatUnderflow'];
    const rows    = filtered.map(r => [r.loggedAt,r.phValue,r.tdsRaw,r.turbidityRaw,r.waterTemp,r.sht31Temp,r.sht31Humidity,
                      r.fishTankFloat_overflow,r.fishTankFloat_underflow,r.waterLevel3,r.waterLevel4,
                      r.filterTankFloat_overflow,r.filterTankFloat_underflow].map(v=>v??'').join(','));
    const csv     = [headers.join(','), ...rows].join('\n');
    const blob    = new Blob([csv], { type: 'text/csv' });
    const a       = document.createElement('a');
    a.href        = URL.createObjectURL(blob);
    a.download    = `aquasystem_${from}_${to}.csv`;
    a.click();
  }
  showToast('Report generated.', 'success');
}

/* =====================================================================
   NAVIGATION
   ===================================================================== */
function switchPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById(`panel-${name}`);
  if (panel) panel.classList.add('active');
  const navItem = document.getElementById(`sb-${name}`);
  if (navItem) navItem.classList.add('active');
  State.activePanel = name;
  // Persist so a browser refresh (F5) restores this same view instead of
  // bouncing back to the first page.
  try { sessionStorage.setItem(ACTIVE_PANEL_KEY, name); } catch (e) { /* ignore */ }
  // Close sidebar on mobile
  if (window.innerWidth <= 900) { document.getElementById('sidebar')?.classList.remove('open'); }
  // Trigger chart re-render if analytics panel opened
  if (name === 'analytics') renderAnalyticsCharts();
}

function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
}

function toggleNotif() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  const isOpen = panel.style.display === 'block';
  panel.style.display = isOpen ? 'none' : 'block';
}

// Close notif panel on outside click
document.addEventListener('click', e => {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  if (!e.target.closest('#notif-panel') && !e.target.closest('[onclick="toggleNotif()"]')) {
    panel.style.display = 'none';
  }
});

function refreshData() {
  fetchSensors();
  fetchActuators();
  showToast('Data refreshed.', 'info', 1500);
}

/* =====================================================================
   MODAL
   ===================================================================== */
function showModal(id, title, body, callback) {
  setText('modal-title', title || 'Confirm Action');
  setText('modal-body',  body  || 'Are you sure?');
  State.modalCallback = callback || null;
  document.getElementById('confirm-modal')?.classList.add('active');
  document.getElementById('confirm-modal').style.display = 'flex';
}

function closeModal() {
  const m = document.getElementById('confirm-modal');
  if (m) m.style.display = 'none';
  State.modalCallback = null;
}

function confirmAction() {
  if (State.modalCallback) State.modalCallback();
  closeModal();
}

/* =====================================================================
   AUTOMATION (local-only, no backend endpoint defined)
   ===================================================================== */
function saveAutomation() {
  if (!isAdminUser()) {
    showToast('⛔ Settings changes require Admin role.', 'warn');
    return;
  }
  showToast('Automation settings saved locally. (Backend endpoint not yet defined.)', 'info');
}

/* =====================================================================
   ENTRY POINT — DOMContentLoaded
   ===================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  // Restore authentication session if present
  try {
    const saved = sessionStorage.getItem('aqua_auth');
    if (saved) {
      const authState = JSON.parse(saved);
      if (authState && authState.username) {
        State.auth.token    = authState.token || null;
        State.auth.username = authState.username;
        State.auth.role     = authState.role   || 'ROLE_ADMIN';

        // Update UI username display
        document.querySelectorAll('.user-chip span').forEach((el, i) => { if (i === 0) el.textContent = authState.username; });
        document.querySelectorAll('.user-avatar').forEach(el => { el.textContent = authState.username.slice(0,2).toUpperCase(); });

        // Skip login page, go directly to dashboard
        document.getElementById('login-page').classList.add('hidden');
        document.getElementById('app-shell').classList.remove('hidden');
        loadSensorRanges();
        initDashboard();
        applyRoleUI();
        return;
      }
    }
  } catch (e) {
    sessionStorage.removeItem('aqua_auth');
  }

  // Wire Enter key on login
  document.getElementById('login-pass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('login-user')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  // Wire notification panel display reset
  const notifPanel = document.getElementById('notif-panel');
  if (notifPanel) notifPanel.style.display = 'none';

  // Modal overlay click to close
  document.getElementById('confirm-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
});
