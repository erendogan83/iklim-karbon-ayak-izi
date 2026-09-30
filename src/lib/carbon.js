// Saf hesap modülü (DOM/ağ yok). Sunucudaki public.submit_carbon() ile aynı formülü uygular:
//   toplam_km = tek yön km × 2
//   özel araç: toplam_km × faktör / araç doluluğu ; diğerleri: toplam_km × faktör
//   konaklama: gece × 32,1 / oda doluluğu
// Sunucu sonucu esas alınır; bu modül anlık gösterim ve sunucuya ulaşılamazsa yedek hesap içindir.
import { FACTOR_BY_KEY } from '../data/factors.js';
import { CITY_DATA } from '../data/cities.js';

export const DESTINATION = 'Gaziantep';
export const HOTEL_KEY = 'Konaklama|Türkiye oteli';
export const LIMITS = {
  occupancy: { min: 1, max: 8 },
  hotelNights: { min: 0, max: 10 },
  roomOccupancy: { min: 1, max: 4 },
};

export const CITIES = CITY_DATA.map((c) => c.name);
const CITY_BY_NAME = new Map(CITY_DATA.map((c) => [c.name, c]));

const round4 = (x) => Math.round(x * 1e4) / 1e4;
const clampInt = (v, { min, max }) => Math.min(max, Math.max(min, Math.trunc(Number(v))));

export class CarbonInputError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function getFactor(mode, subtype) {
  return FACTOR_BY_KEY[`${mode}|${subtype}`] ?? null;
}

export const DISTANCE_LIMITS = { min: 0, max: 3000 };

// Yaya/bisiklet: 0. Uçak: ilden kuş uçuşu. Diğerleri: katılımcı km girdiyse o (0–3000), yoksa ilden karayolu.
export function oneWayDistanceKm(city, mode, override = null) {
  const c = CITY_BY_NAME.get(city);
  if (!c) throw new CarbonInputError('invalid_city');
  if (mode === 'Yaya' || mode === 'Bisiklet') return 0;
  if (mode === 'Uçak') return c.airKm;
  if (override !== null && override !== undefined && override !== '') {
    const n = Number(override);
    if (!Number.isFinite(n) || n < DISTANCE_LIMITS.min || n > DISTANCE_LIMITS.max) throw new CarbonInputError('invalid_distance');
    return Math.round(n * 10) / 10;
  }
  return c.roadKm;
}

// Excel "Katılımcı Hesabı" formülünün doğrudan karşılığı (mesafe dışarıdan verilir).
export function computeEmissions({ mode, subtype, oneWayKm, occupancy = 1, hotelNights = 0, roomOccupancy = 1 }) {
  const factor = getFactor(mode, subtype);
  if (!factor || factor.category !== 'Ulaşım') throw new CarbonInputError('invalid_mode_subtype');
  const totalKm = oneWayKm * 2;
  const occ = mode === 'Özel araç' ? Math.max(Number(occupancy), 1) : 1;
  const transport = mode === 'Özel araç' ? (totalKm * factor.factor) / occ : totalKm * factor.factor;
  const nights = Number(hotelNights);
  const room = Math.max(Number(roomOccupancy), 1);
  const accommodation = nights > 0 ? (nights * FACTOR_BY_KEY[HOTEL_KEY].factor) / room : 0;
  return { transport_kg: round4(transport), accommodation_kg: round4(accommodation), total_kg: round4(transport + accommodation) };
}

// Form girdisinden tam sonuç. Sunucu ile aynı sınırları/normalleştirmeyi uygular.
export function calculate({ city, mode, subtype, occupancy = 1, hotelNights = 0, roomOccupancy = 1, distanceKm = null }) {
  const oneWayKm = oneWayDistanceKm(city, mode, distanceKm);
  const userDistance = distanceKm !== null && distanceKm !== undefined && distanceKm !== '' && mode !== 'Yaya' && mode !== 'Bisiklet' && mode !== 'Uçak';
  const occ = mode === 'Özel araç' ? clampInt(occupancy, LIMITS.occupancy) : 1;
  const nights = clampInt(hotelNights, LIMITS.hotelNights);
  const room = nights > 0 ? clampInt(roomOccupancy, LIMITS.roomOccupancy) : 1;
  const e = computeEmissions({ mode, subtype, oneWayKm, occupancy: occ, hotelNights: nights, roomOccupancy: room });
  return { city, mode, subtype, distance_km: oneWayKm, distance_source: userDistance ? 'user' : 'city', occupancy: occ, hotel_nights: nights, room_occupancy: room, ...e };
}
