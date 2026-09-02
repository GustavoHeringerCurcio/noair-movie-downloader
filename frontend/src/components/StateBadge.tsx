import type { TorrentState } from '../types';
import { STATE_COLORS } from '../types';

export function StateBadge({ state }: { state: TorrentState }) {
  const label = state.replace('-', ' ');
  return (
    <span className={`state-badge state-${STATE_COLORS[state] ?? 'gray'}`} title={state}>
      {label}
    </span>
  );
}
