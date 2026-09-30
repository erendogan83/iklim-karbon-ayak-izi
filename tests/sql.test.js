// supabase/schema.sql + reference_data.sql'i gerçek bir Postgres'te (PGlite) çalıştırır ve
// güvenlik/hesap davranışını doğrular. Supabase'e özgü roller ve auth.uid() taklit edilir.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { calculate, CITIES } from '../src/lib/carbon.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const db = new PGlite();
const ADMIN = randomUUID();
const NORMAL_USER = randomUUID();

const as = async (role, uid = '') => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  if (role !== 'postgres') await db.exec(`set role ${role}`);
};
const submit = (o = {}) => db.query('select public.submit_carbon($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::text,$10::numeric,$11::integer) as r',
  [o.session ?? randomUUID(), o.city ?? 'Ankara', o.mode ?? 'Tren', o.subtype ?? 'Ulusal demiryolu', o.occ ?? 1, o.nights ?? 0, o.room ?? 1, o.km ?? null, o.lm ?? null, o.lkm ?? null, o.locc ?? 1]).then((x) => x.rows[0].r);
const summary = async () => (await db.query('select public.admin_summary() as s')).rows[0].s;

before(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    -- Supabase varsayılanı: yeni public tablolarına anon/authenticated ALL verilir (şema bunu geri almalı).
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  await db.exec(read('../supabase/schema.sql'));
  await db.exec(read('../supabase/reference_data.sql'));
  await db.exec(read('../supabase/schema.sql')); // idempotent: ikinci çalıştırma hata vermemeli
  await db.exec(`insert into auth.users(id) values ('${ADMIN}'), ('${NORMAL_USER}'); insert into public.admin_users(user_id) values ('${ADMIN}');`);
});

test('anon tablolara doğrudan erişemez (SELECT/INSERT)', async () => {
  await as('anon');
  for (const t of ['carbon_submissions', 'admin_users', 'event_settings', 'emission_factors', 'cities', 'event_operational_inputs']) {
    await assert.rejects(db.query(`select * from public.${t}`), /permission denied/, `${t} SELECT`);
  }
  await assert.rejects(db.query(`insert into public.carbon_submissions(session_id,city,mode,subtype,factor_key,factor_version,distance_km,occupancy,hotel_nights,room_occupancy,transport_kg,accommodation_kg,total_kg)
    values (gen_random_uuid(),'Ankara','Tren','Ulusal demiryolu','Tren|Ulusal demiryolu','x',1,1,0,1,1,0,1)`), /permission denied/);
});

test('authenticated (admin olmayan) tablolara erişemez', async () => {
  await as('authenticated', NORMAL_USER);
  await assert.rejects(db.query('select * from public.carbon_submissions'), /permission denied/);
  await assert.rejects(db.query('select * from public.admin_users'), /permission denied/);
});

test('submit_carbon: 81 il × 4 senaryo istemci hesabıyla aynı sonucu verir', async () => {
  await as('anon');
  const scenarios = [
    { mode: 'Özel araç', subtype: 'Benzinli', occ: 3, nights: 2, room: 2 },
    { mode: 'Uçak', subtype: 'İç hat - ortalama', nights: 1, room: 1 },
    { mode: 'Tren', subtype: 'Ulusal demiryolu', nights: 0, room: 3 },
    { mode: 'Yaya', subtype: 'Varsayılan', nights: 10, room: 4 },
  ];
  for (const city of CITIES) for (const s of scenarios) {
    const r = await submit({ city, ...s });
    const c = calculate({ city, mode: s.mode, subtype: s.subtype, occupancy: s.occ ?? 1, hotelNights: s.nights, roomOccupancy: s.room });
    for (const k of ['distance_km', 'transport_kg', 'accommodation_kg', 'total_kg']) {
      assert.ok(Math.abs(r[k] - c[k]) < 2e-4, `${city} ${s.mode} ${k}: sunucu ${r[k]} istemci ${c[k]}`);
    }
    assert.equal(r.occupancy, c.occupancy);
    assert.equal(r.room_occupancy, c.room_occupancy);
  }
});

