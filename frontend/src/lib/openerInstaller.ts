export type SetupOs = 'windows' | 'linux' | 'other';

export interface PlayerChoice {
  id: string;
  label: string;
  hint: string;
}

export const PLAYER_CHOICES: PlayerChoice[] = [
  { id: 'vlc', label: 'VLC', hint: 'The most common choice — plays everything' },
  { id: 'mpv', label: 'MPV', hint: 'Minimal, scriptable, great playback quality' },
  { id: 'mpc-hc', label: 'MPC-HC', hint: 'Classic Windows player (incl. K-Lite Codec Pack)' },
  { id: 'potplayer', label: 'PotPlayer', hint: 'Feature-rich Windows player' },
];

export const DEFAULT_PLAYER_ORDER: string[] = PLAYER_CHOICES.map((p) => p.id);

export const PLAYER_PREF_KEY = 'movie-downloader.player';

/** Which OSes each player id makes sense on. MPC-HC/PotPlayer are Windows-only. */
const PLAYER_OS: Record<string, SetupOs[]> = {
  vlc: ['windows', 'linux'],
  mpv: ['windows', 'linux'],
  'mpc-hc': ['windows'],
  potplayer: ['windows'],
};

/** Ordering Linux auto-detection tries players in (fallback when no preference). */
const LINUX_ORDER: string[] = PLAYER_CHOICES.filter((p) => (PLAYER_OS[p.id] ?? []).includes('linux')).map(
  (p) => p.id,
);

/** Per-player info the generated Linux installer needs to locate + name the app. */
const LINUX_PLAYERS: Record<string, { name: string; cmd: string; flatpak: string }> = {
  vlc: { name: 'VLC', cmd: 'vlc', flatpak: 'org.videolan.VLC' },
  mpv: { name: 'MPV', cmd: 'mpv', flatpak: 'io.mpv.Mpv' },
};

/** Windows install paths probed by the PowerShell installer, per player id. */
const CANDIDATE_PATHS: Record<string, string[]> = {
  vlc: [
    '$env:ProgramFiles\\VideoLAN\\VLC\\vlc.exe',
    '$env:ProgramFiles(x86)\\VideoLAN\\VLC\\vlc.exe',
    '$env:LOCALAPPDATA\\Programs\\VideoLAN\\VLC\\vlc.exe',
  ],
  mpv: [
    '$env:LOCALAPPDATA\\Microsoft\\WinGet\\Links\\mpv.exe',
    '$env:ProgramFiles\\mpv\\mpv.exe',
    '$env:ProgramFiles\\mpv.net\\mpv.exe',
    '$env:USERPROFILE\\scoop\\shims\\mpv.exe',
    'C:\\ProgramData\\chocolatey\\bin\\mpv.exe',
  ],
  'mpc-hc': [
    '$env:ProgramFiles\\MPC-HC\\mpc-hc64.exe',
    '$env:ProgramFiles(x86)\\MPC-HC\\mpc-hc.exe',
    '$env:ProgramFiles\\K-Lite Codec Pack\\Media Player Classic\\mpc-hc64.exe',
    '$env:ProgramFiles(x86)\\K-Lite Codec Pack\\Media Player Classic\\mpc-hc64.exe',
  ],
  potplayer: [
    '$env:ProgramFiles(x86)\\DAUM\\PotPlayer\\PotPlayerMini64.exe',
    '$env:ProgramFiles\\DAUM\\PotPlayer\\PotPlayerMini64.exe',
  ],
};

/** Pure UA → OS mapping (Windows first; phones/tablets/mac are not setup targets). */
export function osFromUa(ua: string): SetupOs {
  const s = ua.toLowerCase();
  if (s.includes('windows') || s.includes('win64') || s.includes('win32')) return 'windows';
  if (s.includes('android') || s.includes('iphone') || s.includes('ipad') || s.includes('ipod')) return 'other';
  if (s.includes('linux') || s.includes('x11')) return 'linux';
  return 'other';
}

/** The OS this browser is running on (fallback: 'other'). */
export function detectOs(): SetupOs {
  if (typeof navigator === 'undefined') return 'other';
  return osFromUa(navigator.userAgent);
}

/** Player choices a setup flow can offer on a given OS (Windows-only players hidden elsewhere). */
export function playerChoicesFor(os: SetupOs): PlayerChoice[] {
  if (os === 'linux') {
    const linux = LINUX_ORDER;
    return PLAYER_CHOICES.filter((p) => linux.includes(p.id));
  }
  return [...PLAYER_CHOICES];
}

