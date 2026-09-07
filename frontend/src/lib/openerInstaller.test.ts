import { describe, expect, it } from 'vitest';
import {
  PLAYER_CHOICES,
  buildLinuxInstallerSh,
  buildLinuxUninstallerSh,
  buildOpenerCmd,
  buildUninstallerCmd,
  markOpenerSetupDone,
  isOpenerSetupDone,
  normalizeMovieHandoffUrl,
  orderedPlayerIds,
  osFromUa,
  playerChoicesFor,
  readPlayerPreference,
  savePlayerPreference,
  PLAYER_PREF_KEY,
  SETUP_DONE_KEY,
} from './openerInstaller';

function decodeCmd(cmd: string): string {
  const marker = '-EncodedCommand ';
  const b64 = cmd.slice(cmd.indexOf(marker) + marker.length).trim();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    out += String.fromCharCode(bytes[i]! | (bytes[i + 1]! << 8));
  }
  return out;
}

describe('orderedPlayerIds', () => {
  it('puts the preferred player first and keeps a sensible fallback', () => {
    expect(orderedPlayerIds('mpv')[0]).toBe('mpv');
    expect(orderedPlayerIds('mpv')).toContain('vlc');
    expect(orderedPlayerIds(null)).toHaveLength(PLAYER_CHOICES.length);
    expect(orderedPlayerIds('bogus')[0]).toBe('vlc');
  });
});

describe('buildOpenerCmd', () => {
  it('produces a .cmd that registers movie:// via an encoded PowerShell payload', () => {
    const cmd = buildOpenerCmd('vlc');
    expect(cmd.startsWith('@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ')).toBe(true);

    const ps = decodeCmd(cmd);
    expect(ps).toContain('VideoLAN\\VLC\\vlc.exe');
    expect(ps).toContain('Software\\Classes\\movie\\shell\\open\\command');
    expect(ps).toContain('movie-open.ps1');
    expect(ps).toContain('-File "{1}" "%1"');
    expect(ps).toContain('Registered movie:// ->');
  });

  it('registers a PowerShell launcher (never cmd.exe) so the URL is not re-parsed', () => {
    const ps = decodeCmd(buildOpenerCmd('vlc'));
    expect(ps).toContain("$ps = Join-Path $PSHOME 'powershell.exe'");
    expect(ps).toContain('Start-Process -FilePath "__EXE__" -ArgumentList @($url)');
    expect(ps).not.toContain('movie-open.cmd');
  });

  it('prefers the chosen player when building the detection list', () => {
    const ps = decodeCmd(buildOpenerCmd('mpv'));
    const vlcPos = ps.indexOf('VideoLAN');
    const mpvPos = ps.indexOf('mpv.exe');
    expect(mpvPos).toBeGreaterThanOrEqual(0);
    expect(vlcPos).toBeGreaterThan(mpvPos);
  });
});

describe('buildUninstallerCmd', () => {
  it('removes the handler registry key and launchers', () => {
    const ps = decodeCmd(buildUninstallerCmd());
    expect(ps).toContain("Software\\Classes\\movie'");
    expect(ps).toContain('movie-open.ps1');
    expect(ps).toContain('movie-open.cmd'); // legacy cleanup
  });
});

describe('normalizeMovieHandoffUrl', () => {
  it('keeps the opaque movie:<url> shape the app now emits', () => {
    const url = 'movie:http://localhost:5173/api/stream/abc';
    expect(normalizeMovieHandoffUrl(url)).toBe('http://localhost:5173/api/stream/abc');
  });

  it('strips the legacy movie:// prefix', () => {
    expect(normalizeMovieHandoffUrl('movie://http://localhost:5173/api/stream/abc')).toBe(
      'http://localhost:5173/api/stream/abc',
    );
  });

  it('repairs the browser-canonicalized movie://http//… form (root cause)', () => {
    expect(normalizeMovieHandoffUrl('movie://http//localhost:5173/api/stream/abc')).toBe(
      'http://localhost:5173/api/stream/abc',
    );
    expect(normalizeMovieHandoffUrl('movie://https//host:8443/api/stream/abc')).toBe(
      'https://host:8443/api/stream/abc',
    );
  });

  it('preserves query strings and percent-encoding', () => {
    const href = 'movie:http://localhost:5173/api/stream/abc?file=Matrix%20(1999).mkv';
    expect(normalizeMovieHandoffUrl(href)).toBe('http://localhost:5173/api/stream/abc?file=Matrix%20(1999).mkv');
  });

  it('rejects anything that is not an http(s) URL', () => {
    expect(normalizeMovieHandoffUrl('movie:')).toBeNull();
    expect(normalizeMovieHandoffUrl('movie://')).toBeNull();
    expect(normalizeMovieHandoffUrl('not-a-url')).toBeNull();
  });
});