test('submit_carbon: geçersiz girdiler reddedilir', async () => {
  await as('anon');
  const bad = [
    [{ city: 'Ali Veli, 0555 123 45 67' }, /invalid_city/],
    [{ city: 'ankara' }, /invalid_city/],
    [{ mode: 'Özel araç', subtype: 'Ulusal demiryolu' }, /invalid_mode_subtype/],
    [{ mode: 'Konaklama', subtype: 'Türkiye oteli' }, /invalid_mode_subtype/],
    [{ mode: 'Operasyon', subtype: 'Elektrik' }, /invalid_mode_subtype/],
    [{ mode: 'Özel araç', subtype: 'Benzinli', occ: 9 }, /invalid_occupancy/],
    [{ mode: 'Özel araç', subtype: 'Benzinli', occ: 0 }, /invalid_occupancy/],
    [{ nights: 11 }, /invalid_hotel_nights/],
    [{ nights: -1 }, /invalid_hotel_nights/],
    [{ nights: 2, room: 5 }, /invalid_room_occupancy/],
    [{ nights: 2, room: 0 }, /invalid_room_occupancy/],
  ];
  for (const [o, re] of bad) await assert.rejects(submit(o), re, JSON.stringify(o));
  await assert.rejects(db.query('select public.submit_carbon(null,$1,$2,$3)', ['Ankara', 'Tren', 'Ulusal demiryolu']), /invalid_session/);
  const ok = await submit({ mode: 'Uçak', subtype: 'Uluslararası - first' }); // sunucu Excel'deki tüm uçuş sınıflarını kabul eder
  assert.equal(ok.subtype, 'Uluslararası - first');
});

test('aynı session_id ikinci kayıt açmaz (çift gönderim)', async () => {
  await as('anon');
  const session = randomUUID();
  const a = await submit({ session });
  const b = await submit({ session });
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(a.total_kg, b.total_kg);
  await as('postgres');
  const n = (await db.query('select count(*)::int n from public.carbon_submissions where session_id=$1', [session])).rows[0].n;
  assert.equal(n, 1);
});

test('admin fonksiyonları: anon ve admin olmayan reddedilir', async () => {
  await as('anon');
  await assert.rejects(summary(), /permission denied/);
  await as('authenticated', NORMAL_USER);
  assert.equal((await db.query('select public.is_admin() as a')).rows[0].a, false);
  await assert.rejects(summary(), /not_authorized/);
  await assert.rejects(db.query('select public.admin_recent_submissions(10,0)'), /not_authorized/);
  await assert.rejects(db.query(`select public.admin_update_settings('{"target_participants":5}')`), /not_authorized/);
  await assert.rejects(db.query(`select public.admin_save_operational('{"electricity_kwh":5}')`), /not_authorized/);
});

