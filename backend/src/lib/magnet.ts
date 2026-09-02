export const MAGNET_TRACKERS: readonly string[] = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://explodie.org:6969/announce',
];

export function buildMagnet(infoHash: string, title: string, trackers: readonly string[] = MAGNET_TRACKERS): string {
  const cleanHash = infoHash.trim().toLowerCase();
  const parts = [
    'magnet:?xt=urn:btih:' + encodeURIComponent(cleanHash),
    'dn=' + encodeURIComponent(title),
  ];
  for (const tracker of trackers) {
    parts.push('tr=' + encodeURIComponent(tracker));
  }
  return parts.join('&');
}

export function infoHashFromMagnet(magnet: string): string | null {
  const match = /xt=urn:btih:([a-fA-F0-9]{40})/.exec(magnet);
  return match?.[1]?.toLowerCase() ?? null;
}