/** Ordered player ids: the user's preference first, then the rest of `supported`. */
export function orderedPlayerIds(preferred: string | null, supported: string[] = DEFAULT_PLAYER_ORDER): string[] {
  if (preferred && supported.includes(preferred)) {
    return [preferred, ...supported.filter((p) => p !== preferred)];
  }
  return [...supported];
}

/**
 * PowerShell source that locates a supported player (preference first), writes
 * a small `movie://` wrapper and registers it under HKCU. Avoids backtick
 * escapes by building the wrapper from an array of plain batch lines.
 */
function powershellScript(ordered: string[]): string {
  const lines: string[] = [];
  lines.push("$ErrorActionPreference = 'SilentlyContinue'");
  lines.push('$candidates = @(');
  for (const id of ordered) {
    for (const exe of CANDIDATE_PATHS[id] ?? []) {
      lines.push(`  @{ name = '${id}'; exe = '${exe}' }`);
    }
  }
  lines.push(')');
  lines.push('$exe = $null');
  lines.push('foreach ($c in $candidates) { if (Test-Path -LiteralPath $c.exe) { $exe = $c.exe; break } }');
  lines.push("if (-not $exe) { Write-Host 'No supported player found. Install one of: VLC / MPV / MPC-HC / PotPlayer, then run this again.' -ForegroundColor Red; exit 1 }");
  lines.push("$dir = Join-Path $env:LOCALAPPDATA 'MovieDownloader'");
  lines.push('New-Item -ItemType Directory -Force -Path $dir | Out-Null');
  lines.push("$wrap = Join-Path $dir 'movie-open.cmd'");
  lines.push("$batch = @( '@echo off', 'set \"arg=%1\"', 'set \"arg=%arg:*movie://=%\"', 'start \"\" \"__EXE__\" \"%arg%\"' )");
  lines.push('$body = ([string]::Join([Environment]::NewLine, $batch)).Replace(\'__EXE__\', $exe)');
  lines.push('Set-Content -Path $wrap -Value $body -Encoding ASCII');
  lines.push("$key = 'HKCU:\\Software\\Classes\\movie\\shell\\open\\command'");
  lines.push('New-Item -Path $key -Force | Out-Null');
  lines.push('$regValue = \'"\' + $wrap + \'" "%1"\'');
  lines.push("Set-ItemProperty -Path $key -Name '(default)' -Value $regValue");
  lines.push('Write-Host ("Registered movie:// -> " + $exe) -ForegroundColor Green');
  lines.push('Write-Host \'Done. The "Player" buttons in the app now open files in your local player.\'');
  return lines.join('\n');
}

