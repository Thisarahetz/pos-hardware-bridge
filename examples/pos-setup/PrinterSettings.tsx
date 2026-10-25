// PrinterSettings.tsx: the "Printers" page in your POS settings.
import { useEffect, useState } from 'react';
import type { PrinterInfo } from 'pos-hardware-bridge';
import {
  type Connection,
  type PrintRole,
  type PrintSettings,
  loadSettings,
  pairThisDevice,
  printTestPage,
  saveSettings,
  testConnection,
} from './printing';

const ROLES: Array<{ role: PrintRole; label: string; kind: PrinterInfo['kind'] }> = [
  { role: 'receipt', label: 'Customer receipts', kind: 'receipt' },
  { role: 'kitchen', label: 'Kitchen tickets', kind: 'receipt' },
  { role: 'invoice', label: 'A4 invoices', kind: 'document' },
];

export function PrinterSettings() {
  const [settings, setSettings] = useState<PrintSettings>(loadSettings);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'this-computer' | 'pair'>(
    settings.url.includes('127.0.0.1') || settings.url.includes('localhost') ? 'this-computer' : 'pair',
  );
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');

  const update = (next: PrintSettings) => {
    setSettings(next);
    saveSettings(next);
  };

  const connect = async (url: string, token: string) => {
    setBusy(true);
    setMessage('');
    try {
      const result = await testConnection(url, token);
      setConnection(result);
      update({ ...settings, url, token });
      setMessage(`Connected to ${result.bridgeName}.`);
    } catch (error) {
      setConnection(null);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const pair = async () => {
    setBusy(true);
    setMessage('');
    try {
      const { url, token } = await pairThisDevice(settings.url, code, deviceName || 'POS device');
      setCode('');
      await connect(url, token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  // Already set up: load the printer list when the page opens.
  useEffect(() => {
    if (settings.token) void connect(settings.url, settings.token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section>
      <h2>Printers</h2>

      {/* Step 1: connect */}
      <fieldset disabled={busy}>
        <legend>1. Connect to POS Hardware Bridge</legend>
        <label>
          <input type="radio" checked={mode === 'this-computer'} onChange={() => setMode('this-computer')} />
          Printers are connected to this computer
        </label>
        <label>
          <input
            type="radio"
            checked={mode === 'pair'}
            onChange={() => {
              setMode('pair');
              setSettings({ ...settings, url: '' }); // the shop address, typed below
            }}
          />
          Printers are connected to another computer in the shop
        </label>

        {mode === 'this-computer' ? (
          <>
            <p>In the bridge, open <b>Connect your POS</b> and copy the access token.</p>
            <input
              type="password"
              placeholder="Access token"
              value={settings.token}
              onChange={(e) => setSettings({ ...settings, url: 'http://127.0.0.1:9191', token: e.target.value.trim() })}
            />
            <button onClick={() => connect('http://127.0.0.1:9191', settings.token)}>Connect</button>
          </>
        ) : (
          <>
            <p>
              On the printer computer, open <b>Connect your POS → Phones &amp; tablets</b>, turn on network
              access and click <b>Get a code</b>.
            </p>
            <input
              placeholder="Bridge address, e.g. http://192.168.1.20:9191"
              value={settings.url}
              onChange={(e) => setSettings({ ...settings, url: e.target.value.trim() })}
            />
            <input placeholder="6-digit code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
            <input placeholder="Name for this device, e.g. Till 2" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
            <button onClick={pair} disabled={!code}>Pair</button>
          </>
        )}
        {message && <p role="status">{message}</p>}
      </fieldset>

      {/* Step 2: choose printers */}
      {connection && (
        <fieldset>
          <legend>2. Choose printers</legend>
          {ROLES.map(({ role, label, kind }) => (
            <div key={role}>
              <label>
                {label}{' '}
                <select
                  value={settings.printers[role] ?? 'none'}
                  onChange={(e) =>
                    update({
                      ...settings,
                      printers: { ...settings.printers, [role]: e.target.value === 'none' ? null : e.target.value },
                    })
                  }
                >
                  <option value="">Default printer</option>
                  {connection.printers
                    .filter((p) => p.kind === kind)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.ready ? '' : '(not ready)'}
                      </option>
                    ))}
                  <option value="none">Don't print</option>
                </select>
              </label>
              <button
                disabled={settings.printers[role] === null}
                onClick={async () => {
                  const result = await printTestPage(role);
                  setMessage(result.ok ? `Test page sent to ${result.printer}.` : 'message' in result ? result.message : '');
                }}
              >
                Test print
              </button>
            </div>
          ))}
          {connection.printers.length === 0 && <p>No printers yet: add one in the bridge, then reopen this page.</p>}
        </fieldset>
      )}

      {/* Step 3: options */}
      {connection && (
        <fieldset>
          <legend>3. Options</legend>
          <label>
            <input
              type="checkbox"
              checked={settings.autoPrint}
              onChange={(e) => update({ ...settings, autoPrint: e.target.checked })}
            />
            Print the receipt automatically after each sale
          </label>
          <label>
            Copies{' '}
            <input
              type="number"
              min={1}
              max={5}
              value={settings.copies}
              onChange={(e) => update({ ...settings, copies: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </label>
        </fieldset>
      )}
    </section>
  );
}
