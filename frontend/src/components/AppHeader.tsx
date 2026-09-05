import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Search, Settings, Menu, X, Download } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { useDownloadsStore } from '../store/downloadsStore';
import { useSearchStore } from '../store/searchStore';

export function AppHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const downloads = useDownloadsStore((s) => s.downloads);
  const connected = useDownloadsStore((s) => s.connected);
  const setSearchOpen = useSearchStore((s) => s.openSet);

  useEffect(() => {
    const onScroll = (): void => {
      const next = window.scrollY > 8;
      setScrolled((prev) => (prev === next ? prev : next));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const needsScrim =
    !scrolled && (pathname === '/' || pathname.startsWith('/media/'));
  const className = ['app-header', scrolled ? 'scrolled' : '', needsScrim ? 'scrim' : '']
    .filter(Boolean)
    .join(' ');

  const navItem = (to: string, label: string): JSX.Element => (
    <NavLink to={to} end={to === '/'}>
      {label}
    </NavLink>
  );

  return (
    <header className={className}>
      <div className="header-inner">
        <BrandMark />
        <nav className="header-nav" aria-label="Primary">
          {navItem('/', 'Home')}
          {navItem('/downloads', 'Downloads')}
          {navItem('/settings', 'Settings')}
        </nav>
        <div className="header-spacer" />
        <div className="header-right">
          <button
            type="button"
            className="icon-btn"
            aria-label="Open search"
            title="Search (/)"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={22} />
          </button>
          <NavLink to="/downloads" className="icon-btn" aria-label="Downloads" title="Downloads">
            <Download size={22} />
            {downloads.length > 0 && <span className="nav-badge">{downloads.length}</span>}
          </NavLink>
          <NavLink to="/settings" className="icon-btn" aria-label="Settings" title="Settings">
            <Settings size={22} />
          </NavLink>
          <span
            className={`conn-dot ${connected ? 'conn-on' : 'conn-off'}`}
            title={connected ? 'Backend connected' : 'Backend offline'}
            aria-hidden="true"
          />
          <button
            type="button"
            className="icon-btn mobile-menu-btn"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>
      <nav
        className={`mobile-sheet ${menuOpen ? 'open' : ''}`}
        aria-label="Mobile"
        hidden={!menuOpen}
      >
        {navItem('/', 'Home')}
        {navItem('/downloads', 'Downloads')}
        {navItem('/settings', 'Settings')}
      </nav>
    </header>
  );
}