describe('buildLinuxInstallerSh', () => {
  it('produces a POSIX .sh that registers movie:// via a .desktop entry and xdg-mime', () => {
    const sh = buildLinuxInstallerSh('vlc');
    expect(sh.startsWith('#!/bin/sh')).toBe(true);
    expect(sh).toContain('movie-open.sh');
    expect(sh).toContain('Name=Movie Downloader player');
    expect(sh).toContain('MimeType=x-scheme-handler/movie;');
    expect(sh).toContain('xdg-mime default movie-downloader.desktop x-scheme-handler/movie');
    expect(sh).toContain('nohup __LAUNCHER__ "$url" >/dev/null 2>&1 &');
    expect(sh).toContain('probe "vlc" "VLC" "org.videolan.VLC"');
    expect(sh).toContain('probe "mpv" "MPV" "io.mpv.Mpv"');
  });

  it('writes a launcher that normalizes every movie: hand-off shape', () => {
    const sh = buildLinuxInstallerSh('vlc');
    expect(sh).toContain('movie:*) url=${url#movie:}');
    expect(sh).toContain('http//*) url="http://${url#http//}"');
    expect(sh).toContain('https//*) url="https://${url#https//}"');
    expect(sh).not.toContain('url=${1#movie://}');
  });

  it('quotes the Exec path and verifies the registration stuck', () => {
    const sh = buildLinuxInstallerSh('vlc');
    expect(sh).toContain('Exec="$dir/movie-open.sh" %u');
    expect(sh).toContain('xdg-mime query default x-scheme-handler/movie');
    expect(sh).toContain("grep -qs '^x-scheme-handler/movie=movie-downloader.desktop' \"$HOME/.config/mimeapps.list\"");
    expect(sh).toContain('echo "Verified: movie:// links now open $player_name."');
  });

  it('detects the chosen player first', () => {
    const sh = buildLinuxInstallerSh('mpv');
    const mpvPos = sh.indexOf('probe "mpv" "MPV" "io.mpv.Mpv"');
    const vlcPos = sh.indexOf('probe "vlc" "VLC" "org.videolan.VLC"');
    expect(mpvPos).toBeGreaterThanOrEqual(0);
    expect(vlcPos).toBeGreaterThan(mpvPos);
  });
});

describe('buildLinuxUninstallerSh', () => {
  it('removes the desktop entry, launcher dir and the mimeapps association', () => {
    const sh = buildLinuxUninstallerSh();
    expect(sh.startsWith('#!/bin/sh')).toBe(true);
    expect(sh).toContain('movie-downloader.desktop');
    expect(sh).toContain('movie-downloader');
    expect(sh).toContain('x-scheme-handler');
    expect(sh).toContain('Removed the movie:// handler.');
  });
});

describe('osFromUa / playerChoicesFor', () => {
  it('classifies desktop user agents', () => {
    expect(osFromUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120')).toBe('windows');
    expect(osFromUa('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120')).toBe('linux');
    expect(osFromUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1')).toBe('other');
    expect(osFromUa('Mozilla/5.0 (Linux; Android 13; Pixel 7) Chrome/120')).toBe('other');
  });

  it('offers only Linux-capable players on Linux and everything on Windows', () => {
    const linux = playerChoicesFor('linux').map((p) => p.id);
    expect(linux).toEqual(['vlc', 'mpv']);
    const windows = playerChoicesFor('windows');
    expect(windows).toHaveLength(PLAYER_CHOICES.length);
  });
});

describe('player preference (localStorage)', () => {
  it('round-trips only known player ids', () => {
    window.localStorage.clear();
    expect(readPlayerPreference()).toBeNull();
    savePlayerPreference('mpc-hc');
    expect(readPlayerPreference()).toBe('mpc-hc');
    window.localStorage.setItem(PLAYER_PREF_KEY, 'not-a-player');
    expect(readPlayerPreference()).toBeNull();
  });
});

describe('setup confirmation (localStorage)', () => {
  it('starts unconfirmed and flips only via markOpenerSetupDone', () => {
    window.localStorage.clear();
    expect(isOpenerSetupDone()).toBe(false);
    markOpenerSetupDone(true);
    expect(isOpenerSetupDone()).toBe(true);
    expect(window.localStorage.getItem(SETUP_DONE_KEY)).toBe('1');
    markOpenerSetupDone(false);
    expect(isOpenerSetupDone()).toBe(false);
  });
});
