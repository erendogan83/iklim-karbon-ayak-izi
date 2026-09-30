// Hesap modülü testleri. "Excel" beklenen değerleri, Etkinlik KArbon Ayak İzi.xlsx formüllerinin
// (Katılımcı Hesabı!F:N) birebir çalıştırılmasıyla elde edilmiştir (17 senaryo, fark 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, computeEmissions, CITIES, CarbonInputError } from '../src/lib/carbon.js';
import { CITY_DATA } from '../src/data/cities.js';
import { EMISSION_FACTORS } from '../src/data/factors.js';

// Sonuçlar 4 ondalığa yuvarlanır (en fazla 5e-5 fark).
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 6e-5, `${msg ?? ''} beklenen ${b}, gelen ${a}`);

const EXCEL_CASES = [
  // [ad, girdi, oneWayKm, ulaşım, konaklama, toplam]
  ['T1 Yaya 0 gece', { mode: 'Yaya', subtype: 'Varsayılan' }, 0, 0, 0, 0],
  ['T2 Özel araç benzinli 2 kişi', { mode: 'Özel araç', subtype: 'Benzinli', occupancy: 2 }, 1130, 182.5176, 0, 182.5176],
  ['T3 Elektrikli 4 kişi 2 gece 2/oda', { mode: 'Özel araç', subtype: 'Elektrikli', occupancy: 4, hotelNights: 2, roomOccupancy: 2 }, 660, 27.8586, 32.1, 59.9586],
  ['T4 Uçak iç hat', { mode: 'Uçak', subtype: 'İç hat - ortalama' }, 1000, 458.56, 0, 458.56],
  ['T5 0 gece, bayat oda=3', { mode: 'Yaya', subtype: 'Varsayılan', hotelNights: 0, roomOccupancy: 3 }, 0, 0, 0, 0],
  ['T6 2 gece 3/oda', { mode: 'Yaya', subtype: 'Varsayılan', hotelNights: 2, roomOccupancy: 3 }, 0, 0, 21.4, 21.4],
  ['Otobüs şehirler arası + 1 gece', { mode: 'Otobüs', subtype: 'Şehirler arası', hotelNights: 1 }, 500, 39.48, 32.1, 71.58],
  ['Otobüs şehir içi', { mode: 'Otobüs', subtype: 'Şehir içi' }, 20, 4.0604, 0, 4.0604],
  ['Servis', { mode: 'Servis/Minibüs', subtype: 'Otobüs vekil faktörü' }, 80, 6.3168, 0, 6.3168],
  ['Tren', { mode: 'Tren', subtype: 'Ulusal demiryolu' }, 700, 43.288, 0, 43.288],
  ['Tramvay/Metro', { mode: 'Tramvay/Metro', subtype: 'Hafif raylı' }, 15, 0.6363, 0, 0.6363],
  ['Taksi', { mode: 'Taksi', subtype: 'Standart' }, 40, 11.8888, 0, 11.8888],
  ['Motosiklet', { mode: 'Motosiklet', subtype: 'Ortalama' }, 300, 68.202, 0, 68.202],
  ['Bisiklet', { mode: 'Bisiklet', subtype: 'Varsayılan' }, 0, 0, 0, 0],
  ['Dizel 3 kişi 10 gece 4/oda', { mode: 'Özel araç', subtype: 'Dizel', occupancy: 3, hotelNights: 10, roomOccupancy: 4 }, 420, 48.342, 80.25, 128.592],
  ['Hibrit', { mode: 'Özel araç', subtype: 'Hibrit' }, 250, 64.805, 0, 64.805],
  ['Bilinmiyor 5 kişi', { mode: 'Özel araç', subtype: 'Bilinmiyor', occupancy: 5 }, 250, 16.591, 0, 16.591],
];

for (const [name, input, km, t, a, total] of EXCEL_CASES) {
  test(`Excel ile aynı: ${name}`, () => {
    const r = computeEmissions({ ...input, oneWayKm: km });
    close(r.transport_kg, t, 'ulaşım');
    close(r.accommodation_kg, a, 'konaklama');
    close(r.total_kg, total, 'toplam');
  });
}

test('81 il, benzersiz, Gaziantep 0 km', () => {
  assert.equal(CITIES.length, 81);
  assert.equal(new Set(CITIES).size, 81);
  const g = CITY_DATA.find((c) => c.name === 'Gaziantep');
  assert.equal(g.roadKm, 0);
  assert.equal(g.airKm, 0);
  for (const c of CITY_DATA) assert.ok(c.roadKm >= c.airKm - 0.01, `${c.name}: karayolu kuş uçuşundan kısa olamaz`);
});

test('TEST 1: Gaziantep, yaya, 0 gece', () => {
  const r = calculate({ city: 'Gaziantep', mode: 'Yaya', subtype: 'Varsayılan' });
  assert.equal(r.total_kg, 0);
});