test('TEST 10: 1500+ kayıt — toplamlar veritabanında doğru; tahmin/operasyon/sayfalama', async () => {
  await as('postgres');
  await db.exec('truncate public.carbon_submissions');
  await as('anon');
  const modes = [['Özel araç', 'Dizel'], ['Uçak', 'İç hat - ortalama'], ['Otobüs', 'Şehirler arası'], ['Tren', 'Ulusal demiryolu'], ['Yaya', 'Varsayılan'], ['Taksi', 'Standart']];
  let expTotal = 0, expTransport = 0, expAccom = 0;
  const N = 1500;
  for (let i = 0; i < N; i++) {
    const city = CITIES[i % CITIES.length];
    const [mode, subtype] = modes[i % modes.length];
    const o = { city, mode, subtype, occ: (i % 4) + 1, nights: i % 4, room: (i % 3) + 1 };
    await submit(o);
    const c = calculate({ city, mode, subtype, occupancy: o.occ, hotelNights: o.nights, roomOccupancy: o.room });
    expTotal += c.total_kg; expTransport += c.transport_kg; expAccom += c.accommodation_kg;
  }

  await as('authenticated', ADMIN);
  let s = await summary();
  assert.equal(s.responses, N);
  assert.ok(Math.abs(s.measured.total_kg - expTotal) < 0.5, `toplam ${s.measured.total_kg} vs ${expTotal}`);
  assert.ok(Math.abs(s.measured.transport_kg - expTransport) < 0.5);
  assert.ok(Math.abs(s.measured.accommodation_kg - expAccom) < 0.5);
  assert.equal(s.by_mode.reduce((a, m) => a + m.count, 0), N);
  assert.equal(s.by_city.length, 81, 'il bazlı dağılım tüm illeri içerir');
  assert.equal(s.by_city.reduce((a, c) => a + c.count, 0), N);
  assert.equal(typeof s.measured.last_mile_users, 'number');
  assert.equal(s.trees, null, 'ağaç katsayısı girilmedikçe gösterilmez');
  assert.equal(s.estimate.participant_estimated_kg, s.measured.total_kg, 'hedef yokken tahmin = ölçülen');
  assert.equal(s.estimate.coverage, null);

  // Kapsama: hedef 3000 => tahmin = ölçülen / 1500 × 3000 = 2 × ölçülen
  await db.query(`select public.admin_update_settings('{"target_participants":3000,"event_name":"Test Etkinliği","tree_equivalent_kg":50}')`);
  s = await summary();
  assert.equal(s.estimate.coverage, 0.5);
  assert.ok(Math.abs(s.estimate.participant_estimated_kg - 2 * s.measured.total_kg) < 0.01);
  assert.equal(s.settings.event_name, 'Test Etkinliği');

  // Hedef yanıttan küçük: tahmin ölçülenin altına inmez, uyarı bayrağı gelir
  await db.query(`select public.admin_update_settings('{"target_participants":1000}')`);
  s = await summary();
  assert.equal(s.estimate.over_target, true);
  assert.equal(s.estimate.participant_estimated_kg, s.measured.total_kg);

  // Operasyon: 1000 kWh × 0.469 + 10 m³ gaz × 2.02633 + 5 kg kompost × 0.00900687
  await db.query(`select public.admin_save_operational('{"electricity_kwh":1000,"natural_gas_m3":10,"food_waste_compost_kg":5}')`);
  s = await summary();
  const op = 1000 * 0.469 + 10 * 2.02633 + 5 * 0.00900687;
  assert.ok(Math.abs(s.operational.total_kg - op) < 1e-3, `operasyon ${s.operational.total_kg} vs ${op}`);
  assert.ok(Math.abs(s.event_total.estimated_kg - (s.estimate.participant_estimated_kg + op)) < 1e-3);
  assert.ok(s.trees.event_estimated > 0);
  assert.equal(s.trees.event_estimated, Math.ceil(s.event_total.estimated_kg / 50));
  assert.ok(s.trees.participants_individual >= s.trees.event_estimated - 1);

  // Sayfalama
  const p1 = (await db.query('select public.admin_recent_submissions(25,0) as r')).rows[0].r;
  const p2 = (await db.query('select public.admin_recent_submissions(25,25) as r')).rows[0].r;
  assert.equal(p1.total, N);
  assert.equal(p1.rows.length, 25);
  assert.equal(p2.rows.length, 25);
  assert.notEqual(p1.rows[0].id, p2.rows[0].id);
  const big = (await db.query('select public.admin_recent_submissions(99999,0) as r')).rows[0].r;
  assert.equal(big.rows.length, 200, 'limit 200 ile sınırlı');
  assert.ok(!('session_id' in p1.rows[0]), 'session_id admin çıktısında yok');
});

