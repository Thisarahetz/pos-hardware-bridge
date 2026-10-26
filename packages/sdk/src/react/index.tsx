import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PrinterInfo } from '../client.js';
import {
  DEFAULT_ROLES,
  THIS_COMPUTER_URL,
  connectToBridge,
  isPrintingConfigured,
  isThisComputerUrl,
  loadPrintSettings,
  onPrintSettingsChange,
  pairDevice,
  printerFor,
  printTestPageFor,
  savePrintSettings,
  watchPrinterStatus,
} from '../pos.js';
import type { BridgeConnection, PrintRoleConfig, PrintSettings, PrinterStatusSummary, StorageOptions } from '../pos.js';

/**
 * React widgets for POS apps: <PrinterSettings /> for the settings page and
 * <PrinterStatusBadge /> for the POS header. Import from
 * 'pos-hardware-bridge/react'. Print with printFor() from 'pos-hardware-bridge'.
 */

// ---- Hooks ----

/** This device's printer settings, saved to localStorage and kept in sync across widgets and tabs. */
export function usePrintSettings(
  options: StorageOptions = {},
): [PrintSettings, (next: PrintSettings | ((current: PrintSettings) => PrintSettings)) => void] {
  const { storageKey, roles } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [settings, setSettings] = useState<PrintSettings>(() => loadPrintSettings(options));

  useEffect(
    () => onPrintSettingsChange(() => setSettings(loadPrintSettings(optionsRef.current)), { storageKey }),
    [storageKey],
  );

  const update = useCallback(
    (next: PrintSettings | ((current: PrintSettings) => PrintSettings)) => {
      setSettings((current) => {
        const value = typeof next === 'function' ? next(current) : next;
        savePrintSettings(value, { storageKey, roles });
        return value;
      });
    },
    [storageKey, roles],
  );
  return [settings, update];
}

/** Live printer status for the POS header: { light, text, steps }. */
export function usePrinterStatus(options: StorageOptions & { pollMs?: number } = {}): PrinterStatusSummary | null {
  const [settings] = usePrintSettings(options);
  const [summary, setSummary] = useState<PrinterStatusSummary | null>(null);
  const { storageKey, pollMs } = options;
  useEffect(
    () => watchPrinterStatus(setSummary, { storageKey, pollMs }),
    // Reconnect when this device is connected, re-paired or disconnected.
    [settings.url, settings.token, storageKey, pollMs],
  );
  return summary;
}

// ---- Styles ----

/** Override any of these on .phb (or a parent) to match your POS. */
const CSS = `
.phb{--phb-accent:#2563eb;--phb-accent-text:#fff;--phb-border:rgba(127,127,127,.35);--phb-muted:rgba(127,127,127,.95);--phb-radius:8px;--phb-ok:#16a34a;--phb-warning:#d97706;--phb-error:#dc2626;--phb-off:#9ca3af;font:inherit;color:inherit;display:grid;gap:16px;max-width:640px}
.phb *{box-sizing:border-box}
.phb h2{margin:0;font-size:1.25em}
.phb fieldset{border:1px solid var(--phb-border);border-radius:var(--phb-radius);padding:12px 16px 16px;margin:0;display:grid;gap:10px;min-width:0}
.phb fieldset:disabled{opacity:.6}
.phb legend{font-weight:600;padding:0 6px}
.phb p{margin:0}
.phb .phb-muted{color:var(--phb-muted);font-size:.9em}
.phb label.phb-check{display:flex;gap:8px;align-items:center;cursor:pointer}
.phb .phb-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.phb .phb-row>input,.phb .phb-row>select{flex:1 1 180px;min-width:0}
.phb input:not([type=radio]):not([type=checkbox]),.phb select{font:inherit;color:inherit;background:transparent;border:1px solid var(--phb-border);border-radius:calc(var(--phb-radius) - 2px);padding:8px 10px;min-height:38px}
.phb input[type=number]{width:80px;flex:none}
.phb button{font:inherit;border:1px solid var(--phb-border);background:transparent;color:inherit;border-radius:calc(var(--phb-radius) - 2px);padding:8px 14px;min-height:38px;cursor:pointer}
.phb button.phb-primary{background:var(--phb-accent);border-color:var(--phb-accent);color:var(--phb-accent-text)}
.phb button:disabled{opacity:.5;cursor:not-allowed}
.phb .phb-role{display:grid;grid-template-columns:minmax(120px,160px) 1fr auto;gap:8px;align-items:center}
.phb .phb-role select{width:100%;min-width:0}
@media (max-width:480px){.phb .phb-role{grid-template-columns:1fr auto}.phb .phb-role>span{grid-column:1/-1}}
.phb .phb-message{padding:8px 10px;border-radius:calc(var(--phb-radius) - 2px);border:1px solid var(--phb-border)}
.phb .phb-message[data-tone=error]{border-color:var(--phb-error)}
.phb .phb-message[data-tone=ok]{border-color:var(--phb-ok)}
.phb-badge{display:inline-flex;gap:8px;align-items:center;font:inherit;color:inherit;background:transparent;border:1px solid rgba(127,127,127,.35);border-radius:999px;padding:4px 12px;cursor:default;max-width:100%}
button.phb-badge{cursor:pointer}
.phb-badge span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.phb-dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--phb-off,#9ca3af)}
.phb-dot[data-light=ok]{background:var(--phb-ok,#16a34a)}
.phb-dot[data-light=warning]{background:var(--phb-warning,#d97706)}
.phb-dot[data-light=error]{background:var(--phb-error,#dc2626)}
`;

