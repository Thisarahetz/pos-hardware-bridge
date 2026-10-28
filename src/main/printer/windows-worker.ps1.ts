/** PowerShell script run by the Windows printer worker. It stays running and
 * answers one JSON request per stdin line with one JSON response per stdout line.
 * Kept in a .ts file so it ships inside the app bundle without extra packaging. */
export const WINDOWS_WORKER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class PosRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }

  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);

  public static int Send(string printer, byte[] data, string docName) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      DOCINFO info = new DOCINFO();
      info.pDocName = docName;
      info.pDataType = "RAW";
      int job = StartDocPrinter(h, 1, info);
      if (job <= 0) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        StartPagePrinter(h);
        int written;
        if (!WritePrinter(h, data, data.Length, out written)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (written != data.Length) throw new Exception("Printer accepted only part of the receipt");
        EndPagePrinter(h);
      } finally {
        EndDocPrinter(h);
      }
      return job;
    } finally {
      ClosePrinter(h);
    }
  }
}
'@

# USB printers announce themselves under this device-interface class. "Port Number"
# maps to the spooler port (USB001…), and Control\Linked = 1 while plugged in.
$UsbPrintClass = 'SYSTEM\CurrentControlSet\Control\DeviceClasses\{28d78fad-5a12-11d1-ae5b-0000f803a8c2}'

function Get-UsbPorts {
  $result = @()
  $root = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($UsbPrintClass)
  if ($null -eq $root) { return ,$result }
  try {
    foreach ($name in $root.GetSubKeyNames()) {
      $params = $root.OpenSubKey("$name\#\Device Parameters")
      if ($null -eq $params) { continue }
      $num = $params.GetValue('Port Number')
      if ($null -eq $num) { $params.Close(); continue }
      $base = $params.GetValue('Base Name')
      if (-not $base) { $base = 'USB' }
      $label = [string]$params.GetValue('Port Description')
      $params.Close()
      $linked = $false
      $control = $root.OpenSubKey("$name\#\Control")
      if ($null -ne $control) { $linked = ($control.GetValue('Linked') -eq 1); $control.Close() }
      $result += [pscustomobject]@{ port = ('{0}{1:D3}' -f $base, [int]$num); label = $label; connected = $linked }
    }
  } finally { $root.Close() }
  return ,$result
}

function Get-State {
  $jobs = @{}
  foreach ($j in @(Get-CimInstance Win32_PrintJob -ErrorAction SilentlyContinue)) {
    $n = ([string]$j.Name -split ',')[0]
    $jobs[$n] = 1 + [int]$jobs[$n]
  }
  $tcp = @{}
  foreach ($p in @(Get-CimInstance Win32_TCPIPPrinterPort -ErrorAction SilentlyContinue)) {
    $tcp[$p.Name] = @{ host = $p.HostAddress; port = [int]$p.PortNumber }
  }
  $queues = @()
  $activeUsbPrinters = @{}
  foreach ($p in @(Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue)) {
    $t = $tcp[$p.PortName]
    $isOffline = [bool]$p.WorkOffline -or ([int]$p.ExtendedPrinterStatus -eq 7) -or (([int]$p.PrinterState -band 128) -ne 0)
    $isPaused = ((([int]$p.PrinterState) -band 1) -ne 0) -or ([int]$p.ExtendedPrinterStatus -eq 8)
    if (-not $isOffline -and -not $isPaused -and $p.PortName -match '^(USB\d+|ESDPRT|EPUSB)') {
      $activeUsbPrinters[$p.PortName] = $p.Name
    }
    $queues += [pscustomobject]@{
      name = $p.Name
      port = $p.PortName
      driver = $p.DriverName
      offline = $isOffline
      paused = $isPaused
      jobs = [int]$jobs[$p.Name]
      host = $(if ($t) { $t.host } else { $null })
      tcpPort = $(if ($t) { $t.port } else { $null })
    }
  }

  $usb = @(Get-UsbPorts)
  foreach ($port in $activeUsbPrinters.Keys) {
    $found = $false
    foreach ($u in $usb) {
      if ($u.port -eq $port) {
        $u.connected = $true
        if (-not $u.label) { $u.label = $activeUsbPrinters[$port] }
        $found = $true
        break
      }
    }
    if (-not $found) {
      $usb += [pscustomobject]@{ port = $port; label = $activeUsbPrinters[$port]; connected = $true }
    }
  }

  return @{ queues = $queues; usb = $usb }
}

function Find-Printer($name) {
  Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $name } | Select-Object -First 1
}

function Resume-Queue($name) {
  $p = Find-Printer $name
  if ($null -eq $p) { throw "Printer '$name' not found" }
  try {
    Set-Printer -Name $name -WorkOffline $false -ErrorAction SilentlyContinue
  } catch {}
  try {
    if ($p.WorkOffline) { Set-CimInstance -InputObject $p -Property @{ WorkOffline = $false } -ErrorAction SilentlyContinue }
  } catch {}
  try {
    Invoke-CimMethod -InputObject $p -MethodName Resume -ErrorAction SilentlyContinue | Out-Null
  } catch {}
}

function Clear-Queue($name) {
  Get-CimInstance Win32_PrintJob | Where-Object { ([string]$_.Name -split ',')[0] -eq $name } | Remove-CimInstance
}

function Install-Usb($port, $name) {
  $driver = 'Generic / Text Only'
  try {
    Add-PrinterDriver -Name $driver -ErrorAction SilentlyContinue
    Add-Printer -Name $name -DriverName $driver -PortName $port -ErrorAction Stop
  } catch {
    # Adding a printer usually needs admin rights: ask once through the normal Windows prompt.
    $cmd = "Add-PrinterDriver -Name '$driver' -ErrorAction SilentlyContinue; Add-Printer -Name '$name' -DriverName '$driver' -PortName '$port'"
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
    try {
      Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile', '-EncodedCommand', $enc | Out-Null
    } catch {
      throw 'Windows needs permission to add the printer. Click "Set up" again and choose Yes on the prompt.'
    }
    if ($null -eq (Find-Printer $name)) {
      throw 'Windows did not add the printer. Add it in Settings > Bluetooth & devices > Printers & scanners, then click "Search again".'
    }
  }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $res = @{ ok = $true }
  try {
    $req = $line | ConvertFrom-Json
    $res.id = $req.id
    switch ($req.cmd) {
      'ping'    { $res.value = 'pong' }
      'state'   { $res.value = Get-State }
      'print'   { $res.value = [PosRawPrint]::Send($req.printer, [Convert]::FromBase64String($req.data), $req.doc) }
      'resume'  { Resume-Queue $req.name }
      'clear'   { Clear-Queue $req.name }
      'install' { Install-Usb $req.port $req.name }
      default   { throw "Unknown command $($req.cmd)" }
    }
  } catch {
    $res.ok = $false
    $res.error = $_.Exception.Message
  }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
`;
