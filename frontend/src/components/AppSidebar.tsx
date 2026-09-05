import { NavLink, useLocation } from 'react-router-dom';
import { Download, Settings } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import { useDownloadsStore } from '@/store/downloadsStore';

export function AppSidebar() {
  const { pathname } = useLocation();
  const downloads = useDownloadsStore((s) => s.downloads);
  const connected = useDownloadsStore((s) => s.connected);

  return (
    <Sidebar>
      <SidebarHeader>
        <NavLink to="/" className="flex items-center gap-2 px-2 py-1.5 font-semibold">
          <span className="brand-mark">▶</span>
          <span className="truncate">Movie Downloader</span>
        </NavLink>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Library</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith('/downloads')}>
                  <NavLink to="/downloads">
                    <Download />
                    <span>Downloads</span>
                    {downloads.length > 0 && <SidebarMenuBadge>{downloads.length}</SidebarMenuBadge>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith('/settings')}>
                  <NavLink to="/settings">
                    <Settings />
                    <span>Settings</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
          <span className={`conn-dot ${connected ? 'conn-on' : 'conn-off'}`} aria-hidden="true" />
          <span>{connected ? 'Backend connected' : 'Backend offline'}</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
