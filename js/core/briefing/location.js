// Ort für das Wetter: aktueller (grober) Standort, sonst kurzzeitig der zuletzt bekannte.
import { loadBriefingState, saveBriefingState, rateCachedCoords, roundCoord } from './state.js';

/**
 * → { coords:{lat,lon}|null, stale:boolean, source:'live'|'cache'|null, reason?:'denied'|'unavailable'|'unsupported' }
 * ctx.interactive=false (automatisches Briefing) → nie nach der Erlaubnis fragen.
 */
export async function resolveCoords(ctx) {
  const nowMs = ctx.now instanceof Date ? ctx.now.getTime() : Date.now();
  const tz = ctx.timeZone;
  const interactive = ctx.interactive !== false;
  let reason = 'unsupported';
  const dev = ctx.device;
  if (dev?.getCoarseLocation) {
    let r = null;
    try { r = await dev.getCoarseLocation({ interactive }); } catch { r = null; }
    if (r?.ok && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) {
      const coords = { lat: roundCoord(r.latitude), lon: roundCoord(r.longitude), at: nowMs, tz: tz || null };
      if (ctx.store) saveBriefingState(ctx.store, { coords });
      return { coords, stale: false, source: 'live' };
    }
    reason = r?.denied ? 'denied' : 'unavailable';
  }
  const st = ctx.store ? loadBriefingState(ctx.store) : {};
  const rating = rateCachedCoords(st.coords, nowMs, tz);
  if (rating) return { coords: st.coords, stale: rating === 'stale', source: 'cache' };
  return { coords: null, stale: false, source: null, reason };
}
