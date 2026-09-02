import { create } from 'zustand';

interface UiState {
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  panelOpen: false,
  setPanelOpen: (open) => set({ panelOpen: open }),
}));
