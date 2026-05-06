/* ── ReHoster admin.js ── */

// ── Status polling ──
const STATUS_INTERVAL = 8000;
const LOG_INTERVAL = 2500;
const COUNTER_DURATION = 1000;

function getStatusDisplay(status) {
  const value = String(status || 'unknown').toLowerCase();
  const icons = {
    running: '●',
    stopped: '■',
    missing: '⚠',
    failed: '✕',
    creating: '◌',
    cloning: '↧',
    building: '⌛',
    staging: '◔',
    restarting: '↺',
    unknown: '?'
  };
  return {
    value,
    icon: icons[value] || icons.unknown
  };
}

function initStatusPolling() {
  const cells = document.querySelectorAll('[data-app-id]');
  if (!cells.length) return;

  const poll = () => {
    cells.forEach(cell => {
      const id = cell.dataset.appId;
      fetch(`/admin/apps/${id}/status`)
        .then(r => r.json())
        .then(data => {
          const badge = cell.querySelector('.badge');
          if (badge && data.status) {
            const statusMeta = getStatusDisplay(data.status);
            const isPulse = statusMeta.value === 'running';
            const isShake = statusMeta.value === 'failed';
            const isWorking = ['creating', 'cloning', 'building', 'staging', 'restarting'].includes(statusMeta.value);
            badge.className = `badge badge-${statusMeta.value}`;
            badge.classList.toggle('badge-pulse', isPulse);
            badge.classList.toggle('badge-shake', isShake);
            badge.classList.toggle('badge-working', isWorking);
            badge.innerHTML = `<span class="badge-icon">${statusMeta.icon}</span>${statusMeta.value}`;
          }
          const portEl = cell.querySelector('.port-display');
          if (portEl && data.port) portEl.textContent = `:${data.port}`;
        })
        .catch(() => {});
    });
  };

  setInterval(poll, STATUS_INTERVAL);
}

// ── Theme toggle ──
function initTheme() {
  const stored = localStorage.getItem('theme') || 'dark';
  if (stored === 'light') document.documentElement.classList.add('light-theme');

  const btn = document.getElementById('themeToggle');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const isLight = document.documentElement.classList.toggle('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    btn.textContent = isLight ? '🌙' : '☀️';

    fetch('/admin/settings/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ theme: isLight ? 'light' : 'dark' })
    }).catch(() => {});
  });

  const isLight = document.documentElement.classList.contains('light-theme');
  btn.textContent = isLight ? '🌙' : '☀️';
}

// ── Terminal panel ──
let terminalExpanded = false;

function toggleTerminal() {
  terminalExpanded = !terminalExpanded;
  const panel = document.getElementById('terminalPanel');
  const btn = document.getElementById('terminalToggle');
  if (!panel) return;
  panel.classList.toggle('expanded', terminalExpanded);
  if (btn) btn.textContent = terminalExpanded ? '▼ collapse' : '▲ expand';
}

// ── Log feed ──
let lastLogId = 0;

function appendLog(entry) {
  const out = document.getElementById('terminalOutput');
  if (!out) return;

  const placeholder = out.querySelector('.terminal-placeholder');
  if (placeholder) placeholder.remove();

  const line = document.createElement('div');
  line.className = `terminal-line level-${entry.level || 'info'}`;

  const t = document.createElement('span');
  t.className = 'terminal-line-time';
  t.textContent = entry.created_at ? entry.created_at.substring(11, 19) : '';

  const src = document.createElement('span');
  src.className = 'terminal-line-source';
  src.textContent = `[${(entry.source || 'system').substring(0, 10)}]`;

  const msg = document.createElement('span');
  msg.className = 'terminal-line-msg';
  msg.textContent = entry.message || '';

  line.append(t, src, msg);
  out.appendChild(line);

  // auto scroll
  if (out.scrollTop + out.clientHeight >= out.scrollHeight - 40) {
    out.scrollTop = out.scrollHeight;
  }

  // cap at 200 lines
  while (out.children.length > 200) out.removeChild(out.firstChild);
}

