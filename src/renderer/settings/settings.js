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

let lastStatus = null;

function renderSteps(listId, wrapId, steps) {
  const list = $(listId);
  list.replaceChildren(...steps.map((s) => el('li', {}, s)));
  $(wrapId).hidden = steps.length === 0;
}

function renderStatus(status) {
  lastStatus = status;
  renderPrinterCards();

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

// ---------- your printers ----------

const KIND_LABEL = { receipt: 'Receipt', document: 'A4 / A5 documents' };
const RECEIPT_WIDTHS = [
  ['32', '58 mm'],
  ['42', '80 mm'],
  ['48', '80 mm (wide)'],
];
const PAPER_SIZES = ['A4', 'A5', 'Letter', 'Legal'];
const openSettings = new Set();
let renderPending = false;

function segmented(options, current, onPick) {
  return el(
    'div',
    { class: 'segmented' },
    ...options.map(([value, label]) =>
      el('button', { class: String(current) === value ? 'active' : '', onclick: () => onPick(value) }, label),
    ),
  );
}

function option(label, hint, control) {
  return el('div', { class: 'option' }, el('div', {}, el('div', { class: 'option-label' }, label), hint ? el('div', { class: 'muted small' }, hint) : null), control);
}

async function changePrinter(id, patch, message = 'Saved') {
  const res = await api.updatePrinter(id, patch);
  if (!res.ok) return toast(res.error);
  config = res.value;
  if (patch.id && patch.id !== id) {
    openSettings.delete(id);
    openSettings.add(patch.id);
  }
  renderConfig();
  toast(message);
}

function printerSettings(p, isDefault) {
  const nameInput = el('input', { type: 'text', value: p.name });
  nameInput.addEventListener('change', () => nameInput.value.trim() && changePrinter(p.id, { name: nameInput.value.trim() }, 'Name saved'));
  const idInput = el('input', { type: 'text', value: p.id, spellcheck: 'false' });
  idInput.addEventListener('change', () => {
    if (!idInput.value.trim() || idInput.value.trim() === p.id) return;
    if (confirm(`Change the API name to "${idInput.value.trim()}"? POS apps that use "${p.id}" must be updated.`)) {
      changePrinter(p.id, { id: idInput.value.trim() }, 'API name changed');
    } else idInput.value = p.id;
  });

  const rows = [
    el('div', { class: 'grid2' }, el('label', {}, 'Name', nameInput), el('label', {}, 'API name (used by the POS)', idInput)),
  ];
  if (p.kind === 'receipt') {
    rows.push(
      option('Paper size', 'Run a test print — the number line should reach the right edge.', segmented(RECEIPT_WIDTHS, p.paperWidthChars, (v) => changePrinter(p.id, { paperWidthChars: Number(v) }, 'Paper size saved'))),
      option('Printer language', 'Most printers use ESC/POS. Choose Star only for Star Micronics printers.', segmented([['epson', 'ESC/POS'], ['star', 'Star']], p.language, (v) => changePrinter(p.id, { language: v }, 'Printer language saved'))),
      option(
        'Paper cutter',
        'Does this printer cut the paper by itself? Choose “No cutter” if the cashier tears receipts off by hand.',
        segmented([['full', 'Full cut'], ['partial', 'Partial cut'], ['none', 'No cutter']], p.cutter ?? 'full', (v) =>
          changePrinter(p.id, v === 'none' && (p.feedLines ?? 3) < 4 ? { cutter: v, feedLines: 4 } : { cutter: v }, 'Cutter setting saved'),
        ),
      ),
      option(
        'Extra paper at the end',
        p.cutter === 'none' ? 'Feeds the receipt past the tear bar so no text is torn off.' : 'Blank space after the last line, before the cut.',
        segmented([['1', 'Less'], ['3', 'Normal'], ['4', 'More'], ['6', 'Most']], String(p.feedLines ?? 3), (v) => changePrinter(p.id, { feedLines: Number(v) }, 'Saved')),
      ),
    );
  } else {
    rows.push(option('Paper size', 'Used when the POS doesn’t ask for a size.', segmented(PAPER_SIZES.map((x) => [x, x]), p.paperSize, (v) => changePrinter(p.id, { paperSize: v }, 'Paper size saved'))));
  }
  if (p.connection.type === 'system') {
    rows.push(
      option(
        'Used for',
        'Receipt = fast thermal printing. A4/A5 = invoices and documents through the normal printer driver.',
        segmented([['receipt', 'Receipts'], ['document', 'A4 / A5']], p.kind, (v) => changePrinter(p.id, { kind: v }, 'Printer type changed')),
      ),
    );
  }
  rows.push(
    el(
      'div',
      { class: 'row spaced' },
      isDefault
        ? el('span', { class: 'muted small' }, `Default ${p.kind === 'receipt' ? 'receipt' : 'document'} printer`)
        : el('button', { onclick: async () => {
            const res = await api.makeDefaultPrinter(p.id);
            if (!res.ok) return toast(res.error);
            config = res.value;
            renderConfig();
            toast(`${p.name} is now the default`);
          } }, 'Make default'),
      el('span', { class: 'grow' }),
      el('button', { class: 'link danger', onclick: async () => {
        if (!confirm(`Remove “${p.name}” from the bridge? The POS can no longer print to "${p.id}".`)) return;
        const res = await api.removePrinter(p.id);
        if (!res.ok) return toast(res.error);
        config = res.value;
        renderConfig();
        toast('Printer removed');
      } }, 'Remove printer'),
    ),
  );
  return el('div', { class: 'printer-settings' }, ...rows);
}

function renderPrinterCards() {
  const container = $('printerCards');
  // Don't redraw under the user's cursor while they type a name.
  if (container.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') {
    renderPending = true;
    return;
  }
  renderPending = false;
  const printers = config?.printers ?? [];
  $('printerCount').textContent = printers.length ? `${printers.length} printer${printers.length > 1 ? 's' : ''}` : '';

  if (printers.length === 0) {
    const s = lastStatus?.printer;
    container.replaceChildren(
      el(
        'div',
        { class: 'empty-state' },
        el('div', { class: 'option-label' }, s?.title ?? 'No printer set up'),
        el('ol', { class: 'steps-list' }, ...(s?.steps ?? []).map((x) => el('li', {}, x))),
      ),
    );
    return;
  }

  container.replaceChildren(
    ...printers.map((p, index) => {
      const status = lastStatus?.printers.find((x) => x.id === p.id) ?? { level: 'off', title: 'Checking…', detail: '', steps: [] };
      const isDefault = printers.findIndex((x) => x.kind === p.kind) === index;
      const width = RECEIPT_WIDTHS.find(([w]) => w === String(p.paperWidthChars))?.[1] ?? `${p.paperWidthChars} chars`;
      const detail = p.kind === 'receipt' ? `${width}${p.cutter === 'none' ? ' · no cutter' : ''}` : p.paperSize;
      const result = el('p', { class: 'result', role: 'status' });

      const fix =
        status.action === 'resume-queue' ? el('button', { class: 'primary', onclick: (e) => fixPrinter(e.target, p.id, 'resume-queue') }, 'Resume printing')
        : status.action === 'clear-queue' ? el('button', { onclick: (e) => fixPrinter(e.target, p.id, 'clear-queue') }, 'Clear waiting jobs')
        : null;

      return el(
        'div',
        { class: 'printer-card', 'data-level': status.level },
        el(
          'div',
          { class: 'printer-top' },
          el('span', { class: 'dot', 'aria-hidden': 'true' }),
          el(
            'div',
            { class: 'status-text' },
            el(
              'div',
              { class: 'printer-name' },
              p.name,
              el('span', { class: 'badges' }, el('span', { class: 'badge kind' }, `${KIND_LABEL[p.kind]} · ${detail}`), isDefault ? el('span', { class: 'badge' }, p.kind === 'receipt' ? 'Default for receipts' : 'Default for documents') : null),
            ),
            el('div', { class: 'small' }, el('strong', {}, status.title), status.detail ? ` — ${status.detail}` : ''),
            el('div', { class: 'muted small' }, 'API name: ', el('code', {}, p.id)),
          ),
          el(
            'div',
            { class: 'row tight' },
            el('button', {
              class: 'primary',
              onclick: (e) =>
                busy(e.target, 'Printing…', async () => {
                  const res = await api.testPrint(p.id);
                  result.textContent = res.ok ? '✓ Test page sent. Check the printer.' : res.error;
                  result.className = `result ${res.ok ? 'ok' : 'error'}`;
                }),
            }, 'Test print'),
            el('button', {
              class: 'ghost',
              'aria-expanded': String(openSettings.has(p.id)),
              onclick: () => {
                if (openSettings.has(p.id)) openSettings.delete(p.id);
                else openSettings.add(p.id);
                renderPrinterCards();
              },
            }, openSettings.has(p.id) ? 'Done' : 'Settings'),
          ),
        ),
        status.steps.length
          ? el('div', { class: 'steps' }, el('div', { class: 'steps-title' }, 'What to do'), el('ol', {}, ...status.steps.map((x) => el('li', {}, x))), fix ? el('div', { class: 'row' }, fix) : null)
          : null,
        result,
        openSettings.has(p.id) ? printerSettings(p, isDefault) : null,
      );
    }),
  );
}

$('printerCards').addEventListener('focusout', () => setTimeout(() => renderPending && renderPrinterCards(), 0));

async function fixPrinter(button, id, action) {
  const res = await busy(button, 'Working…', () => api.fixPrinter(id, action));
  if (res.ok) renderStatus(res.value);
  else toast(res.error);
}

// ---------- add a printer ----------

function alreadyAdded(found) {
  return (config?.printers ?? []).some((p) =>
    p.connection.type === 'system' ? found.queueName === p.connection.queueName : found.host === p.connection.host && !found.queueName,
  );
}

function describe(p) {
  const kind = p.kind === 'usb' ? 'USB' : p.kind === 'network' ? 'Network' : 'Installed printer';
  if (!p.online) return { sub: `${kind} · unplugged or off`, badge: ['Offline', 'error'] };
  if (!p.installed && p.kind === 'usb') return { sub: `${kind} · plugged in, not set up yet`, badge: ['New', ''] };
  return { sub: `${kind}${p.host ? ` · ${p.host}:${p.port}` : ''}${p.likelyReceiptPrinter ? ' · looks like a receipt printer' : ''}`, badge: null };
}

async function addFound(button, p, kind) {
  const res = await busy(button, p.installed || p.kind === 'network' ? 'Adding…' : 'Setting up…', () => api.addPrinter(p, { kind }));
  if (!res.ok) return toast(res.error);
  config = await api.getConfig();
  openSettings.add(res.value.id);
  renderConfig();
  renderStatus(await api.refreshStatus());
  toast(`Added “${res.value.name}” as API name "${res.value.id}". Try a test print.`);
}

function renderPrinters() {
  const list = $('printerList');
  const seen = new Set(discovered.map((p) => p.host).filter(Boolean));
  const all = [...discovered, ...networkFound.filter((p) => !seen.has(p.host))].filter((p) => !alreadyAdded(p));

  if (all.length === 0) {
    list.replaceChildren(
      el('li', { class: 'empty' }, (config?.printers.length ?? 0) > 0
        ? 'All printers found are already added. Plug in another printer and it will appear here.'
        : 'No printers found. Plug the printer in with USB and turn it on — it will appear here automatically.'),
    );
    return;
  }

  list.replaceChildren(
    ...all.map((p) => {
      const { sub, badge } = describe(p);
      const receiptFirst = p.likelyReceiptPrinter || (p.kind === 'network' && !p.queueName);
      const canDocument = Boolean(p.queueName || p.usbDeviceId);
      const receiptBtn = el('button', { class: receiptFirst ? 'primary' : '', onclick: (e) => addFound(e.target, p, 'receipt') }, 'Add as receipt printer');
      const docBtn = canDocument ? el('button', { class: receiptFirst ? '' : 'primary', onclick: (e) => addFound(e.target, p, 'document') }, 'Add as A4 printer') : null;
      return el(
        'li',
        {},
        el('span', { class: 'device-icon', 'aria-hidden': 'true' }, p.kind === 'network' ? '🌐' : p.kind === 'usb' ? '🔌' : '🖨️'),
        el('div', { class: 'device-main' }, el('div', { class: 'device-name' }, p.label), el('div', { class: 'device-sub' }, sub)),
        badge ? el('span', { class: `badge ${badge[1]}` }, badge[0]) : null,
        el('div', { class: 'add-buttons' }, ...(receiptFirst ? [receiptBtn, docBtn] : [docBtn, receiptBtn])),
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
  const receiptId = config.printers.find((p) => p.kind === 'receipt')?.id ?? 'receipt';
  const documentId = config.printers.find((p) => p.kind === 'document')?.id ?? 'invoice';
  return `// Print from your POS (browser or Node 18+).
// Money is in minor units: 12.50 → 1250.
const BRIDGE_URL = '${url}';
const BRIDGE_TOKEN = '${token}';

async function bridge(path, body) {
  const res = await fetch(BRIDGE_URL + path, {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${BRIDGE_TOKEN}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error + (data.details ? ': ' + data.details.join('; ') : ''));
  return data;
}

// 1. Receipt on the thermal printer ("printer" is optional: default receipt printer)
await bridge('/print/receipt', {
  printer: '\${receiptId}',
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
});

// 2. A4 invoice on the office printer: send any HTML page
await bridge('/print/document', {
  printer: '\${documentId}',
  paperSize: 'A4',
  title: 'Invoice INV-1042',
  html: '<h1>Invoice INV-1042</h1><p>Bill to: Jane Doe</p><table>…</table>',
});`;
}

function renderConfig() {
  const { server, terminal } = config;
  const url = `http://127.0.0.1:${server.port}`;
  $('apiUrl').value = url;
  $('authToken').value = server.authToken;
  $('port').value = server.port;
  $('snippet').textContent = snippet(url, server.authToken);


  $('launchAtLogin').checked = config.app?.launchAtLogin !== false;
  $('autoDetectPrinters').checked = config.app?.autoDetectPrinters !== false;
  $('terminalEnabled').checked = terminal.enabled;
  $('terminalFields').hidden = !terminal.enabled;
  $('baudRate').value = terminal.baudRate;
  $('responseTimeoutSec').value = Math.round(terminal.responseTimeoutMs / 1000);
  renderPrinterCards();
  renderPrinters();
}

// ---------- events ----------

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
  return addFound(e.target, { id: `net:${host}:${port}`, kind: 'network', label: `Network printer at ${host}`, host, port, installed: false, online: true }, 'receipt');
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
$('autoDetectPrinters').addEventListener('change', (e) =>
  saveConfig({ app: { autoDetectPrinters: e.target.checked } }, e.target.checked ? 'Receipt printers will be set up automatically' : 'Automatic setup turned off'),
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
