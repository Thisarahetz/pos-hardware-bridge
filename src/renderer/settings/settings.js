const $ = (id) => document.getElementById(id);
const api = window.bridge;

let config = null;
let discovered = [];
let networkFound = [];
let toastTimer = null;

// ---------- helpers ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child != null) node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

function setResult(id, message, kind) {
  const node = $(id);
  node.textContent = message || '';
  node.className = `result ${kind || ''}`;
}

/** Disable a button while an async action runs, showing a busy label. */
async function busy(button, label, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function saveConfig(patch, message = 'Saved') {
  config = await api.updateConfig(patch);
  renderConfig();
  toast(message);
}

// ---------- status ----------

function renderSteps(listId, wrapId, steps) {
  const list = $(listId);
  list.replaceChildren(...steps.map((s) => el('li', {}, s)));
  $(wrapId).hidden = steps.length === 0;
}

function renderStatus(status) {
  const p = status.printer;
  $('printerStatusCard').dataset.level = p.level;
  $('printerTitle').textContent = p.title;
  $('printerDetail').textContent = p.detail;
  renderSteps('printerStepsList', 'printerSteps', p.steps);
  $('testPrint').disabled = p.level === 'off' || p.level === 'error';

  const fixRow = $('printerFixRow');
  fixRow.replaceChildren();
  if (p.action === 'resume-queue') {
    fixRow.append(el('button', { class: 'primary', onclick: (e) => fix(e.target, 'resume-queue') }, 'Resume printing'));
  } else if (p.action === 'clear-queue') {
    fixRow.append(el('button', { onclick: (e) => fix(e.target, 'clear-queue') }, 'Clear waiting jobs'));
  }

  const t = status.terminal;
  $('terminalStatusCard').dataset.level = t.level;
  $('terminalTitle').textContent = t.title;
  $('terminalDetail').textContent = t.detail;
  renderSteps('terminalStepsList', 'terminalSteps', t.steps);

  const apiUp = status.api.running !== false;
  $('apiPill').classList.toggle('live', apiUp);
  $('apiPill').classList.toggle('down', !apiUp);
  $('apiPill').textContent = `${apiUp ? 'API running' : 'API stopped'} · ${status.api.url.replace('http://', '')}`;
  $('apiError').hidden = apiUp;
  $('apiError').textContent = apiUp ? '' : `Your POS can’t reach the bridge: ${status.api.error ?? 'unknown error'}`;

  // Device state changed (plugged/unplugged) — refresh the list to match.
  void loadPrinters();
}

async function fix(button, action) {
  const res = await busy(button, 'Working…', () => api.fixPrinter(action));
  if (res.ok) renderStatus(res.value);
  else toast(res.error);
}

// ---------- printers ----------

function isSelected(p) {
  if (!config?.printer.enabled) return false;
  if (config.printer.connectionType === 'network') {
    return p.kind === 'network' && !p.queueName && p.host === config.printer.network.host;
  }
  return Boolean(p.queueName) && p.queueName === config.printer.usb.systemPrinterName;
}

function describe(p) {
  const kind = p.kind === 'usb' ? 'USB' : p.kind === 'network' ? 'Network' : 'System printer';
  if (!p.online) return { sub: `${kind} · unplugged or off`, badge: ['Offline', 'error'] };
  if (!p.installed && p.kind === 'usb') return { sub: `${kind} · plugged in, not set up yet`, badge: ['New', ''] };
  return { sub: `${kind}${p.host ? ` · ${p.host}:${p.port}` : ''}`, badge: ['Connected', 'ok'] };
}

function renderPrinters() {
  const list = $('printerList');
  const seen = new Set(discovered.map((p) => p.host).filter(Boolean));
  const all = [...discovered, ...networkFound.filter((p) => !seen.has(p.host))];

  // Also show the configured network printer even if no scan was run.
  if (config?.printer.enabled && config.printer.connectionType === 'network' && !all.some(isSelected)) {
    const { host, port } = config.printer.network;
    all.unshift({ id: `net:${host}:${port}`, kind: 'network', label: `Network printer at ${host}`, host, port, installed: false, online: true });
  }

  if (all.length === 0) {
    list.replaceChildren(
      el('li', { class: 'empty' }, 'No printers found. Plug the printer in with USB and turn it on — it will appear here automatically.'),
    );
    return;
  }

  list.replaceChildren(
    ...all.map((p) => {
      const selected = isSelected(p);
      const { sub, badge } = describe(p);
      const action = selected
        ? el('span', { class: 'badge ok' }, '✓ In use')
        : el(
            'button',
            {
              class: p.online && p.likelyReceiptPrinter ? 'primary' : '',
              onclick: async (e) => {
                const res = await busy(e.target, p.installed ? 'Switching…' : 'Setting up…', () => api.usePrinter(p));
                if (!res.ok) return toast(res.error);
                config = await api.getConfig();
                renderConfig();
                renderStatus(res.value);
                toast(`Now printing to ${p.label}. Try a test print.`);
              },
            },
            p.installed || p.kind === 'network' ? 'Use this' : 'Set up',
          );
      return el(
        'li',
        { class: selected ? 'selected' : '' },
        el('span', { class: 'device-icon', 'aria-hidden': 'true' }, p.kind === 'network' ? '🌐' : p.kind === 'usb' ? '🔌' : '🖨️'),
        el('div', { class: 'device-main' }, el('div', { class: 'device-name' }, p.label), el('div', { class: 'device-sub' }, sub)),
        selected ? null : el('span', { class: `badge ${badge[1]}` }, badge[0]),
        action,
      );
    }),
  );
}

let loadingPrinters = null;
function loadPrinters() {
  loadingPrinters ??= api
    .discoverPrinters()
    .then((res) => {
      if (res.ok) discovered = res.value;
      renderPrinters();
    })
    .finally(() => (loadingPrinters = null));
  return loadingPrinters;
}

// ---------- terminal ----------

async function loadPorts() {
  const ports = await api.listSerialPorts($('showAllPorts').checked);
  const select = $('serialPath');
  const current = config.terminal.serialPath;
  const options = ports.map((p) => el('option', { value: p.path }, p.label));
  if (current && !ports.some((p) => p.path === current)) {
    options.unshift(el('option', { value: current }, `${current} (not connected)`));
  }
  if (options.length === 0) options.push(el('option', { value: '' }, 'No devices found — plug in the terminal'));
  else if (!current) options.unshift(el('option', { value: '' }, 'Choose a port…'));
  select.replaceChildren(...options);
  select.value = current || '';
}

// ---------- config ----------

function setSegment(id, value) {
  for (const b of $(id).querySelectorAll('button')) b.classList.toggle('active', b.dataset.value === String(value));
}

function snippet(url, token) {
  return `// Print a receipt from your POS (browser or Node 18+).
// Money is in minor units: 12.50 → 1250.
const BRIDGE_URL = '${url}';
const BRIDGE_TOKEN = '${token}';

async function printReceipt(sale) {
  const res = await fetch(\`\${BRIDGE_URL}/print/receipt\`, {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${BRIDGE_TOKEN}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sale),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error + (data.details ? ': ' + data.details.join('; ') : ''));
}

await printReceipt({
  businessName: 'My Shop',
  locationName: 'Main Street',
  saleReference: 'SALE-1042',
  timestamp: new Date().toLocaleString(),
  lines: [
    { label: 'Coffee', qty: 2, unitAmount: 350, totalAmount: 700 },
    { label: 'Croissant', totalAmount: 450 },
  ],
  subtotalAmount: 1150,
  taxAmount: 115,
  totalAmount: 1265,
  currency: 'USD',
  paymentMethod: 'Cash',
  footer: 'Thank you, come again!',
});`;
}

function renderConfig() {
  const { server, printer, terminal } = config;
  const url = `http://127.0.0.1:${server.port}`;
  $('apiUrl').value = url;
  $('authToken').value = server.authToken;
  $('port').value = server.port;
  $('snippet').textContent = snippet(url, server.authToken);

  setSegment('paperWidth', printer.paperWidthChars);
  setSegment('printerDriver', printer.driver);
  $('printerHost').value = printer.network.host;
  $('printerPort').value = printer.network.port;
  $('turnOffPrinter').hidden = !printer.enabled;

  $('launchAtLogin').checked = config.app?.launchAtLogin !== false;
  $('terminalEnabled').checked = terminal.enabled;
  $('terminalFields').hidden = !terminal.enabled;
  $('baudRate').value = terminal.baudRate;
  $('responseTimeoutSec').value = Math.round(terminal.responseTimeoutMs / 1000);
  renderPrinters();
}

// ---------- events ----------

$('testPrint').addEventListener('click', (e) =>
  busy(e.target, 'Printing…', async () => {
    setResult('printResult', '');
    const res = await api.testPrint();
    setResult('printResult', res.ok ? '✓ Test page sent. Check the printer.' : res.error, res.ok ? 'ok' : 'error');
  }),
);

$('refreshPrinters').addEventListener('click', (e) =>
  busy(e.target, 'Searching…', async () => {
    await api.refreshStatus();
    await loadPrinters();
  }),
);

$('scanNetwork').addEventListener('click', (e) =>
  busy(e.target, 'Scanning… (≈10s)', async () => {
    const res = await api.scanNetwork();
    if (!res.ok) return toast(res.error);
    networkFound = res.value;
    renderPrinters();
    toast(res.value.length ? `Found ${res.value.length} network printer(s).` : 'No network printers found on this network.');
  }),
);

$('useNetworkPrinter').addEventListener('click', (e) => {
  const host = $('printerHost').value.trim();
  const port = Number($('printerPort').value) || 9100;
  if (!/^[\w.-]+$/.test(host)) return toast('Enter the printer’s IP address, e.g. 192.168.1.100');
  return busy(e.target, 'Connecting…', async () => {
    const res = await api.usePrinter({ id: `net:${host}:${port}`, kind: 'network', label: host, host, port, installed: false, online: true });
    if (!res.ok) return toast(res.error);
    config = await api.getConfig();
    renderConfig();
    renderStatus(res.value);
  });
});

$('paperWidth').addEventListener('click', (e) => {
  const value = e.target.dataset?.value;
  if (value) saveConfig({ printer: { paperWidthChars: Number(value) } }, 'Paper size saved');
});

$('printerDriver').addEventListener('click', (e) => {
  const value = e.target.dataset?.value;
  if (value) saveConfig({ printer: { driver: value } }, 'Printer language saved');
});

$('turnOffPrinter').addEventListener('click', async () => {
  if (!confirm('Stop printing receipts? You can pick a printer again at any time.')) return;
  const res = await api.turnOffPrinter();
  config = await api.getConfig();
  renderConfig();
  if (res.ok) renderStatus(res.value);
});

$('terminalEnabled').addEventListener('change', async (e) => {
  await saveConfig({ terminal: { enabled: e.target.checked } }, e.target.checked ? 'Card terminal turned on' : 'Card terminal turned off');
  if (e.target.checked) await loadPorts();
});
$('serialPath').addEventListener('change', (e) => saveConfig({ terminal: { serialPath: e.target.value } }, 'Terminal port saved'));
$('refreshPorts').addEventListener('click', loadPorts);
$('showAllPorts').addEventListener('change', loadPorts);
$('baudRate').addEventListener('change', (e) => saveConfig({ terminal: { baudRate: Number(e.target.value) || 9600 } }));
$('responseTimeoutSec').addEventListener('change', (e) =>
  saveConfig({ terminal: { responseTimeoutMs: Math.max(5, Number(e.target.value) || 30) * 1000 } }),
);

$('testCharge').addEventListener('click', (e) =>
  busy(e.target, 'Waiting for terminal…', async () => {
    setResult('terminalResult', '');
    const res = await api.testTerminalCharge();
    if (!res.ok) return setResult('terminalResult', res.error, 'error');
    const r = res.value;
    const approved = r.status === 'approved';
    setResult('terminalResult', approved ? `✓ Approved${r.authCode ? ` (auth ${r.authCode})` : ''}` : `${r.status}: ${r.message ?? ''}`, approved ? 'ok' : 'error');
  }),
);

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const source = $(button.dataset.copy);
    await api.copy(source.value ?? source.textContent);
    toast('Copied');
  });
}

