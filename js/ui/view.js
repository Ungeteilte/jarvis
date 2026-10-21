// DOM-Hilfsfunktionen der Hauptansicht (nur Anzeige, keine Logik).
export const $ = (sel) => document.querySelector(sel);

const els = () => ({
  chat: $('#chat'), orb: $('#orb'), status: $('#status'), brand: $('#brand'),
  input: $('#input'), mic: $('#btn-mic'), mute: $('#btn-mute'), wake: $('#btn-wake'), timerChip: $('#timer-chip')
});

let assistantName = 'Jarvis';

export function setOrbState(state) {
  els().orb.dataset.state = state;
}

export function setStatus(text) {
  els().status.textContent = text;
}

/** Name überall in der Oberfläche anzeigen. */
export function applyName(name) {
  assistantName = name;
  const e = els();
  e.brand.textContent = name.toUpperCase();
  e.input.placeholder = `Frag ${name} etwas …`;
  document.title = name;
  document.querySelectorAll('.name-ref').forEach((n) => { n.textContent = name; });
  document.querySelectorAll('.msg.assistant .who').forEach((n) => { n.textContent = name; });
  updateWakeChip(e.wake.getAttribute('aria-pressed') === 'true');
}

export function addMessage(msg) {
  const chat = els().chat;
  const div = document.createElement('div');
  div.className = `msg ${msg.role}${msg.error ? ' error' : ''}`;
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = msg.role === 'user' ? 'Sie' : assistantName;
  const body = document.createElement('span');
  body.textContent = msg.text; // textContent → kein HTML-Einschleusen möglich
  div.append(who, body);
  chat.append(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

/**
 * Wachsende Antwort-Blase für gestreamte Antworten.
 * append(text) hängt an, reset() leert, finish(msg) ersetzt durch Endtext.
 */
export function addStreamingMessage() {
  const chat = els().chat;
  const div = addMessage({ role: 'assistant', text: '' });
  div.classList.add('streaming');
  const body = div.lastElementChild;
  let text = '';
  const stickToBottom = () => {
    if (chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120) chat.scrollTop = chat.scrollHeight;
  };
  return {
    el: div,
    get text() { return text; },
    append(t) { text += t; body.textContent = text; stickToBottom(); },
    reset() { text = ''; body.textContent = ''; },
    finish(msg) {
      div.classList.remove('streaming');
      if (msg) {
        text = msg.text;
        body.textContent = msg.text;
        div.classList.toggle('error', Boolean(msg.error));
      }
      chat.scrollTop = chat.scrollHeight;
    },
    remove() { div.remove(); }
  };
}

export function renderHistory(history) {
  els().chat.replaceChildren();
  history.forEach(addMessage);
}

export function showTyping() {
  const div = addMessage({ role: 'assistant', text: 'denkt nach …' });
  div.classList.add('typing');
  return () => div.remove();
}

export function setMicActive(active) {
  els().mic.classList.toggle('active', active);
}

export function updateMute(speakOn) {
  const b = els().mute;
  b.textContent = speakOn ? '🔊' : '🔇';
  b.setAttribute('aria-pressed', String(!speakOn));
}

export function updateWakeChip(on) {
  const b = els().wake;
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? `👂 „Hey ${assistantName}“: an` : '👂 Wake-Word: aus';
}

export function updateTimerChip(list, format) {
  const chip = els().timerChip;
  if (!list.length) { chip.classList.add('hidden'); return; }
  chip.classList.remove('hidden');
  const next = list.reduce((a, b) => (a.remainingMs < b.remainingMs ? a : b));
  const s = Math.ceil(next.remainingMs / 1000);
  const mmss = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  chip.textContent = `⏱ ${mmss}${list.length > 1 ? ` (+${list.length - 1})` : ''}`;
  chip.title = format(next.remainingMs);
}

export function toast(text, ms = 3500) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Zeigt den Hinweis, wo es den Schlüssel gibt (mit Link). */
export function renderKeyHint(el, provider) {
  el.replaceChildren();
  if (!provider) return;
  el.append(document.createTextNode(provider.keyHint || ''));
  if (provider.keyUrl) {
    const a = document.createElement('a');
    a.href = provider.keyUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = ' → Schlüssel holen';
    el.append(a);
  }
}

/** Füllt ein <select> mit Stimmen (deutsche zuerst). */
export function fillVoiceSelect(select, voices, selectedId) {
  const auto = select.options[0];
  select.replaceChildren(auto);
  const de = voices.filter((v) => /^de/i.test(v.lang));
  const other = voices.filter((v) => !/^de/i.test(v.lang));
  for (const [label, group] of [['Deutsch', de], ['Andere Sprachen', other]]) {
    if (!group.length) continue;
    const og = document.createElement('optgroup');
    og.label = label;
    group.forEach((v) => og.append(new Option(`${v.name} (${v.lang})`, v.id)));
    select.append(og);
  }
  select.value = voices.some((v) => v.id === selectedId) ? selectedId : '';
}


/**
 * Bestätigungskarte (Ja/Nein) im Chat. onYes/onNo werden einmal aufgerufen.
 * Mit choices (v0.9, z. B. mehrere passende Apps): ein Knopf je Auswahl + „Abbrechen“; onChoose(index).
 */
export function addConfirmCard({ title, detail, choices }, { onYes, onNo, onChoose }) {
  const chat = els().chat;
  const div = document.createElement('div');
  div.className = 'msg assistant confirm-card';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = assistantName;
  const body = document.createElement('div');
  body.className = 'confirm-body';
  const h = document.createElement('strong');
  h.textContent = title || 'Fortfahren?';
  body.append(h);
  if (detail) {
    const d = document.createElement('div');
    d.className = 'confirm-detail';
    d.textContent = detail;
    body.append(d);
  }
  const row = document.createElement('div');
  row.className = 'confirm-actions';
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'btn primary confirm-yes';
  yes.textContent = 'Ja';
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'btn confirm-no';
  no.textContent = 'Nein';
  const buttons = [yes, no];
  const done = (fn) => {
    for (const b of buttons) b.disabled = true;
    div.classList.add('confirm-done');
    fn?.();
  };
  div.closeCard = () => done(null); // per Sprache („Ja“/„Nein“/„die erste“) erledigt
  if (Array.isArray(choices) && choices.length) {
    div.classList.add('choice-card');
    row.classList.add('choice-actions');
    buttons.length = 0;
    choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn primary confirm-choice';
      b.dataset.index = String(i);
      b.textContent = `${i + 1}. ${c.label}`;
      if (c.detail) b.title = c.detail;
      b.addEventListener('click', () => done(() => onChoose?.(i)));
      buttons.push(b);
      row.append(b);
    });
    no.textContent = 'Abbrechen';
    buttons.push(no);
    no.addEventListener('click', () => done(onNo));
    row.append(no);
  } else {
    yes.addEventListener('click', () => done(onYes));
    no.addEventListener('click', () => done(onNo));
    row.append(yes, no);
  }
  body.append(row);
  div.append(who, body);
  chat.append(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

/**
 * Karte mit einem Start-Knopf (z. B. „Guten Morgen – Tippen zum Starten“).
 * Der Tipp ist zugleich die Nutzer-Geste, die der Browser fürs Vorlesen verlangt.
 */
export function addStartCard({ title, detail, button = '▶ Starten', id = '' }, onStart) {
  const chat = els().chat;
  if (id && document.getElementById(id)) document.getElementById(id).remove();
  const div = document.createElement('div');
  div.className = 'msg assistant confirm-card start-card';
  if (id) div.id = id;
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = assistantName;
  const body = document.createElement('div');
  body.className = 'confirm-body';
  const h = document.createElement('strong');
  h.textContent = title;
  body.append(h);
  if (detail) {
    const d = document.createElement('div');
    d.className = 'confirm-detail';
    d.textContent = detail;
    body.append(d);
  }
  const row = document.createElement('div');
  row.className = 'confirm-actions';
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn primary start-go';
  go.textContent = button;
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'btn start-later';
  later.textContent = 'Später';
  const done = () => { go.disabled = later.disabled = true; div.classList.add('confirm-done'); };
  go.addEventListener('click', () => { done(); div.remove(); onStart?.(); });
  later.addEventListener('click', () => { done(); div.remove(); });
  row.append(go, later);
  body.append(row);
  div.append(who, body);
  chat.append(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}
