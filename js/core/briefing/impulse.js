// Morgen-Impuls (v0.9.5): ein Satz Motivation oder ein kurioser Fakt am Ende des Morgen-Briefings.
// Lokale, mitgelieferte Liste (kein Netz). Keine Wiederholung, bis alle einmal dran waren; am selben Tag derselbe Satz.
// Platzierung: direkt VOR der abschließenden Rückfrage – die Rückfrage („Soll ich Ihnen mehr zu … sagen?“) bleibt der letzte Satz,
// damit ein „Ja“ weiterhin die Nachfrage beantwortet.

/** k: 'fact' (kurioser Fakt) oder 'mind' (Gedanke für den Tag). Ohne Schlusspunkt. */
export const IMPULSES = Object.freeze([
  // Kuriose Fakten
  { k: 'fact', t: 'Ein Oktopus hat drei Herzen und blaues Blut' },
  { k: 'fact', t: 'Honig verdirbt praktisch nie – in ägyptischen Gräbern fand man jahrtausendealten Honig, der noch nicht verdorben war' },
  { k: 'fact', t: 'Seeotter halten sich beim Schlafen manchmal an den Pfoten, damit sie nicht voneinander wegtreiben' },
  { k: 'fact', t: 'Der Eiffelturm ist im Sommer durch die Wärme bis zu etwa 15 Zentimeter höher als im Winter' },
  { k: 'fact', t: 'Bananen sind botanisch gesehen Beeren, Erdbeeren dagegen nicht' },
  { k: 'fact', t: 'Ein Tag auf der Venus dauert länger als ein ganzes Venusjahr' },
  { k: 'fact', t: 'Ein Blitz ist etwa fünfmal heißer als die Oberfläche der Sonne' },
  { k: 'fact', t: 'Kolibris können als einzige Vögel auch rückwärts fliegen' },
  { k: 'fact', t: 'Das Wort „Kindergarten“ hat das Englische direkt aus dem Deutschen übernommen' },
  { k: 'fact', t: 'Faultiere können unter Wasser bis zu 40 Minuten die Luft anhalten' },
  { k: 'fact', t: 'Der Bodensee grenzt an drei Länder: Deutschland, Österreich und die Schweiz' },
  { k: 'fact', t: 'Die Zugspitze ist mit 2962 Metern der höchste Berg Deutschlands' },
  { k: 'fact', t: 'Ein Mensch blinzelt etwa 15- bis 20-mal pro Minute' },
  { k: 'fact', t: 'Pinguine leben fast ausschließlich auf der Südhalbkugel' },
  { k: 'fact', t: 'Das Sonnenlicht braucht gut acht Minuten bis zur Erde' },
  { k: 'fact', t: 'Der Kölner Dom war nach seiner Fertigstellung 1880 für einige Jahre das höchste Gebäude der Welt' },
  { k: 'fact', t: 'Giraffen haben genauso viele Halswirbel wie Menschen, nämlich sieben' },
  { k: 'fact', t: 'Erdnüsse sind botanisch keine Nüsse, sondern Hülsenfrüchte' },
  { k: 'fact', t: 'Die Gummibärchen wurden 1922 in Bonn erfunden' },
  { k: 'fact', t: 'Johannes Gutenberg entwickelte um 1450 in Mainz den Buchdruck mit beweglichen Lettern' },
  { k: 'fact', t: 'Elefanten können nicht springen' },
  { k: 'fact', t: 'Das Auge eines Straußes ist größer als sein Gehirn' },
  { k: 'fact', t: 'Wombats hinterlassen würfelförmigen Kot' },
  { k: 'fact', t: 'Die Erde ist keine perfekte Kugel – am Äquator ist sie etwas breiter als von Pol zu Pol' },
  { k: 'fact', t: 'Auf dem Mond bleiben Fußspuren sehr lange erhalten, weil es dort keinen Wind gibt' },
  { k: 'fact', t: 'Krähen können sich die Gesichter einzelner Menschen merken' },
  { k: 'fact', t: 'Honigbienen zeigen einander mit einem Schwänzeltanz, in welcher Richtung und Entfernung es Futter gibt' },
  { k: 'fact', t: 'Der Mount Everest wächst durch die Bewegung der Erdplatten jedes Jahr um wenige Millimeter' },
  { k: 'fact', t: 'Das Wort „Roboter“ stammt aus dem Tschechischen' },
  { k: 'fact', t: 'Haie gab es schon, bevor es die ersten Bäume gab' },
  { k: 'fact', t: 'Ein Jahr auf dem Merkur dauert nur 88 Erdtage' },
  { k: 'fact', t: 'Der Rhein ist rund 1230 Kilometer lang und einer der längsten Flüsse Europas' },
  { k: 'fact', t: 'Schmetterlinge schmecken mit ihren Füßen' },
  { k: 'fact', t: 'Ein Schneckenhaus wächst mit seiner Schnecke ein Leben lang mit' },
  { k: 'fact', t: 'Ein Teelöffel Erde enthält mehr Lebewesen, als es Menschen auf der Welt gibt' },
  { k: 'fact', t: 'Delfine geben einander Namen in Form eigener Pfeiflaute' },
  // Gedanken für den Tag
  { k: 'mind', t: 'Ein kleiner Schritt heute ist mehr wert als ein großer Plan für irgendwann' },
  { k: 'mind', t: 'Sie müssen heute nicht alles schaffen – nur das Wichtigste' },
  { k: 'mind', t: 'Beginnen Sie mit der Aufgabe, die Sie am liebsten aufschieben würden; danach wird der Tag leichter' },
  { k: 'mind', t: 'Freundlichkeit kostet nichts und macht oft zwei Menschen den Tag schöner' },
  { k: 'mind', t: 'Eine kurze Pause macht Sie nicht langsamer, sondern klarer' },
  { k: 'mind', t: 'Fortschritt zählt mehr als Perfektion' },
  { k: 'mind', t: 'Was Sie heute lernen, nimmt Ihnen niemand mehr weg' },
  { k: 'mind', t: 'Ein Glas Wasser und ein paar Minuten frische Luft wirken oft kleine Wunder' },
  { k: 'mind', t: 'Manchmal ist „gut genug“ genau richtig' },
  { k: 'mind', t: 'Feiern Sie heute auch die kleinen Erfolge' },
  { k: 'mind', t: 'Eine Aufgabe nach der anderen – so wird auch ein voller Tag überschaubar' },
  { k: 'mind', t: 'Wer geduldig mit sich selbst ist, kommt oft weiter' },
  { k: 'mind', t: 'Heute ist ein guter Tag, um jemandem Danke zu sagen' },
  { k: 'mind', t: 'Neugier ist der beste Wecker für den Kopf' },
  { k: 'mind', t: 'Sie haben schon schwierigere Tage gemeistert als diesen' },
  { k: 'mind', t: 'Planen Sie heute auch etwas ein, worauf Sie sich freuen können' },
  { k: 'mind', t: 'Ordnung beginnt mit einer einzigen freien Fläche auf dem Tisch' },
  { k: 'mind', t: 'Um Hilfe zu bitten ist ein Zeichen von Stärke' },
  { k: 'mind', t: 'Zehn Minuten Bewegung sind besser als gar keine' },
  { k: 'mind', t: 'Gute Gewohnheiten entstehen durch Wiederholung, nicht durch Perfektion' },
  { k: 'mind', t: 'Ein Spaziergang in der Mittagspause kann den ganzen Nachmittag verändern' },
  { k: 'mind', t: 'Nehmen Sie sich heute einen Moment, um tief durchzuatmen' },
  { k: 'mind', t: 'Es ist nie zu spät, etwas Neues anzufangen' },
  { k: 'mind', t: 'Ein aufgeräumter Gedanke ist oft mehr wert als ein voller Kalender' }
]);

