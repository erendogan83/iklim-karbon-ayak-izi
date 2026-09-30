// Tek seferlik veri üretimi: 81 il için koordinat (Nominatim) ve Gaziantep'e
// karayolu mesafesi (OSRM) toplar, src/data/cities.js yazar.
// Çalışma zamanında dış servis KULLANILMAZ. Çalıştırma: node scripts/generate-cities.mjs
import { writeFileSync } from 'node:fs';

const CITIES = ['Adana','Adıyaman','Afyonkarahisar','Ağrı','Aksaray','Amasya','Ankara','Antalya','Ardahan','Artvin','Aydın','Balıkesir','Bartın','Batman','Bayburt','Bilecik','Bingöl','Bitlis','Bolu','Burdur','Bursa','Çanakkale','Çankırı','Çorum','Denizli','Diyarbakır','Düzce','Edirne','Elazığ','Erzincan','Erzurum','Eskişehir','Gaziantep','Giresun','Gümüşhane','Hakkâri','Hatay','Iğdır','Isparta','İstanbul','İzmir','Kahramanmaraş','Karabük','Karaman','Kars','Kastamonu','Kayseri','Kilis','Kırıkkale','Kırklareli','Kırşehir','Kocaeli','Konya','Kütahya','Malatya','Manisa','Mardin','Mersin','Muğla','Muş','Nevşehir','Niğde','Ordu','Osmaniye','Rize','Sakarya','Samsun','Siirt','Sinop','Sivas','Şanlıurfa','Şırnak','Tekirdağ','Tokat','Trabzon','Tunceli','Uşak','Van','Yalova','Yozgat','Zonguldak'];
const UA = { 'User-Agent': 'iklim-karbon-ayak-izi/1.0 (one-off data generation)', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rad = (x) => (x * Math.PI) / 180;
function haversine(a, b) {
  const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}
async function geocode(name) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=tr&city=${encodeURIComponent(name)}`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`Nominatim ${r.status} (${name})`);
  const d = await r.json();
  if (!d[0]) throw new Error(`Nominatim boş sonuç (${name})`);
  return { lat: +d[0].lat, lon: +d[0].lon, label: d[0].display_name };
}
async function road(a, b) {
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`, { headers: UA });
  if (!r.ok) throw new Error(`OSRM ${r.status}`);
  const d = await r.json();
  if (d.code !== 'Ok') throw new Error(`OSRM ${d.code}`);
  return d.routes[0].distance / 1000;
}

const geo = {};
for (const c of CITIES) { geo[c] = await geocode(c); await sleep(1100); process.stdout.write('.'); }
console.log();
const dest = geo['Gaziantep'];
const out = [];
for (const c of CITIES) {
  const g = geo[c];
  let roadKm = 0, air = 0;
  if (c !== 'Gaziantep') {
    air = haversine(g, dest);
    for (let i = 0; ; i++) { try { roadKm = await road(g, dest); break; } catch (e) { if (i > 3) throw e; await sleep(2000); } }
    await sleep(400);
  }
  const ratio = air ? roadKm / air : 0;
  const flag = c !== 'Gaziantep' && (ratio < 1 || ratio > 1.7) ? '  <-- KONTROL' : '';
  console.log(c.padEnd(15), g.lat.toFixed(4), g.lon.toFixed(4), 'yol', roadKm.toFixed(1), 'kuş', air.toFixed(1), 'oran', ratio.toFixed(2), flag, '|', g.label.split(',').slice(0, 3).join(','));
  out.push({ name: c, lat: +g.lat.toFixed(5), lon: +g.lon.toFixed(5), roadKm: +roadKm.toFixed(2), airKm: +air.toFixed(2) });
}
const js = [
  '// OTOMATİK ÜRETİLDİ: node scripts/generate-cities.mjs (Nominatim koordinat + OSRM karayolu mesafesi, tek seferlik).',
  '// Hedef: Gaziantep. roadKm = tek yön karayolu, airKm = tek yön kuş uçuşu (haversine). Çalışma zamanında dış servis kullanılmaz.',
  'export const CITY_DATA = [',
  ...out.map((c) => `  { name: '${c.name}', lat: ${c.lat}, lon: ${c.lon}, roadKm: ${c.roadKm}, airKm: ${c.airKm} },`),
  '];',
  '',
].join('\n');
writeFileSync(new URL('../src/data/cities.js', import.meta.url), js);
console.log('yazıldı:', out.length, 'il');