test('form kapatılınca submit reddedilir; ağaç eşdeğeri ancak onaylıysa gelir', async () => {
  await as('authenticated', ADMIN);
  await db.query(`select public.admin_update_settings('{"submissions_open":false}')`);
  await as('anon');
  await assert.rejects(submit(), /submissions_closed/);
  await as('authenticated', ADMIN);
  await db.query(`select public.admin_update_settings('{"submissions_open":true,"tree_equivalent_kg":""}')`);
  await as('anon');
  assert.equal((await submit()).tree_count, null);
});

test('silme: yalnızca admin; tek kayıt ve onaylı toplu silme', async () => {
  await as('anon');
  await assert.rejects(db.query('select public.admin_delete_submission(1)'), /permission denied/);
  await assert.rejects(db.query("select public.admin_delete_all_submissions('SİL')"), /permission denied/);
  await as('authenticated', NORMAL_USER);
  await assert.rejects(db.query('select public.admin_delete_submission(1)'), /not_authorized/);
  await assert.rejects(db.query("select public.admin_delete_all_submissions('SİL')"), /not_authorized/);

  await as('anon');
  const keep = await submit({ city: 'Ankara' });
  await as('postgres');
  const before = (await db.query('select count(*)::int n from public.carbon_submissions')).rows[0].n;
  const id = (await db.query('select id from public.carbon_submissions order by id desc limit 1')).rows[0].id;

  await as('authenticated', ADMIN);
  assert.equal((await db.query('select public.admin_delete_submission($1) as n', [id])).rows[0].n, 1);
  assert.equal((await db.query('select public.admin_delete_submission($1) as n', [id])).rows[0].n, 0, 'olmayan kayıt 0 döner');
  await assert.rejects(db.query('select public.admin_delete_all_submissions($1)', ['sil']), /confirmation_required/);
  await assert.rejects(db.query('select public.admin_delete_all_submissions($1)', ['']), /confirmation_required/);
  await assert.rejects(db.query('select public.admin_delete_all_submissions(null)'), /confirmation_required/);
  await as('postgres');
  assert.equal((await db.query('select count(*)::int n from public.carbon_submissions')).rows[0].n, before - 1, 'onaysız silme hiçbir şey silmez');

  await as('authenticated', ADMIN);
  const all = (await db.query("select public.admin_delete_all_submissions('SİL') as n")).rows[0].n;
  assert.equal(all, before - 1);
  const s = await summary();
  assert.equal(s.responses, 0);
  assert.equal(s.measured.total_kg, 0);
  await as('anon');
  assert.equal((await db.query('select public.public_counter() as c')).rows[0].c.responses, 0);
  assert.ok(keep.saved);
});

