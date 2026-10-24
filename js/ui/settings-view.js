// Einstellungsseite: Formular befüllen, auslesen, Buttons verdrahten.
import { $, fillVoiceSelect, toast, renderKeyHint } from './view.js';
import { PROVIDERS, loadSettings, saveSettings, resolveProvider } from '../core/settings.js';
import { loadPersona, savePersona, sortVoices, previewSentence, sanitizeName } from '../core/persona.js';
import { askAI, listModels } from '../core/ai.js';
import { loadNotes } from '../core/skills.js';
import { loadMemory, addMemory, updateMemory, removeMemory, clearMemory, migrateNotes, exportMemory, importMemory, KATEGORIE_LABELS } from '../core/memory.js';
import { PREF_OPTIONS, PREF_LABELS } from '../core/prefs.js';
import { LISTEN_GUIDE } from '../core/listen-launch.js';
import { GAP_OPTIONS, LATEST_OPTIONS, RESSORTS, RESSORT_IDS, loadBriefingState, resolveCoords, normalizeBriefingConfig, EVENING_START_OPTIONS, normalizeEveningConfig, WEEKLY_HOUR_OPTIONS, normalizeWeeklyConfig } from '../core/briefing/index.js';

export function createSettingsView({ store, tts, device = null, onSaved, onClearChat, onTestBriefing, onTestEvening, onTestWeekly }) {
  const f = {
    provider: $('#set-provider'), baseurl: $('#set-baseurl'), rowBase: $('#row-baseurl'),
    apikey: $('#set-apikey'), modelSelect: $('#set-model-select'), modelCustom: $('#set-model-custom'), rowCustomModel: $('#row-custom-model'),
    name: $('#set-name'), voice: $('#set-voice'), rate: $('#set-rate'), pitch: $('#set-pitch'),
    outRate: $('#out-rate'), outPitch: $('#out-pitch'), speak: $('#set-speak'), wake: $('#set-wake'), wakeMute: $('#set-wake-mute'), listenOpen: $('#set-listen-open'),
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
    f.wakeMute.checked = draft.wakeMuteBeep;
    f.listenOpen.checked = draft.listenOnOpen;
    f.notes.classList.add('hidden');
    fillMemory(draft);
    fillBriefing(draft.briefing);
    fillEvening(draft.evening);
    fillWeekly(draft.weekly);
    renderExact();
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
  // ---------- Wochenrückblick (v0.9.3) ----------
  const wk = { enabled: $('#set-week-enabled'), hour: $('#set-week-hour') };
  wk.hour.replaceChildren(...WEEKLY_HOUR_OPTIONS.map((h) => new Option(`${h}:00 Uhr`, String(h))));
  function fillWeekly(cfg) {
    wk.enabled.checked = cfg.enabled;
    wk.hour.value = String(cfg.hour);
  }
  function readWeekly() {
    return normalizeWeeklyConfig({ enabled: wk.enabled.checked, hour: Number(wk.hour.value) });
  }
  $('#btn-week-test').addEventListener('click', () => {
    stashProvider();
    saveSettings(store, { evening: readEvening(), weekly: readWeekly() });
    onTestWeekly?.();
  });

  const nbBtn = (id, fn) => $(id)?.addEventListener('click', async () => { await fn(); setTimeout(() => { renderNativeStatus(); renderExact(); }, 800); });
  if (nb) {
    nbBtn('#btn-brief-notif', () => nb.requestNotifications());
    nbBtn('#btn-brief-cal', () => nb.requestCalendar());
    nbBtn('#btn-brief-battery', () => nb.requestIgnoreBattery());
    nbBtn('#btn-brief-appsettings', () => nb.openAppSettings());
    // v0.9: dieselben Wege in „Werkzeuge & Berechtigungen“
    nbBtn('#btn-tools-notif', () => nb.requestNotifications());
    nbBtn('#btn-tools-battery', () => nb.requestIgnoreBattery());
    nbBtn('#btn-tools-appsettings', () => nb.openAppSettings());
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#view-settings').classList.contains('hidden')) { renderNativeStatus(); renderExact(); } });
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
      wakeMuteBeep: f.wakeMute.checked,
      listenOnOpen: f.listenOpen.checked,
      briefing: readBriefing(),
      evening: readEvening(),
      weekly: readWeekly(),
      memoryToAI: m.ai.checked,
      prefs: { antwortlaenge: m.len.value, anrede: m.anrede.value, humor: m.humor.value }
    });
    const persona = savePersona(store, currentPersonaFromForm());
    toast('Gespeichert.');
    onSaved({ settings, persona });
  });

  // ---------- v0.9: Werkzeuge & Berechtigungen – „Wecker & Erinnerungen“ (genaue Alarme) ----------
  const rem = device?.reminders || null;
  const EXACT_TEXT = {
    granted: '✅ Genaue Erinnerungen: erlaubt.',
    denied: '⚠️ Genaue Erinnerungen: nicht freigegeben – Erinnerungen kommen ungefähr pünktlich.',
    unknown: 'Genaue Erinnerungen: Status unbekannt.'
  };
  async function renderExact() {
    const el = $('#exact-status');
    if (!el) return;
    if (!rem?.exactStatus) { el.textContent = ''; return; }
    const r = await rem.exactStatus();
    el.textContent = EXACT_TEXT[r?.exact] || EXACT_TEXT.unknown;
    $('#btn-exact')?.classList.toggle('hidden', r?.exact === 'granted');
  }
  $('#btn-exact')?.addEventListener('click', async () => {
    if (rem?.openExactSettings) await rem.openExactSettings();
    setTimeout(renderExact, 800);
  });

  // ---------- v0.9 Stufe 0: Schnell fragen (Anleitung + Kachel/Verknüpfung) ----------
  const listenStatus = (t) => { $('#listen-status').textContent = t || ''; };
  $('#listen-guide-list').replaceChildren(...LISTEN_GUIDE.map((g) => {
    const li = document.createElement('li');
    li.dataset.guide = g.id;
    const b = document.createElement('strong');
    b.textContent = g.title + ': ';
    li.append(b, document.createTextNode(g.text));
    return li;
  }));
  const ll = device?.listenLaunch || null;
  $('#btn-listen-tile')?.addEventListener('click', async () => {
    const r = ll ? await ll.addTile() : null;
    listenStatus(r?.ok ? 'Bitte im System-Dialog „Kachel hinzufügen“ bestätigen.'
      : 'Bitte von Hand: zweimal von oben wischen → ✏️ → „Jarvis fragen“ in die Kacheln ziehen.');
  });
  $('#btn-listen-pin')?.addEventListener('click', async () => {
    const r = ll ? await ll.pinShortcut() : null;
    listenStatus(r?.ok ? 'Bitte im Dialog „Hinzufügen“ bestätigen.' : (r?.message || 'Lange auf das Jarvis-Symbol tippen und „Jarvis fragen“ herausziehen.'));
  });

  // ---------- Gedächtnis ----------
  const m = {
    ai: $('#set-mem-ai'), add: $('#mem-new'), status: $('#mem-status'), list: $('#mem-list'),
    importText: $('#mem-import'),
    len: $('#set-pref-len'), anrede: $('#set-pref-anrede'), humor: $('#set-pref-humor')
  };
  const memStatus = (t) => { m.status.textContent = t || ''; };
  function fillPrefSelect(sel, key, value) {
    sel.textContent = '';
    for (const v of PREF_OPTIONS[key]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = PREF_LABELS[key][v];
      sel.append(o);
    }
    sel.value = value;
  }
  function memButton(label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `btn ${cls || ''}`.trim(); b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }
  /** Liste neu zeichnen – nur textContent, nie HTML. */
  function renderMemory() {
    const items = [...loadMemory(store).items].sort((a, b) =>
      (b.angeheftet - a.angeheftet) || String(b.geaendert).localeCompare(String(a.geaendert)));
    m.list.textContent = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = 'Noch leer.';
      m.list.append(li);
    }
    for (const it of items) {
      const li = document.createElement('li');
      li.className = 'mem-item';
      li.dataset.id = it.id;
      const text = document.createElement('div');
      text.className = 'mem-text';
      const t = document.createElement('span');
      t.textContent = (it.angeheftet ? '📌 ' : '') + it.text;
      const meta = document.createElement('div');
      meta.className = 'mem-meta';
      meta.textContent = `${KATEGORIE_LABELS[it.kategorie] || it.kategorie} · ${new Date(it.erstellt).toLocaleDateString('de-DE')}`;
      text.append(t, meta);
      const edit = memButton('Bearbeiten', 'mem-btn-edit', () => {
        const inp = document.createElement('input');
        inp.type = 'text'; inp.maxLength = 200; inp.value = it.text; inp.className = 'mem-edit';
        const save = memButton('OK', 'primary mem-btn-save', () => {
          const r = updateMemory(store, it.id, { text: inp.value });
          memStatus(r.ok ? 'Geändert.' : r.message);
          renderMemory();
        });
        li.textContent = '';
        li.append(inp, save, memButton('Abbrechen', '', renderMemory));
        inp.focus();
      });
      const pin = memButton(it.angeheftet ? 'Lösen' : 'Anheften', 'mem-btn-pin', () => {
        updateMemory(store, it.id, { angeheftet: !it.angeheftet });
        renderMemory();
      });
      const del = memButton('Löschen', 'danger mem-btn-del', () => {
        removeMemory(store, it.id);
        memStatus(`Gelöscht: ${it.text}`);
        renderMemory();
      });
      li.append(text, edit, pin, del);
      m.list.append(li);
    }
  }
  function fillMemory(st) {
    m.ai.checked = st.memoryToAI;
    fillPrefSelect(m.len, 'antwortlaenge', st.prefs.antwortlaenge);
    fillPrefSelect(m.anrede, 'anrede', st.prefs.anrede);
    fillPrefSelect(m.humor, 'humor', st.prefs.humor);
    memStatus('');
    renderMemory();
  }
  const addFromField = () => {
    const r = addMemory(store, m.add.value, { quelle: 'einstellungen' });
    memStatus(r.message);
    if (r.ok) m.add.value = '';
    renderMemory();
  };
  $('#btn-mem-add').addEventListener('click', addFromField);
  m.add.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addFromField(); } });
  $('#btn-mem-migrate').addEventListener('click', () => {
    const n = loadNotes(store).length;
    if (!n) { memStatus('Es gibt keine Notizen zum Übernehmen.'); return; }
    if (!confirm(`${n} Notiz(en) ins Gedächtnis übernehmen? Übernommene Notizen werden aus den Notizen entfernt.`)) return;
    const r = migrateNotes(store);
    memStatus(`${r.moved} übernommen${r.skipped ? `, ${r.skipped} blieben Notizen (doppelt, zu lang oder sensibel)` : ''}.`);
    renderMemory();
  });
  $('#btn-mem-export').addEventListener('click', async () => {
    const json = exportMemory(store);
    const r = device?.copyText ? await device.copyText(json) : { ok: false };
    if (r?.ok) memStatus('In die Zwischenablage kopiert.');
    else { m.importText.value = json; $('#mem-import-box').open = true; memStatus('Kopieren ging nicht – der Export steht im Feld unten.'); }
  });
  $('#btn-mem-import').addEventListener('click', () => {
    const r = importMemory(store, m.importText.value);
    memStatus(r.message);
    if (r.ok) m.importText.value = '';
    renderMemory();
  });
  $('#btn-mem-clear').addEventListener('click', () => {
    const n = loadMemory(store).items.length;
    if (!n) { memStatus('Das Gedächtnis ist schon leer.'); return; }
    if (!confirm(`Alle ${n} Einträge im Gedächtnis löschen? Notizen bleiben erhalten.`)) return;
    clearMemory(store);
    memStatus('Gedächtnis gelöscht.');
    renderMemory();
  });

  tts.onVoicesChanged(() => { if (!$('#view-settings').classList.contains('hidden')) refreshVoices(); });

  return { fill, refreshMemory: renderMemory };
}
