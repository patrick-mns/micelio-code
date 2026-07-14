// Workspace skills loaded from `.micelio/skills/`. SkillDock keeps this in
// sync (initial load + toggles); Composer chips and chat #mention highlights
// read from here so every surface agrees on which mentions are real skills.
import type { StateCreator } from 'zustand';
import type { SkillSummary } from '@/types';
import type { AppState } from './index';

export interface SkillsSlice {
  skills: SkillSummary[];
  setSkills: (skills: SkillSummary[]) => void;
}

export const skillsSlice: StateCreator<AppState, [], [], SkillsSlice> = (set) => ({
  skills: [],
  setSkills: (skills) => set({ skills }),
});
