// Emisyon faktörleri — tek merkezi kaynak.
// Kaynak: "Etkinlik KArbon Ayak İzi.xlsx" > "Emisyon Faktörleri" sayfası. Değerleri keyfi değiştirmeyin.
// Bu liste supabase/reference_data.sql'e aktarılır (npm run gen:sql); sunucu hesabı DB'deki kopyayı kullanır.

export const FACTOR_VERSION = '2026';

const UK = 'UK Government GHG Conversion Factors 2026';
const NONE = 'Motorlu araç emisyonu yok';

const f = (key, unit, factor, source, year = 2026, note = '') => {
  const [activity, subtype] = key.split('|');
  return { key, category: key.startsWith('Konaklama') ? 'Konaklama' : key.startsWith('Operasyon') ? 'Operasyon' : 'Ulaşım', activity, subtype, unit, factor, source, year, note };
};

export const EMISSION_FACTORS = [
  // Ulaşım (kg CO2e / yolcu-km; özel araçta araç-km ve kişi sayısına bölünür)
  f('Yaya|Varsayılan', 'yolcu-km', 0, NONE),
  f('Bisiklet|Varsayılan', 'yolcu-km', 0, NONE),
  f('Özel araç|Benzinli', 'araç-km', 0.16152, UK, 2026, 'Araçtaki kişi sayısına bölünür.'),
  f('Özel araç|Dizel', 'araç-km', 0.17265, UK, 2026, 'Araçtaki kişi sayısına bölünür.'),
  f('Özel araç|Hibrit', 'araç-km', 0.12961, UK, 2026, 'Araçtaki kişi sayısına bölünür.'),
  f('Özel araç|Elektrikli', 'araç-km', 0.08442, '0,18 kWh/km × Türkiye dağıtım elektriği 0,469 kg CO₂e/kWh', 2026, 'Planlama vekil faktörü.'),
  f('Özel araç|Bilinmiyor', 'araç-km', 0.16591, UK, 2026, 'Ortalama otomobil.'),
  f('Taksi|Standart', 'yolcu-km', 0.14861, UK),
  f('Otobüs|Şehir içi', 'yolcu-km', 0.10151, UK),
  f('Otobüs|Şehirler arası', 'yolcu-km', 0.03948, UK),
  f('Servis/Minibüs|Otobüs vekil faktörü', 'yolcu-km', 0.03948, UK, 2026, 'Vekil faktör.'),
  f('Tren|Ulusal demiryolu', 'yolcu-km', 0.03092, UK),
  f('Tramvay/Metro|Hafif raylı', 'yolcu-km', 0.02121, UK),
  f('Motosiklet|Ortalama', 'araç-km', 0.11367, UK, 2026, 'Tek sürücü varsayımı.'),
  f('Uçak|İç hat - ortalama', 'yolcu-km', 0.22928, UK, 2026, 'RF dahil.'),
  f('Uçak|Kısa mesafe - ekonomi', 'yolcu-km', 0.12576, UK, 2026, 'RF dahil.'),
  f('Uçak|Kısa mesafe - business', 'yolcu-km', 0.18863, UK, 2026, 'RF dahil.'),
  f('Uçak|Uluslararası - ekonomi', 'yolcu-km', 0.10916, UK, 2026, 'RF dahil.'),
  f('Uçak|Uluslararası - premium ekonomi', 'yolcu-km', 0.17465, UK, 2026, 'RF dahil.'),
  f('Uçak|Uluslararası - business', 'yolcu-km', 0.31656, UK, 2026, 'RF dahil.'),
  f('Uçak|Uluslararası - first', 'yolcu-km', 0.43663, UK, 2026, 'RF dahil.'),
  // Konaklama (kg CO2e / oda-gece; odadaki kişi sayısına bölünür)
  f('Konaklama|Türkiye oteli', 'oda-gece', 32.1, UK),
  // Etkinlik operasyonu (yalnızca admin girer)
  f('Operasyon|Elektrik', 'kWh', 0.469, 'T.C. Enerji ve Tabii Kaynaklar Bakanlığı', 2023, 'Dağıtım hattı faktörü.'),
  f('Operasyon|Doğalgaz', 'm³', 2.02633, UK),
  f('Operasyon|Su', 'm³', 0.36218, UK, 2026, '0,19130 temin + 0,17088 arıtma.'),
  f('Operasyon|Kâğıt', 'kg', 1.343591, UK, 2026, 'Birincil kâğıt üretimi.'),
  f('Operasyon|Karışık atık düzenli depolama', 'kg', 0.49728993, UK),
  f('Operasyon|Gıda atığı düzenli depolama', 'kg', 0.70033263, UK),
  f('Operasyon|Gıda atığı kompost', 'kg', 0.00900687, UK),
];

export const FACTOR_BY_KEY = Object.fromEntries(EMISSION_FACTORS.map((x) => [x.key, x]));
