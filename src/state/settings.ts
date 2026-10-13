// Einstellungen als Zustand-Store, gespeichert in der neuen Datenbank (settings/app).

import { create } from 'zustand';
import { db } from '../db/schema';
import { SETTINGS_KEY } from '../db/migrate';
import { DEFAULT_SETTINGS, type AppSettings } from './settingsModel';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load(): Promise<void>;
  update(patch: Partial<AppSettings>): Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    const row = await db.settings.get(SETTINGS_KEY);
    const settings = { ...DEFAULT_SETTINGS, ...((row?.value as Partial<AppSettings>) || {}) };
    applyDom(settings);
    set({ settings, loaded: true });
  },
  async update(patch) {
    const settings = { ...get().settings, ...patch };
    applyDom(settings);
    set({ settings });
    await db.settings.put({ key: SETTINGS_KEY, value: settings });
  },
}));

/** Für Code außerhalb von React (Preise, Erkennung). */
export const getSettings = () => useSettings.getState().settings;

function applyDom(s: AppSettings) {
  if (typeof document !== 'undefined') document.documentElement.dataset.haptics = s.haptics ? 'on' : 'off';
}
