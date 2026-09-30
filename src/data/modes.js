// Formda gösterilen ulaşım türleri. Sunucu, Excel'deki tüm alt türleri kabul eder;
// arayüz sade kalsın diye uçakta yalnızca iç hat sunulur (etkinlik Türkiye içinde).
export const MODES = [
  { id: 'Özel araç', icon: '🚗', label: 'Özel araç', subtypeTitle: 'Aracınızın yakıt türü', subtypes: ['Benzinli', 'Dizel', 'Hibrit', 'Elektrikli', 'Bilinmiyor'], defaultSubtype: 'Bilinmiyor', askOccupancy: true },
  { id: 'Uçak', icon: '✈️', label: 'Uçak', subtypes: ['İç hat - ortalama'], defaultSubtype: 'İç hat - ortalama' },
  { id: 'Otobüs', icon: '🚌', label: 'Otobüs', subtypeTitle: 'Otobüs türü', subtypes: ['Şehirler arası', 'Şehir içi'], defaultSubtype: 'Şehirler arası' },
  { id: 'Servis/Minibüs', icon: '🚐', label: 'Servis / Minibüs', subtypes: ['Otobüs vekil faktörü'], defaultSubtype: 'Otobüs vekil faktörü' },
  { id: 'Tren', icon: '🚆', label: 'Tren', subtypes: ['Ulusal demiryolu'], defaultSubtype: 'Ulusal demiryolu' },
  { id: 'Tramvay/Metro', icon: '🚇', label: 'Tramvay / Metro', subtypes: ['Hafif raylı'], defaultSubtype: 'Hafif raylı' },
  { id: 'Taksi', icon: '🚕', label: 'Taksi', subtypes: ['Standart'], defaultSubtype: 'Standart' },
  { id: 'Motosiklet', icon: '🏍️', label: 'Motosiklet', subtypes: ['Ortalama'], defaultSubtype: 'Ortalama' },
  { id: 'Bisiklet', icon: '🚲', label: 'Bisiklet', subtypes: ['Varsayılan'], defaultSubtype: 'Varsayılan' },
  { id: 'Yaya', icon: '🚶', label: 'Yaya', subtypes: ['Varsayılan'], defaultSubtype: 'Varsayılan' },
];

export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));
