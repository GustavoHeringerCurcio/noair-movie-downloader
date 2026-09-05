import type { TorrentState } from '../types';
import { STATE_COLORS } from '../types';

export function StateBadge({ state }: { state: TorrentState }) {
  const label = state.replace(/-/g, ' ');
  const spinning = state === 'downloading' || state === 'fetching-metadata';
  return (
    <span className={`state-badge state-${STATE_COLORS[state] ?? 'gray'}`} title={state}>
      <span aria-hidden="true" className={`state-dot ${spinning ? 'state-spin' : ''}`} />
      {label}
    </span>
  );
}
