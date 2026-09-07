import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToastStore } from '../store/toastStore';
import { isOpenerSetupDone } from '../lib/openerInstaller';

interface Props {
  href: string;
  className?: string;
  title?: string;
  children: ReactNode;
}

/**
 * The "Player" action used across Watch / Downloads / Detail. A `movie:` link
 * can only work once the OS knows the handler (Settings → Local player), and a
 * web page has no API to detect that registration, so until the user confirms
 * the setup the action routes them to Settings with an explanation instead of
 * handing the link to the OS and failing silently inside the player.
 */
export function ExternalPlayerLink({ href, className, title, children }: Props) {
  const navigate = useNavigate();
  const toast = useToastStore((s) => s.toast);

  if (isOpenerSetupDone()) {
    return (
      <a className={className} href={href} title={title}>
        {children}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={className}
      title={title ?? 'Requires a one-time setup in Settings'}
      onClick={() => {
        toast('Local player is not set up yet — one command in Settings, then this button opens VLC/MPV.', 'info');
        navigate('/settings');
      }}
    >
      {children}
    </button>
  );
}
