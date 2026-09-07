import type { ReactNode } from 'react';
import { useToastStore } from '../store/toastStore';
import { isOpenerSetupDone } from '../lib/openerInstaller';

interface Props {
  href: string;
  className?: string;
  title?: string;
  children: ReactNode;
}

/**
 * The "Player" action used across Watch / Downloads / Detail. It is always a
 * plain `movie:` link that hands the video to the OS handler (the user's local
 * player) — it never blocks, never routes to Settings, and never requires a
 * prior "I ran the installer" confirmation.
 *
 * A web page has no API to detect whether the handler is registered, so until
 * the user has told us it is set up (Settings → Local player), a click also
 * shows a short, dismissible hint in case nothing opened. Once confirmed the
 * hint disappears and the click is a silent, direct hand-off.
 */
export function ExternalPlayerLink({ href, className, title, children }: Props) {
  const toast = useToastStore((s) => s.toast);

  return (
    <a
      className={className}
      href={href}
      title={title ?? 'Opens this file in your local player (VLC, MPV, …)'}
      onClick={() => {
        if (isOpenerSetupDone()) return;
        toast('Your player didn’t open? Connect it once — Settings → Local player.', 'info');
      }}
    >
      {children}
    </a>
  );
}
