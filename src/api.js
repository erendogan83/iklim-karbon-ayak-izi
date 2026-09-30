// Katılımcı sonucunu sunucuya gönderir. Yalnızca HAM girdi gönderilir; mesafe, faktör ve toplamı
// veritabanındaki submit_carbon() hesaplar. supabase-js ilk gönderimde yüklenir (form hızlı açılsın).

export function newSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export class SubmitError extends Error {
  constructor(code, cause) { super(code); this.code = code; this.cause = cause; }
}

const TIMEOUT_MS = 12000;

export async function submitCarbon(sessionId, { city, mode, subtype, occupancy, hotelNights, roomOccupancy }) {
  const { supabase } = await import('./supabase.js');
  if (!supabase) throw new SubmitError('not_configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const { data, error } = await supabase
      .rpc('submit_carbon', {
        p_session_id: sessionId, p_city: city, p_mode: mode, p_subtype: subtype,
        p_occupancy: occupancy, p_hotel_nights: hotelNights, p_room_occupancy: roomOccupancy,
      })
      .abortSignal(ctrl.signal);
    if (error) throw new SubmitError(/submissions_closed/.test(error.message) ? 'submissions_closed' : 'rejected', error);
    return data;
  } catch (e) {
    if (e instanceof SubmitError) throw e;
    throw new SubmitError(ctrl.signal.aborted ? 'timeout' : 'network', e);
  } finally {
    clearTimeout(timer);
  }
}

export function saveErrorMessage(code) {
  if (code === 'submissions_closed') return 'Bu form şu anda yeni yanıt kabul etmiyor. Hesabınız tamamlandı ancak sonuç sunucuya kaydedilmedi.';
  return 'Hesabınız tamamlandı ancak sonuç sunucuya kaydedilemedi.';
}