function Styles({ unstyled }: { unstyled?: boolean }) {
  return unstyled ? null : <style data-phb="">{CSS}</style>;
}

// ---- <PrinterSettings /> ----

export interface PrinterSettingsProps extends StorageOptions {
  /** Heading above the widget. Default "Printers"; null hides it. */
  title?: string | null;
  /** Show "Print automatically" and "Copies". Default true. */
  showOptions?: boolean;
  /** Leave out the built-in styles and style the phb-* classes yourself. */
  unstyled?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Called after connecting (also on open when already set up). */
  onConnected?: (connection: BridgeConnection) => void;
  /** Called after every saved change. */
  onChange?: (settings: PrintSettings) => void;
}

type Message = { tone: 'ok' | 'error' | 'info'; text: string } | null;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function printerLabel(p: PrinterInfo): string {
  if (p.ready) return p.name;
  return `${p.name} (${p.status?.title ?? 'not ready'})`;
}

/**
 * The "Printers" page for your POS settings: connect to the bridge (or pair a
 * tablet), choose a printer per role, test print, and set print options.
 */
export function PrinterSettings(props: PrinterSettingsProps) {
  const roles = props.roles ?? DEFAULT_ROLES;
  const storage = { storageKey: props.storageKey, roles };
  const [settings, save] = usePrintSettings(storage);
  const [connection, setConnection] = useState<BridgeConnection | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'this-computer' | 'pair'>(
    isThisComputerUrl(settings.url) ? 'this-computer' : 'pair',
  );
  const [token, setToken] = useState(isThisComputerUrl(settings.url) ? settings.token : '');
  const [address, setAddress] = useState(isThisComputerUrl(settings.url) ? '' : settings.url);
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [testing, setTesting] = useState<string | null>(null);

  const { onConnected, onChange } = props;
  const update = (next: PrintSettings) => {
    save(next);
    onChange?.(next);
  };

  const connect = async (url: string, accessToken: string, quiet = false) => {
    setBusy(true);
    if (!quiet) setMessage(null);
    try {
      const result = await connectToBridge(url, accessToken);
      setConnection(result);
      if (url !== settings.url || accessToken !== settings.token) update({ ...loadPrintSettings(storage), url, token: accessToken });
      setMessage({ tone: 'ok', text: `Connected to ${result.bridgeName}${result.kind === 'device' ? ' (this device is paired)' : ''}.` });
      onConnected?.(result);
    } catch (error) {
      setConnection(null);
      setMessage({ tone: 'error', text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const pair = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const paired = await pairDevice(address, code, deviceName);
      setCode('');
      await connect(paired.url, paired.token);
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error) });
      setBusy(false);
    }
  };

  const disconnect = () => {
    update({ ...settings, token: '' });
    setConnection(null);
    setToken('');
    setMessage({ tone: 'info', text: 'Disconnected. This device will not print until you connect again.' });
  };

  const testPrint = async (role: string) => {
    setTesting(role);
    const result = await printTestPageFor(role, storage);
    setTesting(null);
    if (result.ok) setMessage({ tone: 'ok', text: `Test page sent to ${result.printer}.` });
    else if ('message' in result) setMessage({ tone: 'error', text: result.message });
  };

  // Already set up: load the printer list when the page opens.
  useEffect(() => {
    if (isPrintingConfigured(settings)) void connect(settings.url, settings.token, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = connection !== null;

  return (
    <section className={['phb', props.className].filter(Boolean).join(' ')} style={props.style}>
      <Styles unstyled={props.unstyled} />
      {props.title !== null && <h2>{props.title ?? 'Printers'}</h2>}

      <fieldset disabled={busy}>
        <legend>1. Connect to POS Hardware Bridge</legend>
        <label className="phb-check">
          <input type="radio" name="phb-mode" checked={mode === 'this-computer'} onChange={() => setMode('this-computer')} />
          Printers are connected to this computer
        </label>
        <label className="phb-check">
          <input type="radio" name="phb-mode" checked={mode === 'pair'} onChange={() => setMode('pair')} />
          Printers are connected to another computer in the shop
        </label>

        {mode === 'this-computer' ? (
          <>
            <p className="phb-muted">
              In POS Hardware Bridge, open <b>Connect your POS</b> and copy the access token.
            </p>
            <div className="phb-row">
              <input
                type="password"
                aria-label="Access token"
                placeholder="Access token"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value.trim())}
              />
              <button className="phb-primary" disabled={!token} onClick={() => connect(THIS_COMPUTER_URL, token)}>
                Connect
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="phb-muted">
              On the printer computer, open <b>Connect your POS → Phones &amp; tablets</b>, turn on network access and
              click <b>Get a code</b>.
            </p>
            <div className="phb-row">
              <input
                aria-label="Bridge address"
                placeholder="Bridge address, e.g. http://192.168.1.20:9191"
                inputMode="url"
                value={address}
                onChange={(e) => setAddress(e.target.value.trim())}
              />
            </div>
            <div className="phb-row">
              <input
                aria-label="6-digit code"
                placeholder="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <input
                aria-label="Name for this device"
                placeholder="Name for this device, e.g. Till 2"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
              />
              <button className="phb-primary" disabled={!address || !code} onClick={pair}>
                Pair
              </button>
            </div>
          </>
        )}

        {message && (
          <p className="phb-message" role={message.tone === 'error' ? 'alert' : 'status'} data-tone={message.tone}>
            {message.text}
          </p>
        )}
        {connected && (
          <div className="phb-row">
            <button onClick={() => connect(settings.url, settings.token)}>Refresh printers</button>
            <button onClick={disconnect}>Disconnect</button>
          </div>
        )}
      </fieldset>

      {connected && (
        <fieldset>
          <legend>2. Choose printers</legend>
          {roles.map((role) => {
            const choice = printerFor(settings, role.id);
            const fits = connection.printers.filter((p) => p.kind === role.kind);
            return (
              <div className="phb-role" key={role.id}>
                <span>{role.label}</span>
                <select
                  aria-label={role.label}
                  value={choice === null ? 'none' : choice}
                  onChange={(e) =>
                    update({
                      ...settings,
                      printers: { ...settings.printers, [role.id]: e.target.value === 'none' ? null : e.target.value },
                    })
                  }
                >
                  <option value="">Default printer</option>
                  {fits.map((p) => (
                    <option key={p.id} value={p.id}>
                      {printerLabel(p)}
                    </option>
                  ))}
                  {choice && !fits.some((p) => p.id === choice) && <option value={choice}>{choice} (missing)</option>}
                  <option value="none">Don't print</option>
                </select>
                <button disabled={choice === null || testing !== null} onClick={() => testPrint(role.id)}>
                  {testing === role.id ? 'Printing…' : 'Test print'}
                </button>
              </div>
            );
          })}
          {connection.printers.length === 0 && (
            <p className="phb-muted">No printers yet. Add one in POS Hardware Bridge, then click Refresh printers.</p>
          )}
        </fieldset>
      )}

      {connected && props.showOptions !== false && (
        <fieldset>
          <legend>3. Options</legend>
          <label className="phb-check">
            <input
              type="checkbox"
              checked={settings.autoPrint}
              onChange={(e) => update({ ...settings, autoPrint: e.target.checked })}
            />
            Print the receipt automatically after each sale
          </label>
          <label className="phb-check">
            Copies
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

// ---- <PrinterStatusBadge /> ----

export interface PrinterStatusBadgeProps extends StorageOptions {
  /** Make it a button, e.g. to open the Printers settings. */
  onClick?: () => void;
  /** Safety-net check, in ms. Default 10000. */
  pollMs?: number;
  unstyled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** A coloured dot and one line for the POS header: "Printers ready", "Kitchen: Out of paper"… */
export function PrinterStatusBadge(props: PrinterStatusBadgeProps) {
  const summary = usePrinterStatus(props);
  const light = summary?.light ?? 'off';
  const text = summary?.text ?? 'Checking printers…';
  const hint = summary?.steps.length ? `${text}\n${summary.steps.join('\n')}` : text;
  const className = ['phb-badge', props.className].filter(Boolean).join(' ');
  const content = (
    <>
      <Styles unstyled={props.unstyled} />
      <span className="phb-dot" data-light={light} aria-hidden="true" />
      <span>{text}</span>
    </>
  );
  return props.onClick ? (
    <button type="button" className={className} style={props.style} title={hint} data-light={light} onClick={props.onClick}>
      {content}
    </button>
  ) : (
    <span className={className} style={props.style} title={hint} data-light={light} role="status">
      {content}
    </span>
  );
}

export type { BridgeConnection, PrintRoleConfig, PrintSettings, PrinterStatusSummary } from '../pos.js';
