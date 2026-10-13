// Einstellungen: Standardwerte und Übernahme aus der alten App.

export type AiProvider = 'gemini' | 'openrouter';

export interface AppSettings {
  scanLang: string; // 'auto' oder Sprachcode
  fallbackLang: string;
  searchLang: string;
  siteLang: string; // Sprache der Cardmarket-Website
  collectLangs: string[]; // Sammel-Sprachen (welche Indexe geladen werden)
  condition: number; // Vorauswahl Zustand (2 = NM)
  haptics: boolean;
  autoScan: boolean;
  vision: boolean;
  showUSD: boolean;
  conditionFactors: Record<number, number> | null;
  aiProvider: AiProvider;
  geminiKey: string;
  geminiModels: string[]; // Modell-Kette, geprüft gegen die Modell-Liste der API
  geminiLimits: Record<string, number>; // Tageslimit je Modell (änderbar)
  openrouterKey: string;
  openrouterModel: string;
  aiMode: 'auto' | 'always';
  backupReminderDays: number | null; // Erinnerung alle n Tage
  lastBackupAt: number | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  scanLang: 'auto',
  fallbackLang: 'de',
  searchLang: 'de',
  siteLang: 'de',
  collectLangs: ['de', 'en', 'ja'],
  condition: 2,
  haptics: true,
  autoScan: true,
  vision: true,
  showUSD: true,
  conditionFactors: null,
  aiProvider: 'gemini',
  geminiKey: '',
  geminiModels: [],
  geminiLimits: {},
  openrouterKey: '',
  openrouterModel: 'google/gemma-4-31b-it:free',
  aiMode: 'auto',
  backupReminderDays: null,
  lastBackupAt: null,
};

const LANG_CODES = ['de', 'en', 'fr', 'es', 'it', 'pt', 'ja'];

/** Einstellungen der alten App (IndexedDB "holoscan", kv/settings) in das neue Format übernehmen. */
export function settingsFromLegacy(old: Record<string, unknown> | null | undefined): Partial<AppSettings> {
  if (!old || typeof old !== 'object') return {};
  const out: Partial<AppSettings> = {};
  const str = (k: string) => (typeof old[k] === 'string' ? (old[k] as string) : undefined);
  const bool = (k: string) => (typeof old[k] === 'boolean' ? (old[k] as boolean) : undefined);
  const lang = (k: string, allowAuto = false) => {
    const v = str(k);
    return v && (LANG_CODES.includes(v) || (allowAuto && v === 'auto')) ? v : undefined;
  };
  const assign = <K extends keyof AppSettings>(key: K, value: AppSettings[K] | undefined) => {
    if (value !== undefined) out[key] = value;
  };
  assign('scanLang', lang('scanLang', true));
  assign('fallbackLang', lang('fallbackLang'));
  assign('searchLang', lang('searchLang'));
  assign('siteLang', ['de', 'en', 'fr', 'es', 'it'].includes(str('siteLang') ?? '') ? str('siteLang') : undefined);
  const cond = Number(old.condition);
  if (Number.isInteger(cond) && cond >= 1 && cond <= 7) out.condition = cond;
  assign('haptics', bool('haptics'));
  assign('autoScan', bool('autoScan'));
  assign('vision', bool('vision'));
  assign('showUSD', bool('showUSD'));
  if (old.conditionFactors && typeof old.conditionFactors === 'object') {
    const f: Record<number, number> = {};
    for (const [k, v] of Object.entries(old.conditionFactors as Record<string, unknown>)) {
      const id = Number(k);
      if (id >= 1 && id <= 7 && typeof v === 'number' && v > 0 && v <= 2) f[id] = v;
    }
    if (Object.keys(f).length) out.conditionFactors = f;
  }
  const key = str('aiKey')?.trim();
  if (key) {
    out.openrouterKey = key;
    out.aiProvider = 'openrouter';
  }
  assign('openrouterModel', str('aiModel')?.trim() || undefined);
  const mode = str('aiMode');
  if (mode === 'auto' || mode === 'always') out.aiMode = mode;
  return out;
}