const LEAD = { fact: 'Übrigens: ', mind: 'Und ein Gedanke für heute: ' };

/** Satz zum Vorlesen, z. B. „Übrigens: Elefanten können nicht springen.“ */
export function impulseSentence(i) {
  const e = typeof i === 'number' ? IMPULSES[i] : i;
  if (!e?.t) return '';
  return `${LEAD[e.k] || LEAD.mind}${e.t}.`;
}

function shuffle(n, rnd, avoidFirst) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1)) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (n > 1 && a[0] === avoidFirst) [a[0], a[1]] = [a[1], a[0]]; // keine Wiederholung über die Rundengrenze
  return a;
}

/**
 * Impuls für einen Tag wählen. state: { n, order, pos, day, idx } (gespeichert unter 'impulse').
 * Gleicher Tag → gleicher Satz. Neue Runde (neu gemischt) erst, wenn alle einmal dran waren.
 * → { index, text, state }
 */
export function pickImpulse(state, day, { rnd = Math.random, n = IMPULSES.length } = {}) {
  const s = state && typeof state === 'object' ? state : {};
  if (s.day === day && Number.isInteger(s.idx) && s.idx >= 0 && s.idx < n && s.n === n) {
    return { index: s.idx, text: impulseSentence(s.idx), state: s };
  }
  let order = Array.isArray(s.order) && s.n === n && s.order.length === n ? s.order : null;
  let pos = Number.isInteger(s.pos) ? s.pos : 0;
  if (!order || pos >= n || pos < 0) { order = shuffle(n, rnd, order ? order[n - 1] : s.idx); pos = 0; }
  const idx = order[pos];
  const next = { n, order, pos: pos + 1, day, idx };
  return { index: idx, text: impulseSentence(idx), state: next };
}