/** Encode a PowerShell command for -EncodedCommand (UTF-16LE, base64). */
function encodePsCommand(source: string): string {
  const bytes = new Uint8Array(source.length * 2);
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    bytes[i * 2] = code & 0xff;
    bytes[i * 2 + 1] = (code >> 8) & 0xff;
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** A .cmd the user runs on their machine to register the `movie://` handler. */
export function buildOpenerCmd(preferred: string | null): string {
  const script = powershellScript(orderedPlayerIds(preferred));
  const encoded = encodePsCommand(script);
  return `@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}\r\n`;
}

/** A .cmd that removes the registered handler again (registry key + wrapper). */
export function buildUninstallerCmd(): string {
  const lines: string[] = [];
  lines.push("$key = 'HKCU:\\Software\\Classes\\movie'");
  lines.push('Remove-Item -Path $key -Recurse -Force -ErrorAction SilentlyContinue');
  lines.push("$wrap = Join-Path $env:LOCALAPPDATA 'MovieDownloader'");
  lines.push('Remove-Item -Path (Join-Path $wrap \'movie-open.cmd\') -Force -ErrorAction SilentlyContinue');
  lines.push("Write-Host 'Removed the movie:// handler.' -ForegroundColor Green");
  const script = lines.join('\n');
  const encoded = encodePsCommand(script);
  return `@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}\r\n`;
}

/**
 * A .sh the user runs on their Linux machine to register the `movie://` scheme.
 * Locates the chosen player first (falls back to the other Linux-supported one),
 * auto-detecting what is already installed (`command -v`, snap-on-PATH, flatpak).
 * Then writes a `movie-open.sh` wrapper + a `movie-downloader.desktop` entry and
 * registers it as the default `x-scheme-handler/movie` via `xdg-mime`.
 */
export function buildLinuxInstallerSh(preferred: string | null): string {
  const ordered = orderedPlayerIds(preferred, LINUX_ORDER);
  const lines: string[] = [];
  lines.push('#!/bin/sh');
  lines.push('# Movie Downloader - one-time local-player setup (Linux).');
  lines.push('# Registers the movie:// scheme so the "Player" buttons open files');
  lines.push('# in your installed media player. Requires xdg-utils (Ubuntu ships it).');
  lines.push('set -u');
  lines.push('');
  lines.push('launcher=');
  lines.push('player_name=');
  lines.push('');
  lines.push('probe() {');
  lines.push('  [ -n "$launcher" ] && return 0');
  lines.push('  bin=$(command -v "$1" 2>/dev/null || true)');
  lines.push('  if [ -n "$bin" ]; then');
  lines.push('    launcher="$bin"');
  lines.push('    player_name="$2"');
  lines.push('    return 0');
  lines.push('  fi');
  lines.push('  if [ "$#" -ge 3 ] && command -v flatpak >/dev/null 2>&1 && flatpak info "$3" >/dev/null 2>&1; then');
  lines.push('    launcher="flatpak run $3"');
  lines.push('    player_name="$2"');
  lines.push('  fi');
  lines.push('}');
  lines.push('');
  for (const id of ordered) {
    const p = LINUX_PLAYERS[id];
    if (p) lines.push(`probe "${p.cmd}" "${p.name}" "${p.flatpak}"`);
  }
  lines.push('');
  lines.push('if [ -z "$launcher" ]; then');
  lines.push('  echo "No supported player found. Install VLC or MPV, then run this again." >&2');
  lines.push('  exit 1');
  lines.push('fi');
  lines.push('');
  lines.push('echo "Using $player_name ($launcher)"');
  lines.push('');
  lines.push('dir="$HOME/.local/share/movie-downloader"');
  lines.push('appdir="$HOME/.local/share/applications"');
  lines.push('mkdir -p "$dir"');
  lines.push('mkdir -p "$appdir"');
  lines.push('');
  lines.push('cat > "$dir/movie-open.sh" <<\'EOF\'');
  lines.push('#!/bin/sh');
  lines.push('url=${1#movie://}');
  lines.push('[ -n "$url" ] || exit 1');
  lines.push('nohup __LAUNCHER__ "$url" >/dev/null 2>&1 &');
  lines.push('EOF');
  lines.push('sed -i "s|__LAUNCHER__|$launcher|" "$dir/movie-open.sh"');
  lines.push('chmod +x "$dir/movie-open.sh"');
  lines.push('');
  lines.push('desktop="$appdir/movie-downloader.desktop"');
  lines.push('cat > "$desktop" <<EOF');
  lines.push('[Desktop Entry]');
  lines.push('Type=Application');
  lines.push('Version=1.0');
  lines.push('Name=Movie Downloader player');
  lines.push('Comment=Open movie:// links from Movie Downloader');
  lines.push('Exec=$dir/movie-open.sh %u');
  lines.push('Terminal=false');
  lines.push('NoDisplay=true');
  lines.push('MimeType=x-scheme-handler/movie;');
  lines.push('EOF');
  lines.push('');
  lines.push('xdg-mime default movie-downloader.desktop x-scheme-handler/movie >/dev/null 2>&1 || echo "Could not set the default handler; pick Movie Downloader player for movie:// in your desktop settings." >&2');
  lines.push('if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$appdir" >/dev/null 2>&1 || true; fi');
  lines.push('');
  lines.push('echo "Registered movie:// -> $player_name ($launcher)"');
  lines.push('echo "Done. The Player buttons in the app now open files in your local player."');
  lines.push('');
  return lines.join('\n');
}

/** A .sh that removes the registered handler again (wrapper + desktop entry + mimeapps default). */
export function buildLinuxUninstallerSh(): string {
  const lines: string[] = [];
  lines.push('#!/bin/sh');
  lines.push('# Movie Downloader - remove the movie:// handler (Linux).');
  lines.push('set -u');
  lines.push('');
  lines.push('appdir="$HOME/.local/share/applications"');
  lines.push('dir="$HOME/.local/share/movie-downloader"');
  lines.push('mimeapps="$HOME/.config/mimeapps.list"');
  lines.push('');
  lines.push('rm -f "$appdir/movie-downloader.desktop"');
  lines.push('rm -rf "$dir"');
  lines.push("if [ -f \"$mimeapps\" ]; then sed -i '/x-scheme-handler\\/movie=/d' \"$mimeapps\"; fi");
  lines.push('if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$appdir" >/dev/null 2>&1 || true; fi');
  lines.push('');
  lines.push("echo 'Removed the movie:// handler.'");
  lines.push('');
  return lines.join('\n');
}

export function readPlayerPreference(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PLAYER_PREF_KEY);
    return raw && PLAYER_CHOICES.some((p) => p.id === raw) ? raw : null;
  } catch {
    return null;
  }
}

export function savePlayerPreference(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PLAYER_PREF_KEY, id);
  } catch {
    // storage may be unavailable (private mode) — the setting is just a hint.
  }
}
