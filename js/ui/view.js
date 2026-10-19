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
