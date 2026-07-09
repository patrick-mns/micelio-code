// Treemap / knowledge graph state.
import type { StateCreator } from 'zustand';
import type { TreemapNode } from '@/types';
import type { AppState } from './index';
import { invoke } from '@tauri-apps/api/core';

export interface GraphSlice {
  graphNodes: TreemapNode[];
  scanning: boolean;
  selectedNode: TreemapNode | null;
  setGraphNodes: (graphNodes: TreemapNode[]) => void;
  setScanning: (scanning: boolean) => void;
  setSelectedNode: (selectedNode: TreemapNode | null) => void;
  setNodeSummary: (id: number, summary: string) => void;
  refreshGraph: () => Promise<void>;
}

export const graphSlice: StateCreator<AppState, [], [], GraphSlice> = (set) => ({
  graphNodes: [],
  scanning: false,
  selectedNode: null,

  setGraphNodes: (graphNodes) => set({ graphNodes }),

  setScanning: (scanning) => set({ scanning }),

  setSelectedNode: (selectedNode) => set({ selectedNode }),

  refreshGraph: async () => {
    try {
      const nodes = await invoke<TreemapNode[]>('get_graph');
      set({ graphNodes: nodes });
    } catch (e) {
      console.error('Failed to refresh graph', e);
    }
  },

  // Persist a freshly generated summary into the in-memory graph (the backend
  // already saved it to graph.json) so reopening the node shows it without an
  // app restart. Walks the treemap tree since nodes are nested.
  setNodeSummary: (id, summary) =>
    set((s) => {
      const walk = (nodes: TreemapNode[]): TreemapNode[] =>
        nodes.map((n) =>
          n.id === id
            ? { ...n, summary }
            : n.children && n.children.length
              ? { ...n, children: walk(n.children) }
              : n,
        );
      return {
        graphNodes: walk(s.graphNodes),
        selectedNode:
          s.selectedNode && s.selectedNode.id === id
            ? { ...s.selectedNode, summary }
            : s.selectedNode,
      };
    }),
});
