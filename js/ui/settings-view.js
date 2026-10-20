// Einstellungsseite: Formular befüllen, auslesen, Buttons verdrahten.
import { $, fillVoiceSelect, toast, renderKeyHint } from './view.js';
import { PROVIDERS, loadSettings, saveSettings, resolveProvider } from '../core/settings.js';
import { loadPersona, savePersona, sortVoices, previewSentence, sanitizeName } from '../core/persona.js';
import { askAI, listModels } from '../core/ai.js';
import { loadNotes } from '../core/skills.js';
import { GAP_OPTIONS, LATEST_OPTIONS, RESSORTS, RESSORT_IDS, loadBriefingState, resolveCoords, normalizeBriefingConfig, EVENING_START_OPTIONS, normalizeEveningConfig } from '../core/briefing/index.js';

export function createSettingsView({ store, tts, device = null, onSaved, onClearChat, onTestBriefing, onTestEvening }) {
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
    fillBriefing(draft.briefing);
    fillEvening(draft.evening);
    refreshVoices();
  }

  // ---------- Morgen-Briefing ----------
  const b = {
    enabled: $('#set-brief-enabled'), gap: $('#set-brief-gap'), latest: $('#set-brief-latest'),
    weather: $('#set-brief-weather'), calendar: $('#set-brief-calendar'), news: $('#set-brief-news'),
    battery: $('#set-brief-battery'), notes: $('#set-brief-notes'), ressorts: $('#brief-ressorts'),
    bg: $('#set-brief-bg'), speak: $('#set-brief-speak'), titles: $('#set-brief-titles'),
    loc: $('#brief-loc-status'), nativeStatus: $('#brief-native-status')
  };
  const nb = device?.briefing || null;
  b.gap.replaceChildren(...GAP_OPTIONS.map((h) => new Option(`${h} Stunden Pause`, String(h))));
  b.latest.replaceChildren(...LATEST_OPTIONS.map((h) => new Option(`${h}:00 Uhr`, String(h))));
  b.ressorts.replaceChildren(...RESSORT_IDS.map((id) => {
    const l = document.createElement('label');
    const c = document.createElement('input');
    c.type = 'checkbox'; c.value = id; c.className = 'brief-ressort';
    l.append(c, document.createTextNode(' ' + RESSORTS[id].label));
    return l;
  }));

  function fillBriefing(cfg) {
    b.enabled.checked = cfg.enabled;
    b.gap.value = String(cfg.gapHours);
    b.latest.value = String(cfg.latestHour);
    b.weather.checked = cfg.content.weather;
    b.calendar.checked = cfg.content.calendar;
    b.news.checked = cfg.content.news;
    b.battery.checked = cfg.content.battery;
    b.notes.checked = cfg.content.notes;
    b.ressorts.querySelectorAll('input').forEach((c) => { c.checked = cfg.newsRessorts.includes(c.value); });
    b.bg.checked = cfg.background;
    b.speak.checked = cfg.speakAloud;
    b.titles.checked = cfg.speakTitles;
    renderLocation();
    renderNativeStatus();
  }

  function readBriefing() {
    return normalizeBriefingConfig({
      enabled: b.enabled.checked,
      gapHours: Number(b.gap.value),
      latestHour: Number(b.latest.value),
      content: { weather: b.weather.checked, calendar: b.calendar.checked, news: b.news.checked, battery: b.battery.checked, notes: b.notes.checked },
      newsRessorts: [...b.ressorts.querySelectorAll('input:checked')].map((c) => c.value),
      background: b.bg.checked,
      speakAloud: b.speak.checked,
      speakTitles: b.titles.checked
    }, RESSORT_IDS);
  }

  function renderLocation() {
    const c = loadBriefingState(store).coords;
    if (!c?.at) { b.loc.textContent = '📍 Standort fürs Wetter: noch nicht ermittelt.'; return; }
    const min = Math.round((Date.now() - c.at) / 60000);
    const ago = min < 60 ? `vor ${min} Min.` : min < 1440 ? `vor ${Math.round(min / 60)} Std.` : `vor ${Math.round(min / 1440)} Tagen`;
    b.loc.textContent = `📍 Standort fürs Wetter zuletzt ${ago} ermittelt (auf ca. 1 km gerundet, geht nur an Open-Meteo).`;
  }

  async function renderNativeStatus() {
    if (!nb) return;
    const st = await nb.status();
    if (!st) { b.nativeStatus.textContent = ''; return; }
    const yes = (v, a, n) => (v ? a : n);
    b.nativeStatus.textContent = [
      `Hintergrund: ${yes(st.serviceRunning, 'läuft', 'aus')}`,
      `Benachrichtigungen: ${yes(st.notifications, 'erlaubt', 'aus')}`,
      `Kalender: ${st.calendar === 'granted' ? 'erlaubt' : 'nicht erlaubt'}`,
      `Akku-Optimierung: ${yes(st.ignoringBattery, 'aus (gut)', 'aktiv – kann den Dienst beenden')}`
    ].join(' · ');
  }

  $('#btn-brief-location').addEventListener('click', async () => {
    b.loc.textContent = '📍 Frage Standort ab …';
    const r = await resolveCoords({ device, store, interactive: true, now: new Date(), timeZone: undefined });
    if (r.source === 'live') { renderLocation(); toast('Standort ermittelt.'); }
    else { renderLocation(); toast(r.reason === 'denied' ? 'Standort-Erlaubnis verweigert – bitte in den Einstellungen des Browsers/Handys erlauben.' : 'Standort gerade nicht verfügbar.'); }
  });
  $('#btn-brief-test').addEventListener('click', () => {
    stashProvider();
    saveSettings(store, { briefing: readBriefing() });
    onTestBriefing?.();
  });
  // ---------- Abendzusammenfassung ----------
  const eve = {
    enabled: $('#set-eve-enabled'), start: $('#set-eve-start'), chats: $('#set-eve-chats'), notes: $('#set-eve-notes'),
    timers: $('#set-eve-timers'), calendar: $('#set-eve-calendar'), weather: $('#set-eve-weather'), news: $('#set-eve-news')
  };
  const EVE_CONTENT = ['chats', 'notes', 'timers', 'calendar', 'weather', 'news'];
  eve.start.replaceChildren(...EVENING_START_OPTIONS.map((h) => new Option(`${h}:00 Uhr`, String(h))));
  function fillEvening(cfg) {
    eve.enabled.checked = cfg.enabled;
    eve.start.value = String(cfg.startHour);
    for (const k of EVE_CONTENT) eve[k].checked = cfg.content[k];
  }
  function readEvening() {
    return normalizeEveningConfig({
      enabled: eve.enabled.checked,
      startHour: Number(eve.start.value),
      content: Object.fromEntries(EVE_CONTENT.map((k) => [k, eve[k].checked]))
    });
  }
  $('#btn-eve-test').addEventListener('click', () => {
    stashProvider();
    saveSettings(store, { evening: readEvening() });
    onTestEvening?.();
  });

  const nbBtn = (id, fn) => $(id)?.addEventListener('click', async () => { await fn(); setTimeout(renderNativeStatus, 800); });
  if (nb) {
    nbBtn('#btn-brief-notif', () => nb.requestNotifications());
    nbBtn('#btn-brief-cal', () => nb.requestCalendar());
    nbBtn('#btn-brief-battery', () => nb.requestIgnoreBattery());
    nbBtn('#btn-brief-appsettings', () => nb.openAppSettings());
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#view-settings').classList.contains('hidden')) renderNativeStatus(); });
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
      wakeWord: f.wake.checked,
      briefing: readBriefing(),
      evening: readEvening()
    });
    const persona = savePersona(store, currentPersonaFromForm());
    toast('Gespeichert.');
    onSaved({ settings, persona });
  });

  tts.onVoicesChanged(() => { if (!$('#view-settings').classList.contains('hidden')) refreshVoices(); });

  return { fill };
}