test('eski MVP tablosu varsa yedeğe alınır ve kilitlenir', async () => {
  const d2 = new PGlite();
  await d2.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema public to anon, authenticated;
    create table public.carbon_submissions (id bigint generated always as identity primary key, city text, mode text, subtype text, total_kg numeric);
    alter table public.carbon_submissions enable row level security;
    grant insert on public.carbon_submissions to anon;
    create policy "anonymous users can submit carbon calculation" on public.carbon_submissions for insert to anon with check (true);
  `);
  await d2.exec(read('../supabase/schema.sql'));
  await d2.exec('set role anon');
  await assert.rejects(d2.query(`insert into public.carbon_submissions_mvp_backup(city,mode,subtype,total_kg) values ('x','y','z',1)`), /permission denied/);
  await d2.close();
});

test('kullanıcı km girdisi: doğrulanır, kara ulaşımında kullanılır, yaya/uçakta yok sayılır', async () => {
  await as('anon');
  const r = await submit({ city: 'Ankara', mode: 'Otobüs', subtype: 'Şehir içi', km: 25 });
  assert.equal(Number(r.distance_km), 25);
  assert.equal(r.distance_source, 'user');
  assert.ok(Math.abs(r.transport_kg - 25 * 2 * 0.10151) < 1e-3);
  const g = await submit({ city: 'Gaziantep', mode: 'Taksi', subtype: 'Standart', km: 12.34 }); // Gaziantep içi de hesaplanabilir
  assert.equal(Number(g.distance_km), 12.3);
  assert.ok(Math.abs(g.transport_kg - 12.3 * 2 * 0.14861) < 1e-3);
  const walk = await submit({ city: 'Ankara', mode: 'Yaya', subtype: 'Varsayılan', km: 500 });
  assert.equal(Number(walk.distance_km), 0);
  assert.equal(walk.distance_source, 'city');
  const plane = await submit({ city: 'Ankara', mode: 'Uçak', subtype: 'İç hat - ortalama', km: 5 });
  assert.equal(plane.distance_source, 'city');
  assert.ok(Number(plane.distance_km) > 400);
  const none = await submit({ city: 'Ankara', mode: 'Tren', subtype: 'Ulusal demiryolu' });
  assert.equal(none.distance_source, 'city');
  await assert.rejects(submit({ mode: 'Otobüs', subtype: 'Şehir içi', km: 3001 }), /invalid_distance/);
  await assert.rejects(submit({ mode: 'Otobüs', subtype: 'Şehir içi', km: -1 }), /invalid_distance/);
});

test('dikilecek ağaç sayısı tam sayıdır ve yukarı yuvarlanır', async () => {
  await as('authenticated', ADMIN);
  await db.query(`select public.admin_update_settings('{"tree_equivalent_kg":50}')`);
  await as('anon');
  const r = await submit({ city: 'Ankara', mode: 'Özel araç', subtype: 'Benzinli', occ: 1 });
  assert.equal(r.tree_count, Math.ceil(r.total_kg / 50));
  assert.ok(Number.isInteger(r.tree_count));
  const zero = await submit({ city: 'Gaziantep', mode: 'Yaya', subtype: 'Varsayılan' });
  assert.equal(Number(zero.total_kg), 0);
  assert.equal(zero.tree_count, 1, 'ayak izi 0 olsa bile en az 1 fide');
  await as('authenticated', ADMIN);
  await db.query(`select public.admin_update_settings('{"tree_equivalent_kg":""}')`);
});

test('son kilometre: hesap, saklama ve toplama dahil edilir; 81 il × istemci hesabıyla aynı', async () => {
  await as('anon');
  for (const city of CITIES.filter((c) => c !== 'Gaziantep')) {
    for (const [mode, subtype, lm, lkm, locc] of [['Uçak', 'İç hat - ortalama', 'Taksi', 20], ['Tren', 'Ulusal demiryolu', 'Özel araç', 5, 3], ['Otobüs', 'Şehirler arası', 'Tramvay/Metro', 8]]) {
      const r = await submit({ city, mode, subtype, lm, lkm, locc });
      const c = calculate({ city, mode, subtype, lastMile: { mode: lm, km: lkm, occupancy: locc ?? 1 } });
      for (const k of ['transport_kg', 'total_kg', 'last_mile_kg']) assert.ok(Math.abs(r[k] - c[k]) < 2e-4, `${city} ${mode} ${k}: sunucu ${r[k]} istemci ${c[k]}`);
      assert.equal(r.last_mile_mode, lm);
    }
  }
  const r = await submit({ city: 'Ankara', mode: 'Uçak', subtype: 'İç hat - ortalama', lm: 'Taksi', lkm: 20 });
  const main = Number(r.transport_kg) - Number(r.last_mile_kg);
  assert.ok(Math.abs(Number(r.last_mile_kg) - 20 * 2 * 0.14861) < 1e-3);
  assert.ok(main > 0);
  assert.ok(Math.abs(Number(r.total_kg) - (Number(r.transport_kg) + Number(r.accommodation_kg))) < 1e-3);
  const car = await submit({ city: 'Ankara', mode: 'Tren', subtype: 'Ulusal demiryolu', lm: 'Özel araç', lkm: 10, locc: 2 });
  assert.ok(Math.abs(Number(car.last_mile_kg) - (10 * 2 * 0.16591) / 2) < 1e-3);
  const none = await submit({ city: 'Ankara', mode: 'Uçak', subtype: 'İç hat - ortalama' });
  assert.equal(none.last_mile_mode, null);
  assert.equal(Number(none.last_mile_kg), 0);
});

test('son kilometre: uygunsuz kombinasyonlar ve sınırlar reddedilir', async () => {
  await as('anon');
  const plane = { mode: 'Uçak', subtype: 'İç hat - ortalama' };
  await assert.rejects(submit({ city: 'Gaziantep', ...plane, lm: 'Taksi', lkm: 5 }), /invalid_last_mile/);
  await assert.rejects(submit({ mode: 'Yaya', subtype: 'Varsayılan', lm: 'Taksi', lkm: 5 }), /invalid_last_mile/);
  await assert.rejects(submit({ mode: 'Otobüs', subtype: 'Şehir içi', lm: 'Taksi', lkm: 5 }), /invalid_last_mile/);
  await assert.rejects(submit({ mode: 'Özel araç', subtype: 'Benzinli', lm: 'Taksi', lkm: 5 }), /invalid_last_mile/);
  await assert.rejects(submit({ ...plane, lm: 'Uçak', lkm: 5 }), /invalid_last_mile/);
  await assert.rejects(submit({ ...plane, lm: 'Yaya', lkm: 5 }), /invalid_last_mile/);
  await assert.rejects(submit({ ...plane, lm: 'Taksi', lkm: 100.5 }), /invalid_last_distance/);
  await assert.rejects(submit({ ...plane, lm: 'Taksi', lkm: -1 }), /invalid_last_distance/);
  await assert.rejects(submit({ ...plane, lm: 'Taksi' }), /invalid_last_distance/);
  await assert.rejects(submit({ ...plane, lm: 'Özel araç', lkm: 5, locc: 9 }), /invalid_last_occupancy/);
});

test('public_counter: anon yalnızca toplam sayıları görür; admin kapatabilir', async () => {
  await as('postgres');
  const total = (await db.query('select count(*)::int n, coalesce(sum(total_kg),0)::float8 t from public.carbon_submissions')).rows[0];
  await as('anon');
  let c = (await db.query('select public.public_counter() as c')).rows[0].c;
  assert.equal(c.enabled, true);
  assert.equal(c.responses, total.n);
  assert.ok(Math.abs(c.total_kg - total.t) < 0.05);
  assert.deepEqual(Object.keys(c).sort(), ['enabled', 'responses', 'total_kg', 'trees'], 'kayıt düzeyi veri sızmaz');
  assert.equal(c.trees, null, 'katsayı yokken fide sayısı yok');
  await assert.rejects(db.query('select * from public.carbon_submissions'), /permission denied/);

  await as('authenticated', ADMIN);
  await db.query(`select public.admin_update_settings('{"tree_equivalent_kg":50}')`);
  await as('anon');
  c = (await db.query('select public.public_counter() as c')).rows[0].c;
  await as('postgres');
  const trees = (await db.query('select coalesce(sum(greatest(1, ceil(total_kg/50))),0)::int t from public.carbon_submissions')).rows[0].t;
  assert.equal(c.trees, trees);

  await as('authenticated', ADMIN);
  await db.query(`select public.admin_update_settings('{"live_counter_enabled":false,"tree_equivalent_kg":""}')`);
  await as('anon');
  assert.deepEqual((await db.query('select public.public_counter() as c')).rows[0].c, { enabled: false });
  await as('authenticated', ADMIN);
  await db.query(`select public.admin_update_settings('{"live_counter_enabled":true}')`);
});
