// KI-Anbieter-Einstellungen (reine Logik).
import { DEFAULT_BRIEFING, normalizeBriefingConfig } from './briefing/trigger.js';
import { RESSORT_IDS } from './briefing/news.js';
import { DEFAULT_EVENING, normalizeEveningConfig } from './briefing/evening-config.js';
import { DEFAULT_WEEKLY, normalizeWeeklyConfig } from './briefing/weekly-config.js';
import { DEFAULT_PREFS, normalizePrefs } from './prefs.js';

export const PROVIDERS = Object.freeze({
  xai: {
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.7',
    models: ['grok-4.7', 'grok-4.6', 'grok-4.5'],
    keyUrl: 'https://console.x.ai',
    keyHint: 'Schlüssel unter console.x.ai → API Keys (Guthaben nötig).'
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6-luna',
    models: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'],
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'Schlüssel unter platform.openai.com/api-keys (Guthaben nötig).'
  },
  gemini: {
    label: 'Google Gemini',
    // OpenAI-kompatibler Endpunkt von Google (erlaubt Browser-Aufrufe/CORS)
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'Kostenloser Schlüssel unter aistudio.google.com/apikey – keine Kreditkarte nötig.'
  },
  custom: {
    label: 'Eigene URL',
    baseUrl: '',
    defaultModel: '',
    models: [],
    keyUrl: '',
    keyHint: 'Basis-URL bis einschließlich /v1 eintragen. Der Server muss CORS erlauben.'
  }
});

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'xai',
  apiKeys: { xai: '', openai: '', gemini: '', custom: '' },
  models: { xai: '', openai: '', gemini: '', custom: '' },
  customBaseUrl: '',
  speak: true,
  wakeWord: false,
  wakeMuteBeep: true, // Android: Startton der Erkennung beim Wake-Word kurz stummschalten
  listenOnOpen: false, // v0.9 Stufe 0: beim normalen Öffnen (Seitentaste, „Hey Google, öffne Jarvis“) sofort zuhören
  briefing: DEFAULT_BRIEFING,
  evening: DEFAULT_EVENING,
  weekly: DEFAULT_WEEKLY, // v0.9.3: Wochenrückblick sonntags (ersetzt dann die Abendzusammenfassung)
  memoryToAI: true, // Gedächtnis-Einträge mit an die KI senden (abschaltbar)
  prefs: DEFAULT_PREFS
});

const KEY = 'settings';

export function loadSettings(store) {
  const s = store.get(KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    provider: PROVIDERS[s.provider] ? s.provider : DEFAULT_SETTINGS.provider,
    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...(s.apiKeys || {}) },
    models: { ...DEFAULT_SETTINGS.models, ...(s.models || {}) },
    briefing: normalizeBriefingConfig(s.briefing, RESSORT_IDS),
    wakeMuteBeep: typeof s.wakeMuteBeep === 'boolean' ? s.wakeMuteBeep : DEFAULT_SETTINGS.wakeMuteBeep,
    listenOnOpen: s.listenOnOpen === true,
    evening: normalizeEveningConfig(s.evening),
    weekly: normalizeWeeklyConfig(s.weekly),
    memoryToAI: typeof s.memoryToAI === 'boolean' ? s.memoryToAI : DEFAULT_SETTINGS.memoryToAI,
    prefs: normalizePrefs(s.prefs)
  };
}

export function saveSettings(store, changes) {
  const next = { ...loadSettings(store), ...changes };
  store.set(KEY, next);
  return next;
}

/** Liefert { baseUrl, apiKey, model } für den aktiven Anbieter. */
export function resolveProvider(settings) {
  const id = settings.provider;
  const p = PROVIDERS[id] || PROVIDERS.xai;
  const baseUrl = (id === 'custom' ? settings.customBaseUrl : p.baseUrl || '').trim().replace(/\/+$/, '');
  return {
    id,
    baseUrl,
    apiKey: (settings.apiKeys?.[id] || '').trim(),
    model: (settings.models?.[id] || '').trim() || p.defaultModel
  };
}
