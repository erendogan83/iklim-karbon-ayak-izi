// Formda gösterilen ulaşım türleri. Sunucu, Excel'deki tüm alt türleri kabul eder;
// arayüz sade kalsın diye uçakta yalnızca iç hat sunulur (etkinlik Türkiye içinde).
// askDistance: kara ulaşımında yaklaşık tek yön km sorulur (ilden hesaplanan değer öneri olarak dolu gelir).
export const MODES = [
  { id: 'Özel araç', icon: '🚗', label: 'Özel araç', subtypeTitle: 'Aracınızın yakıt türü', subtypes: ['Benzinli', 'Dizel', 'Hibrit', 'Elektrikli', 'Bilinmiyor'], defaultSubtype: 'Bilinmiyor', askOccupancy: true, askDistance: true },
  { id: 'Uçak', icon: '✈️', label: 'Uçak', subtypes: ['İç hat - ortalama'], defaultSubtype: 'İç hat - ortalama' },
  { id: 'Otobüs', icon: '🚌', label: 'Otobüs', subtypeTitle: 'Otobüs türü', subtypes: ['Şehirler arası', 'Şehir içi'], defaultSubtype: 'Şehirler arası', askDistance: true },
  { id: 'Servis/Minibüs', icon: '🚐', label: 'Servis / Minibüs', subtypes: ['Otobüs vekil faktörü'], defaultSubtype: 'Otobüs vekil faktörü', askDistance: true },
  { id: 'Tren', icon: '🚆', label: 'Tren', subtypes: ['Ulusal demiryolu'], defaultSubtype: 'Ulusal demiryolu', askDistance: true },
  { id: 'Tramvay/Metro', icon: '🚇', label: 'Tramvay / Metro', subtypes: ['Hafif raylı'], defaultSubtype: 'Hafif raylı', askDistance: true },
  { id: 'Taksi', icon: '🚕', label: 'Taksi', subtypes: ['Standart'], defaultSubtype: 'Standart', askDistance: true },
  { id: 'Motosiklet', icon: '🏍️', label: 'Motosiklet', subtypes: ['Ortalama'], defaultSubtype: 'Ortalama', askDistance: true },
  { id: 'Bisiklet', icon: '🚲', label: 'Bisiklet', subtypes: ['Varsayılan'], defaultSubtype: 'Varsayılan' },
  { id: 'Yaya', icon: '🚶', label: 'Yaya', subtypes: ['Varsayılan'], defaultSubtype: 'Varsayılan' },
];

export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));

// Son kilometre (havalimanı / gar / otogar -> etkinlik alanı) seçenekleri. id = sunucudaki ulaşım türü.
// Önerilen km: kabaca Gaziantep havalimanı ~20, gar ~5, otogar ~8 km; katılımcı değiştirebilir.
export const LAST_MILE_OPTIONS = [
  { id: 'Taksi', icon: '🚕', label: 'Taksi' },
  { id: 'Otobüs', icon: '🚌', label: 'Şehir içi otobüs' },
  { id: 'Servis/Minibüs', icon: '🚐', label: 'Servis / Minibüs' },
  { id: 'Tramvay/Metro', icon: '🚇', label: 'Tramvay / Gaziray' },
  { id: 'Özel araç', icon: '🚗', label: 'Özel araç (biri aldı)', askOccupancy: true },
];
export const LAST_MILE_CONTEXT = {
  'Uçak': { from: 'Havalimanından', suggestedKm: 20 },
  Tren: { from: 'Garından', suggestedKm: 5 },
  'Otobüs': { from: 'Otogardan', suggestedKm: 8 },
};