function initLogFeed() {
  const out = document.getElementById('terminalOutput');
  if (!out) return;

  const poll = () => {
    fetch(`/api/system-logs?since=${lastLogId}&limit=30`)
      .then(r => r.json())
      .then(data => {
        const entries = Array.isArray(data) ? data : (data.logs || []);
        if (!entries.length) return;
        entries.forEach(entry => {
          if (entry.id > lastLogId) lastLogId = entry.id;
          appendLog(entry);
        });
      })
      .catch(() => {});
  };

  // fetch initial
  poll();
  setInterval(poll, LOG_INTERVAL);
}

// ── Copy to clipboard ──
function initCopyButtons() {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy || btn.closest('[data-copy]')?.dataset.copy || '';
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        const orig = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = orig; }, 1200);
      } catch (e) {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    });
  });
}

// ── Form validation ──
function getValidationMessage(field) {
  if (!field) return 'This field is required.';
  if (field.validity.valueMissing) return 'This field is required.';
  if (field.validity.tooShort) return `Please enter at least ${field.minLength} characters.`;
  if (field.validity.typeMismatch) return 'Please enter a valid value.';
  if (field.validity.patternMismatch) return 'Please match the requested format.';
  return 'Please correct this field.';
}

function clearFieldValidation(field) {
  const group = field.closest('.form-group');
  field.classList.remove('form-input-error');
  field.removeAttribute('aria-invalid');
  if (!group) return;

  group.classList.remove('form-group-error');
  const error = group.querySelector('.form-error-text');
  if (error) error.remove();
}

function markFieldValidation(field, message) {
  const group = field.closest('.form-group');
  field.classList.add('form-input-error');
  field.setAttribute('aria-invalid', 'true');
  if (!group) return;

  group.classList.add('form-group-error');
  let error = group.querySelector('.form-error-text');
  if (!error) {
    error = document.createElement('small');
    error.className = 'form-error-text';
    group.appendChild(error);
  }
  error.textContent = message;
}

function validateForm(form) {
  const fields = [...form.querySelectorAll('input, select, textarea')]
    .filter(field => !field.disabled && field.willValidate);
  let firstInvalid = null;

  fields.forEach(field => clearFieldValidation(field));

  fields.forEach(field => {
    if (field.checkValidity()) return;
    markFieldValidation(field, getValidationMessage(field));
    if (!firstInvalid) firstInvalid = field;
  });

  return { valid: !firstInvalid, firstInvalid };
}

function initFormValidation() {
  document.querySelectorAll('form').forEach(form => {
    form.noValidate = true;

    const fields = [...form.querySelectorAll('input, select, textarea')]
      .filter(field => !field.disabled && field.willValidate);

    fields.forEach(field => {
      const eventName = field.tagName === 'SELECT' || field.type === 'checkbox' || field.type === 'radio'
        ? 'change'
        : 'input';

      field.addEventListener(eventName, () => {
        if (field.checkValidity()) {
          clearFieldValidation(field);
        }
      });

      field.addEventListener('blur', () => {
        if (!field.checkValidity()) {
          markFieldValidation(field, getValidationMessage(field));
        }
      });
    });

    form.addEventListener('submit', event => {
      const result = validateForm(form);
      if (result.valid) return;

      event.preventDefault();
      form.classList.remove('form-invalid-shake');
      void form.offsetWidth;
      form.classList.add('form-invalid-shake');

      if (result.firstInvalid) {
        result.firstInvalid.focus();
      }
    });
  });
}

// ── Env vault toggle ──
function initEnvVault() {
  document.querySelectorAll('.env-val').forEach(el => {
    el.addEventListener('click', () => {
      const isShown = el.dataset.shown === '1';
      if (isShown) {
        el.textContent = '••••••••';
        el.dataset.shown = '0';
      } else {
        el.textContent = el.dataset.value || '••••••••';
        el.dataset.shown = '1';
      }
    });
  });
}

// ── Bulk actions ──
function initBulkActions() {
  const selectAll = document.getElementById('selectAll');
  const bulkBar = document.getElementById('bulkActions');
  const countEl = document.getElementById('bulkCount');

  function updateBar() {
    const checked = document.querySelectorAll('.app-checkbox:checked');
    if (bulkBar) {
      bulkBar.style.display = checked.length ? 'flex' : 'none';
    }
    if (countEl) countEl.textContent = checked.length;
  }

  if (selectAll) {
    selectAll.addEventListener('change', () => {
      document.querySelectorAll('.app-checkbox').forEach(cb => {
        cb.checked = selectAll.checked;
      });
      updateBar();
    });
  }

  document.querySelectorAll('.app-checkbox').forEach(cb => {
    cb.addEventListener('change', updateBar);
  });
}

