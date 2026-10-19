// Einstellungsseite: Formular befüllen, auslesen, Buttons verdrahten.
import { $, fillVoiceSelect, toast, renderKeyHint } from './view.js';
import { PROVIDERS, loadSettings, saveSettings, resolveProvider } from '../core/settings.js';
import { loadPersona, savePersona, sortVoices, previewSentence, sanitizeName } from '../core/persona.js';
import { askAI, listModels } from '../core/ai.js';
import { loadNotes } from '../core/skills.js';

export function createSettingsView({ store, tts, onSaved, onClearChat }) {
  const f = {
    provider: $('#set-provider'), baseurl: $('#set-baseurl'), rowBase: $('#row-baseurl'),
    apikey: $('#set-apikey'), modelSelect: $('#set-model-select'), modelCustom: $('#set-model-custom'), rowCustomModel: $('#row-custom-model'),
    name: $('#set-name'), voice: $('#set-voice'), rate: $('#set-rate'), pitch: $('#set-pitch'),
    outRate: $('#out-rate'), outPitch: $('#out-pitch'), speak: $('#set-speak'), wake: $('#set-wake'),
    testResult: $('#test-result'), notes: $('#notes-view')
  };
  // Formularwerte pro Anbieter zwischenspeichern, damit Umschalten nichts verliert
  let draft = loadSettings(store);
  let shown = draft.provider; // aktuell angezeigter Anbieter

  function stashProvider(id = shown) {
    draft.apiKeys = { ...draft.apiKeys, [id]: f.apikey.value.trim() };
    draft.models = { ...draft.models, [id]: currentModel() };
    if (id === 'custom') draft.customBaseUrl = f.baseurl.value.trim();
  }

  function showProvider(id) {
    const p = PROVIDERS[id];
    shown = id;
    f.provider.value = id;
    f.rowBase.classList.toggle('hidden', id !== 'custom');
    f.baseurl.value = draft.customBaseUrl || '';
    f.apikey.value = draft.apiKeys[id] || '';
    f.testResult.textContent = '';
    renderKeyHint($('#key-hint'), p);
    fillModelSelect(id, draft.models[id] || '');
  }

  /** Bekannte Modelle + „Eigenes Modell…“. selected = gespeicherter Wert. */
  function fillModelSelect(providerId, selected) {
    const p = PROVIDERS[providerId] || PROVIDERS.xai;
    const known = [...(p.models || [])];
    if (p.defaultModel && !known.includes(p.defaultModel)) known.unshift(p.defaultModel);
    // Vom „Laden“-Aufruf zwischengespeicherte Extra-Modelle
    const extra = draft._loadedModels?.[providerId] || [];
    for (const m of extra) if (m && !known.includes(m)) known.push(m);

    const isCustom = selected && !known.includes(selected);
    f.modelSelect.replaceChildren();
    if (!known.length && !selected) {
      f.modelSelect.append(new Option(p.defaultModel || '(kein Vorschlag)', p.defaultModel || ''));
    }
    for (const m of known) f.modelSelect.append(new Option(m, m));
    f.modelSelect.append(new Option('Eigenes Modell…', '__custom__'));

    if (isCustom) {
      f.modelSelect.value = '__custom__';
      f.rowCustomModel.classList.remove('hidden');
      f.modelCustom.value = selected;
    } else {
      f.modelSelect.value = selected || p.defaultModel || (known[0] || '');
      if (![...f.modelSelect.options].some((o) => o.value === f.modelSelect.value)) {
        f.modelSelect.value = known[0] || '__custom__';
      }
      const custom = f.modelSelect.value === '__custom__';
      f.rowCustomModel.classList.toggle('hidden', !custom);
      if (!custom) f.modelCustom.value = '';
      else f.modelCustom.value = selected || '';
    }
  }

  function currentModel() {
    if (f.modelSelect.value === '__custom__') return f.modelCustom.value.trim();
    return (f.modelSelect.value || '').trim();
  }

  async function refreshVoices() {
    const voices = sortVoices(await tts.listVoices());
    fillVoiceSelect(f.voice, voices, loadPersona(store).voiceId);
    return voices;
  }

  function currentPersonaFromForm() {
    return { name: sanitizeName(f.name.value), voiceId: f.voice.value, rate: +f.rate.value, pitch: +f.pitch.value };
  }

  function fill() {
    draft = loadSettings(store);
    const p = loadPersona(store);
    showProvider(draft.provider);
    f.name.value = p.name;
    f.rate.value = p.rate; f.outRate.textContent = (+p.rate).toFixed(1);
    f.pitch.value = p.pitch; f.outPitch.textContent = (+p.pitch).toFixed(1);
    f.speak.checked = draft.speak;
    f.wake.checked = draft.wakeWord;
    f.notes.classList.add('hidden');
    refreshVoices();
  }

  function draftConfig() {
    stashProvider();
    return resolveProvider({ ...draft, provider: shown });
  }

  // --- Ereignisse ---
  f.provider.addEventListener('change', () => {
    stashProvider(shown); // Werte des alten Anbieters sichern
    showProvider(f.provider.value);
  });
  f.rate.addEventListener('input', () => { f.outRate.textContent = (+f.rate.value).toFixed(1); });
  f.pitch.addEventListener('input', () => { f.outPitch.textContent = (+f.pitch.value).toFixed(1); });

  $('#btn-togglekey').addEventListener('click', () => {
    f.apikey.type = f.apikey.type === 'password' ? 'text' : 'password';
  });

  $('#btn-preview').addEventListener('click', () => {
    const p = currentPersonaFromForm();
    tts.speak(previewSentence(p.name), p);
  });

  f.modelSelect.addEventListener('change', () => {
    const custom = f.modelSelect.value === '__custom__';
    f.rowCustomModel.classList.toggle('hidden', !custom);
    if (custom) f.modelCustom.focus();
  });

  $('#btn-loadmodels').addEventListener('click', async () => {
    f.testResult.className = 'hint';
    f.testResult.textContent = 'Lade Modelle …';
    try {
      const models = await listModels(draftConfig());
      draft._loadedModels = { ...(draft._loadedModels || {}), [shown]: models };
      const keep = currentModel();
      fillModelSelect(shown, keep);
      f.testResult.className = 'hint ok';
      f.testResult.textContent = `${models.length} Modelle geladen – bitte in der Liste wählen.`;
    } catch (e) {
      f.testResult.className = 'hint err';
      f.testResult.textContent = e.message;
    }
  });

  $('#btn-test').addEventListener('click', async () => {
    f.testResult.className = 'hint';
    f.testResult.textContent = 'Teste Verbindung …';
    try {
      const reply = await askAI(draftConfig(), 'Antworte mit genau einem kurzen deutschen Satz.', [{ role: 'user', text: 'Sag Hallo.' }]);
      f.testResult.className = 'hint ok';
      f.testResult.textContent = `✅ Verbindung ok: „${reply}“`;
    } catch (e) {
      f.testResult.className = 'hint err';
      f.testResult.textContent = `❌ ${e.message}`;
    }
  });

  $('#btn-shownotes').addEventListener('click', () => {
    const notes = loadNotes(store);
    f.notes.textContent = notes.length
      ? notes.map((n) => `• ${n.text}  (${new Date(n.at).toLocaleDateString('de-DE')})`).join('\n')
      : 'Keine Notizen gespeichert.';
    f.notes.classList.toggle('hidden');
  });
  $('#btn-clearnotes').addEventListener('click', () => {
    if (confirm('Alle Notizen löschen?')) { store.set('notes', []); f.notes.classList.add('hidden'); toast('Notizen gelöscht.'); }
  });
  $('#btn-clearchat').addEventListener('click', () => {
    if (confirm('Gesamten Chatverlauf löschen?')) { onClearChat(); toast('Chatverlauf gelöscht.'); }
  });

  $('#settings-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    stashProvider();
    const settings = saveSettings(store, {
      provider: shown,
      apiKeys: draft.apiKeys,
      models: draft.models,
      customBaseUrl: draft.customBaseUrl,
      speak: f.speak.checked,
      wakeWord: f.wake.checked
    });
    const persona = savePersona(store, currentPersonaFromForm());
    toast('Gespeichert.');
    onSaved({ settings, persona });
  });

  tts.onVoicesChanged(() => { if (!$('#view-settings').classList.contains('hidden')) refreshVoices(); });

  return { fill };
}
