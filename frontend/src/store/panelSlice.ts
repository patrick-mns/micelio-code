// Panel and tab state — which tabs are open, active, sizes, positions.
import type { StateCreator } from 'zustand';
import type { AppState } from './index';
import type { PanelTab } from '@/types';

export interface PanelSlice {
  // Bottom panel
  bottomTabs: PanelTab[];
  activeBottomTab: string | null;
  bottomPanelOpen: boolean;
  bottomPanelHeight: number;

  // Right panel
  rightTabs: PanelTab[];
  activeRightTab: string | null;
  rightPanelOpen: boolean;
  rightPanelWidth: number;

  // Actions
  setBottomTabs: (tabs: PanelTab[]) => void;
  setActiveBottomTab: (tabId: string | null) => void;
  setBottomPanelOpen: (open: boolean) => void;
  setBottomPanelHeight: (height: number) => void;
  toggleBottomPanel: () => void;

  setRightTabs: (tabs: PanelTab[]) => void;
  setActiveRightTab: (tabId: string | null) => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelWidth: (width: number) => void;
  toggleRightPanel: () => void;

  // Add/remove tabs
  addBottomTab: (tab: PanelTab) => void;
  removeBottomTab: (tabId: string) => void;
  addRightTab: (tab: PanelTab) => void;
  removeRightTab: (tabId: string) => void;
}

const DEFAULT_BOTTOM_HEIGHT = 240;
const DEFAULT_RIGHT_WIDTH = 328;

export const panelSlice: StateCreator<AppState, [], [], PanelSlice> = (set) => ({
  bottomTabs: [
    { id: 'terminal', type: 'terminal', label: 'Terminal', icon: 'terminal' },
  ],
  activeBottomTab: 'terminal',
  bottomPanelOpen: false,
  bottomPanelHeight: DEFAULT_BOTTOM_HEIGHT,

  rightTabs: [
    { id: 'bg-tasks', type: 'bg-tasks', label: 'Background Tasks', icon: 'activity' },
    { id: 'review', type: 'review', label: 'Review', icon: 'check' },
  ],
  activeRightTab: null,
  rightPanelOpen: false,
  rightPanelWidth: DEFAULT_RIGHT_WIDTH,

  setBottomTabs: (tabs) => set({ bottomTabs: tabs }),
  setActiveBottomTab: (tabId) => set({ activeBottomTab: tabId }),
  setBottomPanelOpen: (open) => set({ bottomPanelOpen: open }),
  setBottomPanelHeight: (height) => set({ bottomPanelHeight: height }),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),

  setRightTabs: (tabs) => set({ rightTabs: tabs }),
  setActiveRightTab: (tabId) => set({ activeRightTab: tabId }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setRightPanelWidth: (width) => set({ rightPanelWidth: width }),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),

  addBottomTab: (tab) => set((s) => ({
    bottomTabs: [...s.bottomTabs, tab],
    activeBottomTab: tab.id,
    bottomPanelOpen: true,
  })),
  removeBottomTab: (tabId) => set((s) => {
    const newTabs = s.bottomTabs.filter((t) => t.id !== tabId);
    return {
      bottomTabs: newTabs,
      activeBottomTab: s.activeBottomTab === tabId ? (newTabs[0]?.id ?? null) : s.activeBottomTab,
    };
  }),

  addRightTab: (tab) => set((s) => ({
    rightTabs: [...s.rightTabs, tab],
    activeRightTab: tab.id,
    rightPanelOpen: true,
  })),
  removeRightTab: (tabId) => set((s) => {
    const newTabs = s.rightTabs.filter((t) => t.id !== tabId);
    return {
      rightTabs: newTabs,
      activeRightTab: s.activeRightTab === tabId ? (newTabs[0]?.id ?? null) : s.activeRightTab,
    };
  }),
});
