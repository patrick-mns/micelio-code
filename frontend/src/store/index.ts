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

export type AppState =
  & ChatSlice
  & ComposerSlice
  & GraphSlice
  & SettingsSlice
  & PrefsSlice
  & SessionsSlice
  & UiSlice
  & ThemeSlice
  & UpdateSlice;

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
}));
