import { describe, expect, it } from 'vitest';
import {
  PLAYER_CHOICES,
  buildOpenerCmd,
  buildUninstallerCmd,
  orderedPlayerIds,
  readPlayerPreference,
  savePlayerPreference,
  PLAYER_PREF_KEY,
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
    expect(ps).toContain('movie-open.cmd');
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
  it('removes the handler registry key and wrapper', () => {
    const ps = decodeCmd(buildUninstallerCmd());
    expect(ps).toContain("Software\\Classes\\movie'");
    expect(ps).toContain('movie-open.cmd');
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
