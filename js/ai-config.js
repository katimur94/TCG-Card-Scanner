// Eingebauter OpenRouter-Schlüssel für den KI-Leser. Steht NICHT im Repository: Der Workflow
// ersetzt den Platzhalter beim Veröffentlichen durch das GitHub-Secret OPENROUTER_KEY.
// Ein in "Mehr" eingetragener eigener Schlüssel hat Vorrang.
const KEY = '__OPENROUTER_KEY__';
export const BUILTIN_AI_KEY = KEY.startsWith('__') ? '' : KEY;
