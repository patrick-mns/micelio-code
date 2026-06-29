import type { StateCreator } from 'zustand';
import type { AppState } from './index';
import { ipc } from '@/ipc';

export type UpdateStatusLabel =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdateStateData {
  status: UpdateStatusLabel;
  version?: string;
  notes?: string;
  download_url?: string;
  asset_name?: string;
  asset_size?: number;
  progress?: number; // 0-100
  error_msg?: string;
}

export interface UpdateSlice {
  update: UpdateStateData;
  setUpdateState: (data: Partial<UpdateStateData>) => void;
  checkForUpdates: () => Promise<void>;
  startDownload: () => Promise<void>;
  applyUpdate: () => Promise<void>;
}

export const updateSlice: StateCreator<AppState, [], [], UpdateSlice> = (set, get) => ({
  update: { status: 'idle' },

  setUpdateState: (data) =>
    set((s) => ({
      update: { ...s.update, ...data },
    })),

  checkForUpdates: async () => {
    get().setUpdateState({ status: 'checking', error_msg: undefined });
    try {
      const res = await ipc.checkForUpdates();
      // Handle the status from the Rust command (lowercase enum variant matches frontend type)
      const st = typeof res === 'string' ? res : Object.keys(res)[0];
      const payload = typeof res === 'string' ? {} : (res as any)[st];

      get().setUpdateState({
        status: st as UpdateStatusLabel,
        version: payload?.version,
        notes: payload?.notes,
        download_url: payload?.download_url,
        asset_name: payload?.asset_name,
        asset_size: payload?.asset_size,
        progress: payload?.progress,
        error_msg: typeof res === 'object' && 'error' in res ? (res as any).error : undefined,
      });
    } catch (e: any) {
      get().setUpdateState({ status: 'error', error_msg: String(e) });
    }
  },

  startDownload: async () => {
    try {
      get().setUpdateState({ status: 'downloading', progress: 0 });
      await ipc.startUpdateDownload();
    } catch (e: any) {
      get().setUpdateState({ status: 'error', error_msg: String(e) });
    }
  },

  applyUpdate: async () => {
    try {
      await ipc.installAndRestart();
    } catch (e: any) {
      get().setUpdateState({ status: 'error', error_msg: String(e) });
    }
  },
});