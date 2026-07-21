const $ = (id) => document.getElementById(id);

function updatePrinterFieldVisibility() {
  const isUsb = $('printerConnectionType').value === 'usb';
  $('printerUsbFields').style.display = isUsb ? 'block' : 'none';
  $('printerNetworkFields').style.display = isUsb ? 'none' : 'block';
}

async function loadConfig() {
  const config = await window.bridge.getConfig();
  $('port').value = config.server.port;
  $('authToken').value = config.server.authToken;

  $('printerEnabled').checked = config.printer.enabled;
  $('printerConnectionType').value = config.printer.connectionType;
  $('printerHost').value = config.printer.network.host;
  $('printerPort').value = config.printer.network.port;
  $('paperWidthChars').value = config.printer.paperWidthChars;
  await refreshSystemPrinters(config.printer.usb.systemPrinterName);

  $('terminalEnabled').checked = config.terminal.enabled;
  $('baudRate').value = config.terminal.baudRate;
  $('responseTimeoutMs').value = config.terminal.responseTimeoutMs;
  await refreshSerialPorts(config.terminal.serialPath);

  updatePrinterFieldVisibility();
}

async function refreshSystemPrinters(selected) {
  const printers = await window.bridge.listSystemPrinters();
  const select = $('systemPrinterName');
  select.innerHTML = '';
  for (const p of printers) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    select.appendChild(opt);
  }
  if (selected) select.value = selected;
}

async function refreshSerialPorts(selected) {
  const ports = await window.bridge.listSerialPorts();
  const select = $('serialPath');
  select.innerHTML = '';
  for (const p of ports) {
    const opt = document.createElement('option');
    opt.value = p.path;
    opt.textContent = p.manufacturer ? `${p.path} (${p.manufacturer})` : p.path;
    select.appendChild(opt);
  }
  if (selected) select.value = selected;
}

$('printerConnectionType').addEventListener('change', updatePrinterFieldVisibility);
$('refreshPrinters').addEventListener('click', () => refreshSystemPrinters());
$('refreshPorts').addEventListener('click', () => refreshSerialPorts());

$('regenToken').addEventListener('click', async () => {
  $('authToken').value = await window.bridge.regenerateToken();
});

$('copyToken').addEventListener('click', () => {
  navigator.clipboard.writeText($('authToken').value);
});

$('saveSettings').addEventListener('click', async () => {
  await window.bridge.updateConfig({
    server: { port: Number($('port').value), authToken: $('authToken').value },
    printer: {
      enabled: $('printerEnabled').checked,
      connectionType: $('printerConnectionType').value,
      driver: 'epson',
      usb: { systemPrinterName: $('systemPrinterName').value },
      network: { host: $('printerHost').value, port: Number($('printerPort').value) },
      paperWidthChars: Number($('paperWidthChars').value),
    },
  });
  $('printResult').textContent = 'Saved.';
});

$('testPrint').addEventListener('click', async () => {
  $('printResult').textContent = 'Printing…';
  const result = await window.bridge.testPrint();
  $('printResult').textContent = result.ok ? 'Test page sent.' : `Failed: ${result.error}`;
});

$('saveTerminalSettings').addEventListener('click', async () => {
  await window.bridge.updateConfig({
    terminal: {
      enabled: $('terminalEnabled').checked,
      serialPath: $('serialPath').value,
      baudRate: Number($('baudRate').value),
      responseTimeoutMs: Number($('responseTimeoutMs').value),
    },
  });
  $('terminalResult').textContent = 'Saved.';
});

$('testCharge').addEventListener('click', async () => {
  $('terminalResult').textContent = 'Charging…';
  const result = await window.bridge.testTerminalCharge();
  $('terminalResult').textContent = JSON.stringify(result);
});

loadConfig();