// Satzgrenze: Satzzeichen, Leerraum, dann ein Großbuchstabe/Anführungszeichen; keine Einzelbuchstaben-Abkürzung („z. B.“)
const BOUNDARY = /(?<![\s.][A-Za-zÄÖÜäöü])[.!?…]["“”»«)]?\s+(?=[A-ZÄÖÜ„"»«])/g;

/** Index, an dem der letzte Satz beginnt (0 = nur ein Satz). */
export function lastSentenceStart(text) {
  let p = 0;
  for (const m of String(text).matchAll(BOUNDARY)) p = m.index + m[0].length;
  return p;
}

/** Impuls einfügen: vor die abschließende Rückfrage; endet der Text nicht mit einer Frage, ans Ende. */
export function insertImpulse(text, impulse) {
  const t = String(text || '').trim();
  if (!impulse) return t;
  if (!t) return impulse;
  const p = lastSentenceStart(t);
  const tail = t.slice(p);
  if (tail.endsWith('?')) return `${t.slice(0, p)}${impulse} ${tail}`;
  return `${t} ${impulse}`;
}

/**
 * Für das gestreamte KI-Briefing: reicht Text satzweise weiter, hält aber den jeweils letzten Satz zurück,
 * damit der Impuls am Ende vor die Rückfrage passt. finish(finalText) gibt den Rest aus und liefert den Endtext.
 */
export function createImpulseRelay(relay, impulse) {
  let full = '';
  let sent = 0;
  return {
    push(d) {
      if (d.type === 'reset') { full = ''; sent = 0; relay(d); return; }
      if (d.type !== 'text') { relay(d); return; }
      full += d.text;
      if (!sent) full = full.replace(/^\s+/, '');
      const p = lastSentenceStart(full);
      if (p > sent) { relay({ type: 'text', text: full.slice(sent, p) }); sent = p; }
    },
    finish(finalText) {
      const out = insertImpulse(finalText, impulse);
      const head = full.slice(0, sent);
      if (sent && out.startsWith(head)) {
        if (out.length > sent) relay({ type: 'text', text: out.slice(sent) });
      } else {
        if (sent) relay({ type: 'reset' });
        relay({ type: 'text', text: out });
      }
      return out;
    }
  };
}

/** „Morgen-Impuls aus/an“ → { enabled } oder null */
export function impulseToggle(text, normalize) {
  const t = normalize(text);
  const subj = '(?:den |der |mein(?:en)? )?(?:morgen ?)?impuls(?: im briefing)?';
  if (new RegExp(`^${subj} (?:bitte )?(?:aus|ausschalten|abschalten|weglassen|deaktivieren)$|^(?:schalte?|mach) ${subj} aus$|^kein(?:en)? (?:morgen ?)?impuls mehr$`).test(t)) return { enabled: false };
  if (new RegExp(`^${subj} (?:bitte )?(?:wieder )?(?:an|ein|einschalten|aktivieren)$|^(?:schalte?|mach) ${subj} (?:wieder )?(?:an|ein)$`).test(t)) return { enabled: true };
  return null;
}