test('TEST 2: İstanbul özel araç benzinli 2 kişi = yol × 2 × 0.16152 / 2', () => {
  const km = CITY_DATA.find((c) => c.name === 'İstanbul').roadKm;
  const r = calculate({ city: 'İstanbul', mode: 'Özel araç', subtype: 'Benzinli', occupancy: 2 });
  close(r.transport_kg, (km * 2 * 0.16152) / 2, 'ulaşım');
  assert.equal(r.accommodation_kg, 0);
});

test('TEST 3: Ankara elektrikli 4 kişi 2 gece 2/oda', () => {
  const km = CITY_DATA.find((c) => c.name === 'Ankara').roadKm;
  const r = calculate({ city: 'Ankara', mode: 'Özel araç', subtype: 'Elektrikli', occupancy: 4, hotelNights: 2, roomOccupancy: 2 });
  close(r.transport_kg, (km * 2 * 0.08442) / 4, 'ulaşım');
  close(r.accommodation_kg, 32.1, 'konaklama');
});

test('TEST 4: uçak iç hat kuş uçuşu mesafeyle hesaplanır', () => {
  const km = CITY_DATA.find((c) => c.name === 'Ankara').airKm;
  const r = calculate({ city: 'Ankara', mode: 'Uçak', subtype: 'İç hat - ortalama' });
  close(r.transport_kg, km * 2 * 0.22928, 'ulaşım');
});

test('TEST 5: 0 gecede oda doluluğu 1 olarak normalleşir', () => {
  const r = calculate({ city: 'Ankara', mode: 'Tren', subtype: 'Ulusal demiryolu', hotelNights: 0, roomOccupancy: 3 });
  assert.equal(r.room_occupancy, 1);
  assert.equal(r.accommodation_kg, 0);
});

test('TEST 6: 2 gece 3 kişi/oda = 21.4 kg', () => {
  const r = calculate({ city: 'Gaziantep', mode: 'Yaya', subtype: 'Varsayılan', hotelNights: 2, roomOccupancy: 3 });
  close(r.accommodation_kg, 21.4);
});

test('Özel araç dışında araç doluluğu yok sayılır', () => {
  const a = calculate({ city: 'Ankara', mode: 'Tren', subtype: 'Ulusal demiryolu', occupancy: 8 });
  assert.equal(a.occupancy, 1);
});

test('Geçersiz girdi reddedilir', () => {
  assert.throws(() => calculate({ city: 'Paris', mode: 'Tren', subtype: 'Ulusal demiryolu' }), CarbonInputError);
  assert.throws(() => calculate({ city: 'Ankara', mode: 'Tren', subtype: 'Benzinli' }), CarbonInputError);
  assert.throws(() => calculate({ city: 'Ankara', mode: 'Konaklama', subtype: 'Türkiye oteli' }), CarbonInputError);
});

test('Faktör tablosu Excel değerleriyle aynı', () => {
  const by = Object.fromEntries(EMISSION_FACTORS.map((f) => [f.key, f.factor]));
  const expected = {
    'Özel araç|Benzinli': 0.16152, 'Özel araç|Dizel': 0.17265, 'Özel araç|Hibrit': 0.12961, 'Özel araç|Elektrikli': 0.08442,
    'Özel araç|Bilinmiyor': 0.16591, 'Taksi|Standart': 0.14861, 'Otobüs|Şehir içi': 0.10151, 'Otobüs|Şehirler arası': 0.03948,
    'Servis/Minibüs|Otobüs vekil faktörü': 0.03948, 'Tren|Ulusal demiryolu': 0.03092, 'Tramvay/Metro|Hafif raylı': 0.02121,
    'Motosiklet|Ortalama': 0.11367, 'Uçak|İç hat - ortalama': 0.22928, 'Uçak|Kısa mesafe - ekonomi': 0.12576,
    'Uçak|Kısa mesafe - business': 0.18863, 'Uçak|Uluslararası - ekonomi': 0.10916, 'Uçak|Uluslararası - premium ekonomi': 0.17465,
    'Uçak|Uluslararası - business': 0.31656, 'Uçak|Uluslararası - first': 0.43663, 'Konaklama|Türkiye oteli': 32.1,
    'Operasyon|Elektrik': 0.469, 'Operasyon|Doğalgaz': 2.02633, 'Operasyon|Su': 0.36218, 'Operasyon|Kâğıt': 1.343591,
    'Operasyon|Karışık atık düzenli depolama': 0.49728993, 'Operasyon|Gıda atığı düzenli depolama': 0.70033263,
    'Operasyon|Gıda atığı kompost': 0.00900687, 'Yaya|Varsayılan': 0, 'Bisiklet|Varsayılan': 0,
  };
  assert.deepEqual(by, expected);
});
