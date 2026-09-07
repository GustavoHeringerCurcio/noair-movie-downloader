export type SetupOs = 'windows' | 'linux' | 'other';

export interface PlayerChoice {
  id: string;
  label: string;
  hint: string;
  /** Official download page, opened in a new tab (the friendly "Get a player" path). */
  siteUrl: string;
  /** Shown as the gentle first recommendation for new users. */
  recommended?: boolean;
}

export const PLAYER_CHOICES: PlayerChoice[] = [
  {
    id: 'vlc',
    label: 'VLC',
    hint: 'Plays everything — the easiest choice for most people',
    siteUrl: 'https://www.videolan.org/vlc/',
    recommended: true,
  },
  {
    id: 'mpv',
    label: 'MPV',
    hint: 'Lightweight and scriptable, great playback quality',
    siteUrl: 'https://mpv.io/installation/',
  },
  {
    id: 'mpc-hc',
    label: 'MPC-HC',
    hint: 'Classic Windows player (also included in K-Lite Codec Pack)',
    siteUrl: 'https://github.com/clsid2/mpc-hc/releases',
  },
  {
    id: 'potplayer',
    label: 'PotPlayer',
    hint: 'Feature-rich Windows player',
    siteUrl: 'https://potplayer.daum.net/',
  },
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

/** The body of the PowerShell launcher the Windows installer writes to disk. */
const WINDOWS_LAUNCHER_BODY = [
  'param([string]$Uri)',
  'if (-not $Uri) { exit 1 }',
  // The OS hands this the full link (e.g. `movie:http://host/...`). Every
  // browser re-serializes a link through its URI parser first, so accept the
  // shapes that reach us and normalize back to a plain http(s):// URL.
  '$url = $Uri',
  '$url = $url -replace "^movie://", ""',
  '$url = $url -replace "^movie:", ""',
  'if ($url.StartsWith("//")) { $url = $url.Substring(2) }',
  // Older builds embedded the URL as movie://http://host/...; parsers read
  // "http" as the host and drop the colon (movie://http//host/...). Restore it.
  '$url = $url -replace "^http//", "http://"',
  '$url = $url -replace "^https//", "https://"',
  'if ($url -notmatch "^https?://") { exit 1 }',
  'Start-Process -FilePath "__EXE__" -ArgumentList @($url)',
];

/**
 * PowerShell source that locates a supported player (preference first), writes
 * a small PowerShell `movie://` launcher and registers it under HKCU as the
 * default handler for the `movie` scheme. The registered command runs
 * `powershell.exe -File` directly — never cmd.exe — so the stream URL travels
 * to the launcher verbatim (a cmd wrapper would re-interpret `%XX` in the URL).
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
  lines.push("Write-Host ('Found: ' + $exe) -ForegroundColor Cyan");
  lines.push("$dir = Join-Path $env:LOCALAPPDATA 'MovieDownloader'");
  lines.push('New-Item -ItemType Directory -Force -Path $dir | Out-Null');
  lines.push("$wrap = Join-Path $dir 'movie-open.ps1'");
  lines.push('$launcherLines = @(');
  for (const line of WINDOWS_LAUNCHER_BODY) {
    lines.push(`  '${line}'`);
  }
  lines.push(')');
  lines.push('$body = ([string]::Join([Environment]::NewLine, $launcherLines)).Replace(\'__EXE__\', $exe)');
  lines.push('Set-Content -Path $wrap -Value $body -Encoding ASCII');
  lines.push("$key = 'HKCU:\\Software\\Classes\\movie\\shell\\open\\command'");
  lines.push('New-Item -Path $key -Force | Out-Null');
  lines.push("$ps = Join-Path $PSHOME 'powershell.exe'");
  lines.push("$cmd = '\"{0}\" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{1}\" \"%1\"' -f $ps, $wrap");
  lines.push("Set-ItemProperty -Path $key -Name '(default)' -Value $cmd");
  lines.push("$check = (Get-ItemProperty -Path $key -Name '(default)' -ErrorAction SilentlyContinue).'(default)'");
  lines.push("if ($check) { Write-Host ('Registered movie:// -> ' + $exe) -ForegroundColor Green } else { Write-Host 'Registration check failed.' -ForegroundColor Red; exit 1 }");
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

/** A .cmd that removes the registered handler again (registry key + launchers). */
export function buildUninstallerCmd(): string {
  const lines: string[] = [];
  lines.push("$key = 'HKCU:\\Software\\Classes\\movie'");
  lines.push('Remove-Item -Path $key -Recurse -Force -ErrorAction SilentlyContinue');
  lines.push("$dir = Join-Path $env:LOCALAPPDATA 'MovieDownloader'");
  lines.push("Remove-Item -Path (Join-Path $dir 'movie-open.ps1') -Force -ErrorAction SilentlyContinue");
  // Legacy from installers before the .ps1 launcher.
  lines.push("Remove-Item -Path (Join-Path $dir 'movie-open.cmd') -Force -ErrorAction SilentlyContinue");
  lines.push("Write-Host 'Removed the movie:// handler.' -ForegroundColor Green");
  const script = lines.join('\n');
  const encoded = encodePsCommand(script);
  return `@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}\r\n`;
}

/**
 * A .sh the user runs on their Linux machine to register the `movie://` scheme.
 * Locates the chosen player first (falls back to the other Linux-supported one),
 * auto-detecting what is already installed (`command -v`, flatpak). Then writes
 * a `movie-open.sh` launcher + a `movie-downloader.desktop` entry and registers
 * it as the default `x-scheme-handler/movie` via `xdg-mime`, verifying the
 * registration stuck. Re-running it is harmless (it overwrites both files).
 */
export function buildLinuxInstallerSh(preferred: string | null): string {
  const ordered = orderedPlayerIds(preferred, LINUX_ORDER);
  const lines: string[] = [];
  lines.push('#!/bin/sh');
  lines.push('# noAir - one-time local-player setup (Linux).');
  lines.push('#');
  lines.push('# What this does (nothing hidden):');
  lines.push('#   1. finds an installed player (your pick first: VLC, MPV)');
  lines.push('#   2. writes a tiny launcher to ~/.local/share/movie-downloader/movie-open.sh');
  lines.push('#   3. registers ~/.local/share/applications/movie-downloader.desktop as the');
  lines.push('#      handler for movie:// links (xdg-mime x-scheme-handler/movie)');
  lines.push('#   4. verifies the registration and prints the result');
  lines.push('#');
  lines.push('# It writes only the two files above and never touches your downloads.');
  lines.push('# To undo: run the matching uninstaller, or:');
  lines.push('#   rm ~/.local/share/applications/movie-downloader.desktop ~/.local/share/movie-downloader/movie-open.sh');
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
  lines.push('echo "Found: $player_name ($launcher)"');
  lines.push('');
  lines.push('dir="$HOME/.local/share/movie-downloader"');
  lines.push('appdir="$HOME/.local/share/applications"');
  lines.push('mkdir -p "$dir"');
  lines.push('mkdir -p "$appdir"');
  lines.push('');
  lines.push('cat > "$dir/movie-open.sh" <<\'EOF\'');
  lines.push('#!/bin/sh');
  lines.push('# noAir movie:// launcher. The desktop runs this with the full link as $1.');
  lines.push('# Every browser re-serializes a link through its URI parser before handing');
  lines.push('# it to the OS, so accept the shapes that reach us and normalize to http(s)://.');
  lines.push('url=$1');
  lines.push('case "$url" in');
  lines.push('  movie://*) url=${url#movie://} ;;');
  lines.push('  movie:*) url=${url#movie:} ;;');
  lines.push('esac');
  lines.push('case "$url" in');
  lines.push('  //*) url=${url#//} ;;');
  lines.push('esac');
  lines.push('# Older builds embedded the stream URL as movie://http://host/...; URI parsers');
  lines.push('# read "http" as the host and drop the colon (movie://http//host/...). Restore it.');
  lines.push('case "$url" in');
  lines.push('  http//*) url="http://${url#http//}" ;;');
  lines.push('  https//*) url="https://${url#https//}" ;;');
  lines.push('esac');
  lines.push('case "$url" in');
  lines.push('  http://*|https://*) ;;');
  lines.push('  *) echo "movie-open: not an http(s) URL: $url" >&2; exit 1 ;;');
  lines.push('esac');
  lines.push('nohup __LAUNCHER__ "$url" >/dev/null 2>&1 &');
  lines.push('EOF');
  lines.push('launcher_escaped=$(printf \'%s\' "$launcher" | sed \'s/&/\\\\&/g\')');
  lines.push('sed -i "s|__LAUNCHER__|$launcher_escaped|" "$dir/movie-open.sh"');
  lines.push('chmod +x "$dir/movie-open.sh"');
  lines.push('');
  lines.push('desktop="$appdir/movie-downloader.desktop"');
  lines.push('cat > "$desktop" <<EOF');
  lines.push('[Desktop Entry]');
  lines.push('Type=Application');
  lines.push('Version=1.0');
  lines.push('Name=Movie Downloader player');
  lines.push('Comment=Open movie:// links from Movie Downloader');
  lines.push('Exec="$dir/movie-open.sh" %u');
  lines.push('Terminal=false');
  lines.push('NoDisplay=true');
  lines.push('MimeType=x-scheme-handler/movie;');
  lines.push('EOF');
  lines.push('chmod +x "$desktop"');
  lines.push('');
  lines.push('xdg-mime default movie-downloader.desktop x-scheme-handler/movie >/dev/null 2>&1 || echo "Could not set the default handler; pick Movie Downloader player for movie:// in your desktop settings." >&2');
  lines.push('if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$appdir" >/dev/null 2>&1 || true; fi');
  lines.push('');
  // The default handler association xdg-mime just wrote is the source of truth;
  // `xdg-mime query` can be unreliable (it resolves the .desktop through
  // `command -v`, which /bin/sh cannot do for absolute Exec paths), so accept
  // either signal.
  lines.push('registered=$(xdg-mime query default x-scheme-handler/movie 2>/dev/null || true)');
  lines.push('if [ "$registered" = "movie-downloader.desktop" ] || grep -qs \'^x-scheme-handler/movie=movie-downloader.desktop\' "$HOME/.config/mimeapps.list" 2>/dev/null; then');
  lines.push('  echo "Verified: movie:// links now open $player_name."');
  lines.push('else');
  lines.push('  echo "Note: could not confirm the handler is the default yet." >&2');
  lines.push('  echo "Check with: xdg-mime query default x-scheme-handler/movie" >&2');
  lines.push('  echo "On GNOME you may need to log out and back in once after a first install." >&2');
  lines.push('fi');
  lines.push('echo "Done. The Player buttons in the app now open files in $player_name."');
  lines.push('');
  return lines.join('\n');
}

/** A .sh that removes the registered handler again (launcher + desktop entry + mimeapps default). */
export function buildLinuxUninstallerSh(): string {
  const lines: string[] = [];
  lines.push('#!/bin/sh');
  lines.push('# noAir - remove the movie:// handler (Linux).');
  lines.push('# Deletes the launcher, the .desktop entry and the default association.');
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
  lines.push('remaining=$(xdg-mime query default x-scheme-handler/movie 2>/dev/null || true)');
  lines.push('if [ -z "$remaining" ] && ! grep -qs \'^x-scheme-handler/movie=\' "$HOME/.config/mimeapps.list" 2>/dev/null; then');
  lines.push('  echo "Removed the movie:// handler."');
  lines.push('else');
  lines.push('  echo "movie:// still resolves to ${remaining:-a handler} — remove it in your default-app settings." >&2');
  lines.push('fi');
  lines.push('');
  return lines.join('\n');
}

/** localStorage key: the user confirmed the movie:// handler is registered. */
export const SETUP_DONE_KEY = 'movie-downloader.opener-setup-done';

/** True once the user confirms in Settings that they ran the installer. */
export function isOpenerSetupDone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SETUP_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markOpenerSetupDone(done: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (done) window.localStorage.setItem(SETUP_DONE_KEY, '1');
    else window.localStorage.removeItem(SETUP_DONE_KEY);
  } catch {
    // storage may be unavailable (private mode) — the setup state is a hint.
  }
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

/**
 * Normalizes whatever string reaches a `movie` scheme handler into a plain
 * http(s):// URL (or null when it can't be one). Handles the shapes seen in
 * the wild: `movie:http://…`, `movie://http://…` and the browser-canonicalized
 * `movie://http//…` (the nested scheme's colon is dropped when the URI parser
 * reads `http` as the `movie` authority's host). The launchers emitted for
 * Linux (POSIX sh) and Windows (PowerShell) implement this exact logic inline,
 * so a change here must be mirrored there.
 */
export function normalizeMovieHandoffUrl(raw: string): string | null {
  let url = raw;
  if (url.startsWith('movie://')) url = url.slice('movie://'.length);
  else if (url.startsWith('movie:')) url = url.slice('movie:'.length);
  if (url.startsWith('//')) url = url.slice(2);
  if (url.startsWith('http//')) url = `http://${url.slice('http//'.length)}`;
  else if (url.startsWith('https//')) url = `https://${url.slice('https//'.length)}`;
  return url.startsWith('http://') || url.startsWith('https://') ? url : null;
}
