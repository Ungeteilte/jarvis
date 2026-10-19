// KI-Anbieter-Einstellungen (reine Logik).

export const PROVIDERS = Object.freeze({
  xai: {
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.7',
    models: ['grok-4.7', 'grok-4.6', 'grok-4.5'],
    keyUrl: 'https://console.x.ai'
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6-luna',
    models: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'],
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  custom: {
    label: 'Eigene URL',
    baseUrl: '',
    defaultModel: '',
    models: [],
    keyUrl: ''
  }
});

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'xai',
  apiKeys: { xai: '', openai: '', custom: '' },
  models: { xai: '', openai: '', custom: '' },
  customBaseUrl: '',
  speak: true,
  wakeWord: false
});

const KEY = 'settings';

export function loadSettings(store) {
  const s = store.get(KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    provider: PROVIDERS[s.provider] ? s.provider : DEFAULT_SETTINGS.provider,
    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...(s.apiKeys || {}) },
    models: { ...DEFAULT_SETTINGS.models, ...(s.models || {}) }
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