$('toggleToken').addEventListener('click', (e) => {
  const input = $('authToken');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  e.target.textContent = show ? 'Hide' : 'Show';
});

$('savePort').addEventListener('click', () => {
  const port = Number($('port').value);
  if (!(port >= 1024 && port <= 65535)) return toast('Port must be between 1024 and 65535');
  return saveConfig({ server: { port } }, `API moved to port ${port} — update your POS`);
});

$('regenToken').addEventListener('click', async () => {
  if (!confirm('Make a new token? Your POS will stop working until you paste the new token into it.')) return;
  await api.regenerateToken();
  config = await api.getConfig();
  renderConfig();
  toast('New token created — copy it into your POS');
});

$('launchAtLogin').addEventListener('change', (e) =>
  saveConfig({ app: { launchAtLogin: e.target.checked } }, e.target.checked ? 'Will start with the computer' : 'Won’t start with the computer'),
);
$('openLogs').addEventListener('click', () => api.openLogs());

api.onStatus(renderStatus);
api.onConfig((next) => {
  config = next;
  renderConfig();
});
api.onNotice(toast);

// ---------- start ----------

(async () => {
  config = await api.getConfig();
  renderConfig();
  renderStatus(await api.getStatus());
  if (config.terminal.enabled) await loadPorts();
})();
