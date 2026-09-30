// src/data/factors.js + src/data/cities.js -> supabase/reference_data.sql
// Çalıştırma: npm run gen:sql   (faktör veya şehir verisi değişince)
import { writeFileSync } from 'node:fs';
import { EMISSION_FACTORS, FACTOR_VERSION } from '../src/data/factors.js';
import { CITY_DATA } from '../src/data/cities.js';

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

const factorRows = EMISSION_FACTORS.map(
  (x) => `  (${q(x.key)}, ${q(x.category)}, ${q(x.activity)}, ${q(x.subtype)}, ${q(x.unit)}, ${x.factor}, ${q(x.source)}, ${q(FACTOR_VERSION)}, ${x.year}, ${q(x.note)})`,
).join(',\n');
const cityRows = CITY_DATA.map((c) => `  (${q(c.name)}, ${c.lat}, ${c.lon}, ${c.roadKm}, ${c.airKm})`).join(',\n');

const sql = `-- OTOMATİK ÜRETİLDİ (npm run gen:sql). Elle düzenlemeyin: src/data/factors.js ve cities.js'yi düzenleyin.
-- schema.sql'den SONRA çalıştırın. Tekrar çalıştırılabilir.

insert into public.emission_factors (key, category, activity, subtype, unit, factor, source, factor_version, year, note) values
${factorRows}
on conflict (key) do update set
  category = excluded.category, activity = excluded.activity, subtype = excluded.subtype, unit = excluded.unit,
  factor = excluded.factor, source = excluded.source, factor_version = excluded.factor_version,
  year = excluded.year, note = excluded.note;

insert into public.cities (name, lat, lon, road_km, air_km) values
${cityRows}
on conflict (name) do update set lat = excluded.lat, lon = excluded.lon, road_km = excluded.road_km, air_km = excluded.air_km;
`;

writeFileSync(new URL('../supabase/reference_data.sql', import.meta.url), sql);
console.log(`reference_data.sql: ${EMISSION_FACTORS.length} faktör, ${CITY_DATA.length} il`);
