import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useDownloadsStore } from './store/downloadsStore';
import { useUiStore } from './store/uiStore';
import { DownloadsPanel } from './components/DownloadsPanel';
import { Toasts } from './components/Toasts';
import { SearchPage } from './pages/SearchPage';
import { DetailPage } from './pages/DetailPage';
import { WatchPage } from './pages/WatchPage';

function Header() {
  const downloads = useDownloadsStore((s) => s.downloads);
  const connected = useDownloadsStore((s) => s.connected);
  const setPanelOpen = useUiStore((s) => s.setPanelOpen);
  return (
    <header className="app-header">
      <Link to="/" className="brand">
        <span className="brand-mark">▶</span> Movie Downloader
      </Link>
      <div className="header-actions">
        <span className={`conn-dot ${connected ? 'conn-on' : 'conn-off'}`} title={connected ? 'Live' : 'Offline'} />
        <button type="button" className="btn" onClick={() => setPanelOpen(true)}>
          Downloads{downloads.length > 0 ? ` (${downloads.length})` : ''}
        </button>
      </div>
    </header>
  );
}

function Shell() {
  const panelOpen = useUiStore((s) => s.panelOpen);
  const setPanelOpen = useUiStore((s) => s.setPanelOpen);
  const location = useLocation();
  const connect = useDownloadsStore((s) => s.connect);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    setPanelOpen(false);
  }, [location, setPanelOpen]);

  return (
    <div className="app">
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/media/:id" element={<DetailPage />} />
          <Route path="/watch/:infoHash" element={<WatchPage />} />
        </Routes>
      </main>
      <DownloadsPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
      <Toasts />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
