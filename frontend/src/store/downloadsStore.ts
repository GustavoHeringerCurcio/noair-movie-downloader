import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import type { DownloadRecord } from '../types';

interface DownloadsState {
  downloads: DownloadRecord[];
  connected: boolean;
  socket: Socket | null;
  setDownloads: (downloads: DownloadRecord[]) => void;
  removeLocal: (infoHash: string) => void;
  connect: () => void;
  disconnect: () => void;
}

interface DownloadsPayload {
  downloads: DownloadRecord[];
}

export const useDownloadsStore = create<DownloadsState>((set, get) => ({
  downloads: [],
  connected: false,
  socket: null,
  setDownloads: (downloads) => set({ downloads }),
  removeLocal: (infoHash) =>
    set((s) => ({ downloads: s.downloads.filter((d) => d.infoHash !== infoHash) })),
  connect: () => {
    if (get().socket) return;
    const socket = io();
    socket.on('connect', () => set({ connected: true }));
    socket.on('disconnect', () => set({ connected: false }));
    socket.on('downloads:initial', (payload: DownloadsPayload) => {
      set({ downloads: payload.downloads });
    });
    socket.on('downloads:update', (payload: DownloadsPayload) => {
      set({ downloads: payload.downloads });
    });
    set({ socket });
  },
  disconnect: () => {
    get().socket?.disconnect();
    set({ socket: null, connected: false });
  },
}));
