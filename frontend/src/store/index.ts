import { create } from 'zustand';
import { chatSlice, type ChatSlice } from './chatSlice';
import { composerSlice, type ComposerSlice } from './composerSlice';
import { graphSlice, type GraphSlice } from './graphSlice';
import { settingsSlice, type SettingsSlice } from './settingsSlice';
import { prefsSlice, type PrefsSlice } from './prefsSlice';
import { sessionsSlice, type SessionsSlice } from './sessionsSlice';
import { uiSlice, type UiSlice } from './uiSlice';
import { themeSlice, type ThemeSlice } from './themeSlice';
import { updateSlice, type UpdateSlice } from './updateSlice';
import { workspaceSlice, type WorkspaceSlice } from './workspaceSlice';

export type { SessionBrief } from './workspaceSlice';

export type AppState =
  & ChatSlice
  & ComposerSlice
  & GraphSlice
  & SettingsSlice
  & PrefsSlice
  & SessionsSlice
  & UiSlice
  & ThemeSlice
  & UpdateSlice
  & WorkspaceSlice;

export const useStore = create<AppState>()((...a) => ({
  ...chatSlice(...a),
  ...composerSlice(...a),
  ...graphSlice(...a),
  ...settingsSlice(...a),
  ...prefsSlice(...a),
  ...sessionsSlice(...a),
  ...uiSlice(...a),
  ...themeSlice(...a),
  ...updateSlice(...a),
  ...workspaceSlice(...a),
}));
