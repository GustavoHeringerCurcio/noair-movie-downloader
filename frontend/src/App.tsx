import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppHeader } from './components/AppHeader';
import { StatusBanner } from './components/StatusBanner';
import { SearchOverlay } from './components/SearchOverlay';
import { Toasts } from './components/Toasts';
import { HomePage } from './pages/HomePage';
import { DownloadsPage } from './pages/DownloadsPage';
import { SettingsPage } from './pages/SettingsPage';
import { DetailPage } from './pages/DetailPage';
import { WatchPage } from './pages/WatchPage';
import { useDownloadsStore } from './store/downloadsStore';

function Shell() {
  const connect = useDownloadsStore((s) => s.connect);

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <StatusBanner />
      <AppHeader />
      <SearchOverlay />
      <main className="app-main" id="main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/downloads" element={<DownloadsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/media/:id" element={<DetailPage />} />
          <Route path="/watch/:infoHash" element={<WatchPage />} />
          <Route
            path="*"
            element={
              <div className="page-state">
                <p>Page not found.</p>
                <a className="btn btn-white" href="/">
                  Back home
                </a>
              </div>
            }
          />
        </Routes>
      </main>
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
