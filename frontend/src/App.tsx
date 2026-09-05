import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { Toasts } from '@/components/Toasts';
import { HomePage } from '@/pages/HomePage';
import { DownloadsPage } from '@/pages/DownloadsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { DetailPage } from '@/pages/DetailPage';
import { WatchPage } from '@/pages/WatchPage';
import { useDownloadsStore } from '@/store/downloadsStore';

function Shell() {
  const connect = useDownloadsStore((s) => s.connect);

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <>
      <SidebarProvider>
        <AppSidebar />
        <div className="flex min-h-svh w-full flex-1 flex-col">
          <header className="app-topbar">
            <SidebarTrigger className="md:hidden" />
          </header>
          <main className="app-main">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/media/:id" element={<DetailPage />} />
              <Route path="/watch/:infoHash" element={<WatchPage />} />
            </Routes>
          </main>
        </div>
      </SidebarProvider>
      <Toasts />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