function bulkAction(action) {
  const checked = [...document.querySelectorAll('.app-checkbox:checked')];
  if (!checked.length) return;

  const confirm_map = { delete: 'Delete selected apps permanently?' };
  if (confirm_map[action] && !confirm(confirm_map[action])) return;

  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  let done = 0;

  checked.forEach(cb => {
    const id = cb.value;
    fetch(`/admin/apps/${id}/bulk-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': csrf
      },
      body: JSON.stringify({ action })
    })
      .then(() => { done++; if (done === checked.length) location.reload(); })
      .catch(() => { done++; if (done === checked.length) location.reload(); });
  });
}

// ── Counter animation ──
function animateCounters() {
  document.querySelectorAll('.stat-counter').forEach(el => {
    const target = parseInt(el.textContent, 10);
    if (isNaN(target)) return;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / COUNTER_DURATION, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target);
      if (progress < 1) requestAnimationFrame(tick);
    };
    tick();
  });
}

// ── Keyboard shortcuts ──
let kbState = '';
let kbTimer = null;

function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return;

    if (e.key === '?') {
      showShortcutsModal();
      return;
    }

    kbState += e.key;
    clearTimeout(kbTimer);

    const shortcuts = {
      'ga': '/admin/apps',
      'gs': '/admin/settings',
      'gn': '/admin/apps/new',
      'gm': '/admin/metrics',
      'gl': '/admin/analytics',
      'gS': '/status',
    };

    if (shortcuts[kbState]) {
      location.href = shortcuts[kbState];
      kbState = '';
      return;
    }

    kbTimer = setTimeout(() => { kbState = ''; }, 800);
  });
}

function showShortcutsModal() {
  const existing = document.getElementById('shortcutsModal');
  if (existing) { existing.remove(); return; }

  const modal = document.createElement('div');
  modal.id = 'shortcutsModal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-overlay" onclick="document.getElementById('shortcutsModal').remove()"></div>
    <div class="modal-content" style="max-width:420px">
      <div class="modal-header">
        <h3>⌨ Keyboard Shortcuts</h3>
        <button class="modal-close" onclick="document.getElementById('shortcutsModal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <table style="width:100%;border-collapse:collapse">
          ${[
            ['g a', 'Go to Apps'],
            ['g s', 'Go to Settings'],
            ['g n', 'New Deployment'],
            ['g m', 'Metrics'],
            ['g l', 'Analytics'],
            ['g S', 'Status page'],
            ['?', 'Show shortcuts'],
          ].map(([k, d]) => `
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:0.5rem 0.75rem"><kbd>${k}</kbd></td>
              <td style="padding:0.5rem 0.75rem;color:var(--text-secondary)">${d}</td>
            </tr>`).join('')}
        </table>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

// ── Tooltips (title attribute) ──
function initTooltips() {
  // Browser native title tooltips work by default; this enhances .tooltip-icon elements
  document.querySelectorAll('.tooltip-icon[title]').forEach(el => {
    el.setAttribute('tabindex', '0');
  });
}

// ── Flash auto-dismiss ──
function initFlash() {
  document.querySelectorAll('.alert').forEach(alert => {
    setTimeout(() => {
      alert.style.transition = 'opacity 0.5s ease';
      alert.style.opacity = '0';
      setTimeout(() => alert.remove(), 500);
    }, 4000);
  });
}

// ── Confirm delete ──
function confirmDelete(msg) {
  return confirm(msg || 'Are you sure you want to delete this?');
}

// ── DOMContentLoaded ──
document.addEventListener('DOMContentLoaded', () => {
  initStatusPolling();
  initTheme();
  initLogFeed();
  initCopyButtons();
  initFormValidation();
  initEnvVault();
  initBulkActions();
  initKeyboardShortcuts();
  initTooltips();
  initFlash();
  animateCounters();

  // terminal toggle button
  const termBtn = document.getElementById('terminalToggle');
  if (termBtn) termBtn.addEventListener('click', toggleTerminal);
});
