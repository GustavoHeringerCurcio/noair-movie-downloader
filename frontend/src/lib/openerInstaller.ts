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

const FALLBACK_ORDER: string[] = ['vlc', 'mpv', 'mpc-hc', 'potplayer'];

/** Ordered player ids: the user's preference first, then any other supported player. */
export function orderedPlayerIds(preferred: string | null): string[] {
  if (preferred && CANDIDATE_PATHS[preferred]) {
    return [preferred, ...FALLBACK_ORDER.filter((p) => p !== preferred)];
  }
  return [...FALLBACK_ORDER];
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

export function readPlayerPreference(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PLAYER_PREF_KEY);
    return raw && CANDIDATE_PATHS[raw] ? raw : null;
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
