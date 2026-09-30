-- ============================================================================
-- Etkinlik Karbon Ayak İzi — Supabase şeması (v2, üretim)
--
-- Çalıştırma sırası (Supabase > SQL Editor):  1) schema.sql   2) reference_data.sql
-- Tekrar çalıştırılabilir (idempotent). Yeni Supabase projesi için tasarlandı.
--
-- Güvenlik modeli:
--   * Tüm tablolarda RLS AÇIK ve anon/authenticated için HİÇBİR politika/yetki YOK.
--     Yani tarayıcıdan tablolara doğrudan okuma/yazma mümkün değildir.
--   * Katılımcı yalnızca submit_carbon() fonksiyonunu çağırabilir. Fonksiyon ham girdiyi
--     doğrular; mesafeyi, faktörü ve toplamı VERİTABANINDAKİ tablolardan kendisi hesaplar.
--     İstemciden gelen kg/mesafe değerleri diye bir şey yoktur.
--   * Admin fonksiyonları (admin_*) yalnızca admin_users tablosundaki auth.uid() için çalışır.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Eski MVP tablosu varsa (session_id sütunu yok) yedeğe al ve KİLİTLE.
--    Eski tabloda anon INSERT politikası vardı; açık bırakılmamalı.
-- ---------------------------------------------------------------------------
do $$
declare pol record;
begin
  if to_regclass('public.carbon_submissions') is not null
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'carbon_submissions' and column_name = 'session_id') then
    alter table public.carbon_submissions rename to carbon_submissions_mvp_backup;
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'carbon_submissions_mvp_backup' loop
      execute format('drop policy %I on public.carbon_submissions_mvp_backup', pol.policyname);
    end loop;
    alter table public.carbon_submissions_mvp_backup enable row level security;
    revoke all on table public.carbon_submissions_mvp_backup from anon, authenticated;
    raise notice 'Eski MVP tablosu carbon_submissions_mvp_backup adıyla saklandı ve kilitlendi.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Tablolar
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade
);
-- Eski MVP şemasından kalan politika (artık gerekmiyor; tablo yukarıda garanti oluşturuldu).
drop policy if exists "admins can see their own admin row" on public.admin_users;

-- Tek satırlık etkinlik ayarları (id = 1).
create table if not exists public.event_settings (
  id smallint primary key default 1 check (id = 1),
  event_name text not null default 'Etkinlik Karbon Ayak İzi' check (char_length(event_name) between 1 and 120),
  event_date date,
  destination_city text not null default 'Gaziantep',
  target_participants integer check (target_participants is null or target_participants >= 0),
  -- Organizatör onaylayana kadar NULL: katılımcıya ağaç eşdeğeri GÖSTERİLMEZ.
  tree_equivalent_kg numeric check (tree_equivalent_kg is null or tree_equivalent_kg > 0),
  submissions_open boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Faktör tablosu (versiyonlu). Kaynak: Excel "Emisyon Faktörleri".
create table if not exists public.emission_factors (
  key text primary key,                       -- 'Özel araç|Benzinli'
  category text not null check (category in ('Ulaşım', 'Konaklama', 'Operasyon')),
  activity text not null,
  subtype text not null,
  unit text not null,
  factor numeric not null check (factor >= 0),
  source text not null,
  factor_version text not null,
  year integer,
  note text not null default ''
);

-- 81 il: Gaziantep'e tek yön mesafe (statik; dış servis yok).
create table if not exists public.cities (
  name text primary key,
  lat numeric not null,
  lon numeric not null,
  road_km numeric not null check (road_km >= 0),
  air_km numeric not null check (air_km >= 0)
);

create table if not exists public.carbon_submissions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  session_id uuid not null unique,            -- yalnızca çift gönderimi önler; kalıcı takip değildir
  city text not null references public.cities (name),
  mode text not null,
  subtype text not null,
  factor_key text not null references public.emission_factors (key),
  factor_version text not null,
  distance_km numeric not null check (distance_km >= 0),
  occupancy smallint not null check (occupancy between 1 and 8),
  hotel_nights smallint not null check (hotel_nights between 0 and 10),
  room_occupancy smallint not null check (room_occupancy between 1 and 4),
  transport_kg numeric not null check (transport_kg >= 0),
  accommodation_kg numeric not null check (accommodation_kg >= 0),
  total_kg numeric not null check (total_kg >= 0),
  check (factor_key = mode || '|' || subtype),
  check (abs(total_kg - (transport_kg + accommodation_kg)) < 0.001)
);
-- Mesafe kaynağı: 'city' = ilden hesaplanan statik mesafe, 'user' = katılımcının girdiği yaklaşık km (0–3000 doğrulanır).
alter table public.carbon_submissions add column if not exists distance_source text not null default 'city'
  check (distance_source in ('city', 'user'));
-- Son kilometre: uçak/tren/şehirlerarası otobüsle gelen katılımcının havalimanı-gar-otogardan etkinliğe ulaşımı.
-- transport_kg = ana ulaşım + son kilometre (last_mile_kg ayrıca saklanır).
alter table public.carbon_submissions
  add column if not exists last_mile_mode text,
  add column if not exists last_mile_subtype text,
  add column if not exists last_mile_km numeric not null default 0 check (last_mile_km >= 0),
  add column if not exists last_mile_occupancy smallint not null default 1 check (last_mile_occupancy between 1 and 8),
  add column if not exists last_mile_kg numeric not null default 0 check (last_mile_kg >= 0);
create index if not exists carbon_submissions_created_idx on public.carbon_submissions (created_at desc, id desc);
create index if not exists carbon_submissions_mode_idx on public.carbon_submissions (mode);

-- Etkinlik sonrası admin girişi (tek satır).
create table if not exists public.event_operational_inputs (
  event_id smallint primary key default 1 references public.event_settings (id),
  electricity_kwh numeric not null default 0 check (electricity_kwh between 0 and 1e9),
  natural_gas_m3 numeric not null default 0 check (natural_gas_m3 between 0 and 1e9),
  water_m3 numeric not null default 0 check (water_m3 between 0 and 1e9),
  paper_kg numeric not null default 0 check (paper_kg between 0 and 1e9),
  mixed_waste_kg numeric not null default 0 check (mixed_waste_kg between 0 and 1e9),
  food_waste_landfill_kg numeric not null default 0 check (food_waste_landfill_kg between 0 and 1e9),
  food_waste_compost_kg numeric not null default 0 check (food_waste_compost_kg between 0 and 1e9),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Katılımcıya sonuç ekranında gösterilen genel canlı sayaç (yalnızca toplam sayılar) açık/kapalı.
alter table public.event_settings add column if not exists live_counter_enabled boolean not null default true;

insert into public.event_settings (id) values (1) on conflict (id) do nothing;
insert into public.event_operational_inputs (event_id) values (1) on conflict (event_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2) RLS: hepsi açık, politika YOK => anon/authenticated tablolara doğrudan erişemez.
--    (SECURITY DEFINER fonksiyonlar tablo sahibi olarak çalışır ve RLS'yi atlar.)
-- ---------------------------------------------------------------------------
alter table public.admin_users enable row level security;
alter table public.event_settings enable row level security;
alter table public.emission_factors enable row level security;
alter table public.cities enable row level security;
alter table public.carbon_submissions enable row level security;
alter table public.event_operational_inputs enable row level security;

revoke all on table public.admin_users, public.event_settings, public.emission_factors, public.cities,
  public.carbon_submissions, public.event_operational_inputs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Yardımcı: admin mi?
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admin_users a where a.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 4) Katılımcı: sunucu tarafı doğrulama + hesaplama + kayıt
--    Formül Excel ile aynıdır:
--      toplam_km = tek yön × 2
--      özel araç: toplam_km × faktör / araç_doluluğu ; diğer: toplam_km × faktör
--      konaklama: gece × 32,1 / oda_doluluğu
-- ---------------------------------------------------------------------------
-- Eski imza (7 parametreli) varsa kaldır; aksi halde eski fonksiyon yanında çalışmaya devam ederdi.
drop function if exists public.submit_carbon(uuid, text, text, text, integer, integer, integer);
drop function if exists public.submit_carbon(uuid, text, text, text, integer, integer, integer, numeric);

create or replace function public.submit_carbon(
  p_session_id uuid,
  p_city text,
  p_mode text,
  p_subtype text,
  p_occupancy integer default 1,
  p_hotel_nights integer default 0,
  p_room_occupancy integer default 1,
  p_distance_km numeric default null,  -- yalnızca kara ulaşımında: katılımcının yaklaşık tek yön km'si
  p_last_mode text default null,       -- son kilometre: 'Taksi' | 'Otobüs' | 'Servis/Minibüs' | 'Tramvay/Metro' | 'Özel araç'; NULL = yok
  p_last_distance_km numeric default null,
  p_last_occupancy integer default 1
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_settings public.event_settings%rowtype;
  v_city public.cities%rowtype;
  v_factor public.emission_factors%rowtype;
  v_hotel public.emission_factors%rowtype;
  v_row public.carbon_submissions%rowtype;
  v_km numeric;
  v_source text := 'city';
  v_occ integer;
  v_nights integer := coalesce(p_hotel_nights, 0);
  v_room integer;
  v_transport numeric;
  v_accom numeric;
  v_inserted boolean := true;
  v_last_subtype text;
  v_last_factor public.emission_factors%rowtype;
  v_last_km numeric := 0;
  v_last_occ integer := 1;
  v_last_kg numeric := 0;
begin
  select * into v_settings from public.event_settings where id = 1;
  if not found or not v_settings.submissions_open then
    raise exception 'submissions_closed' using errcode = 'P0001';
  end if;

  if p_session_id is null then raise exception 'invalid_session' using errcode = '22023'; end if;

  select * into v_city from public.cities where name = p_city;
  if not found then raise exception 'invalid_city' using errcode = '22023'; end if;

  select * into v_factor from public.emission_factors
   where key = coalesce(p_mode, '') || '|' || coalesce(p_subtype, '') and category = 'Ulaşım';
  if not found then raise exception 'invalid_mode_subtype' using errcode = '22023'; end if;

  -- Özel araçta doluluk 1–8; diğer türlerde doluluk kullanılmaz (1 saklanır).
  if p_mode = 'Özel araç' then
    v_occ := coalesce(p_occupancy, 1);
    if v_occ < 1 or v_occ > 8 then raise exception 'invalid_occupancy' using errcode = '22023'; end if;
  else
    v_occ := 1;
  end if;

  if v_nights < 0 or v_nights > 10 then raise exception 'invalid_hotel_nights' using errcode = '22023'; end if;
  -- Konaklama yoksa oda doluluğu anlamsızdır (1 saklanır).
  if v_nights > 0 then
    v_room := coalesce(p_room_occupancy, 1);
    if v_room < 1 or v_room > 4 then raise exception 'invalid_room_occupancy' using errcode = '22023'; end if;
  else
    v_room := 1;
  end if;

  -- Yaya/bisiklet 0 km, uçak kuş uçuşu (ilden). Diğerlerinde katılımcı km girdiyse doğrulanıp kullanılır,
  -- girmediyse ilden hesaplanan karayolu mesafesi kullanılır.
  if p_mode in ('Yaya', 'Bisiklet') then
    v_km := 0;
  elsif p_mode = 'Uçak' then
    v_km := v_city.air_km;
  elsif p_distance_km is not null then
    if p_distance_km < 0 or p_distance_km > 3000 then raise exception 'invalid_distance' using errcode = '22023'; end if;
    v_km := round(p_distance_km, 1);
    v_source := 'user';
  else
    v_km := v_city.road_km;
  end if;

  v_transport := (v_km * 2) * v_factor.factor / (case when p_mode = 'Özel araç' then v_occ else 1 end);

  -- Son kilometre yalnızca uçak, tren veya şehirlerarası otobüsle gelenler için ve il Gaziantep değilken kabul edilir.
  if p_last_mode is not null then
    if v_city.name = 'Gaziantep' or not (p_mode in ('Uçak', 'Tren') or (p_mode = 'Otobüs' and p_subtype = 'Şehirler arası')) then
      raise exception 'invalid_last_mile' using errcode = '22023';
    end if;
    v_last_subtype := case p_last_mode when 'Taksi' then 'Standart' when 'Otobüs' then 'Şehir içi'
                        when 'Servis/Minibüs' then 'Otobüs vekil faktörü' when 'Tramvay/Metro' then 'Hafif raylı'
                        when 'Özel araç' then 'Bilinmiyor' end;
    if v_last_subtype is null then raise exception 'invalid_last_mile' using errcode = '22023'; end if;
    if p_last_distance_km is null or p_last_distance_km < 0 or p_last_distance_km > 100 then
      raise exception 'invalid_last_distance' using errcode = '22023';
    end if;
    v_last_km := round(p_last_distance_km, 1);
    if p_last_mode = 'Özel araç' then
      v_last_occ := coalesce(p_last_occupancy, 1);
      if v_last_occ < 1 or v_last_occ > 8 then raise exception 'invalid_last_occupancy' using errcode = '22023'; end if;
    end if;
    select * into v_last_factor from public.emission_factors where key = p_last_mode || '|' || v_last_subtype;
    v_last_kg := round((v_last_km * 2) * v_last_factor.factor / v_last_occ, 4);
  end if;

  select * into v_hotel from public.emission_factors where key = 'Konaklama|Türkiye oteli';
  v_accom := case when v_nights > 0 then v_nights * v_hotel.factor / v_room else 0 end;

  v_transport := round(v_transport, 4) + v_last_kg;
  v_accom := round(v_accom, 4);

  insert into public.carbon_submissions (session_id, city, mode, subtype, factor_key, factor_version,
    distance_km, distance_source, occupancy, hotel_nights, room_occupancy, transport_kg, accommodation_kg, total_kg,
    last_mile_mode, last_mile_subtype, last_mile_km, last_mile_occupancy, last_mile_kg)
  values (p_session_id, v_city.name, p_mode, p_subtype, v_factor.key, v_factor.factor_version,
    v_km, v_source, v_occ, v_nights, v_room, v_transport, v_accom, v_transport + v_accom,
    p_last_mode, v_last_subtype, v_last_km, v_last_occ, v_last_kg)
  on conflict (session_id) do nothing
  returning * into v_row;

  if v_row.id is null then  -- aynı oturum tekrar gönderildi: mevcut kaydı döndür, ikinci kayıt açma
    v_inserted := false;
    select * into v_row from public.carbon_submissions where session_id = p_session_id;
  end if;

  return jsonb_build_object(
    'saved', true,
    'duplicate', not v_inserted,
    'city', v_row.city, 'mode', v_row.mode, 'subtype', v_row.subtype,
    'distance_km', v_row.distance_km, 'distance_source', v_row.distance_source,
    'occupancy', v_row.occupancy, 'hotel_nights', v_row.hotel_nights, 'room_occupancy', v_row.room_occupancy,
    'transport_kg', v_row.transport_kg, 'accommodation_kg', v_row.accommodation_kg, 'total_kg', v_row.total_kg,
    'last_mile_mode', v_row.last_mile_mode, 'last_mile_km', v_row.last_mile_km,
    'last_mile_occupancy', v_row.last_mile_occupancy, 'last_mile_kg', v_row.last_mile_kg,
    -- Dikilecek fide sayısı: tam sayı, yukarı yuvarlanır; ayak izi 0 olsa bile en az 1. Katsayı girilmediyse NULL.
    'tree_count', case when v_settings.tree_equivalent_kg is null then null
                       else greatest(1, ceil(v_row.total_kg / v_settings.tree_equivalent_kg))::integer end,
    'factor_version', v_row.factor_version
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4b) Canlı sayaç: katılımcıya sonuç sonrası yalnızca TOPLAM sayılar gösterilir (kayıt düzeyi veri yok).
--     Admin panelinden kapatılabilir (live_counter_enabled).
-- ---------------------------------------------------------------------------
create or replace function public.public_counter()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare s public.event_settings%rowtype;
begin
  select * into s from public.event_settings where id = 1;
  if not found or not s.live_counter_enabled then return jsonb_build_object('enabled', false); end if;
  return (select jsonb_build_object(
            'enabled', true,
            'responses', count(*),
            'total_kg', coalesce(round(sum(total_kg), 2), 0),
            'trees', case when s.tree_equivalent_kg is null then null
                          else coalesce(sum(greatest(1, ceil(total_kg / s.tree_equivalent_kg))), 0) end)
            from public.carbon_submissions);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Admin: özet (tüm toplamlar veritabanında hesaplanır; PostgREST satır limiti etkilemez)
-- ---------------------------------------------------------------------------
create or replace function public.admin_summary()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s public.event_settings%rowtype;
  o public.event_operational_inputs%rowtype;
  n bigint; m_total numeric; m_transport numeric; m_accom numeric; nights numeric; hotel_n bigint;
  lm_n bigint; lm_kg numeric;
  target integer;
  coverage numeric; estimated numeric; over_target boolean := false;
  by_mode jsonb; by_city jsonb; op_items jsonb; op_total numeric;
begin
  if not public.is_admin() then raise exception 'not_authorized' using errcode = '42501'; end if;

  select * into s from public.event_settings where id = 1;
  select * into o from public.event_operational_inputs where event_id = 1;

  select count(*), coalesce(sum(total_kg), 0), coalesce(sum(transport_kg), 0), coalesce(sum(accommodation_kg), 0),
         coalesce(sum(hotel_nights), 0), count(*) filter (where hotel_nights > 0),
         count(*) filter (where last_mile_mode is not null), coalesce(sum(last_mile_kg), 0)
    into n, m_total, m_transport, m_accom, nights, hotel_n, lm_n, lm_kg
    from public.carbon_submissions;

  -- Kapsama ve tahmin (Excel: tahmin = ölçülen / yanıt × hedef katılımcı). Sıfıra bölme yok.
  target := s.target_participants;
  if n = 0 then
    estimated := 0;
  elsif coalesce(target, 0) = 0 then
    estimated := m_total;                       -- hedef girilmedi: tahmin = ölçülen
  elsif n >= target then
    estimated := m_total;                       -- hedef aşıldı: ölçülenin altına inilmez
    over_target := n > target;
  else
    estimated := m_total / n * target;
  end if;
  coverage := case when coalesce(target, 0) > 0 then round(n::numeric / target, 4) end;

  select coalesce(jsonb_agg(jsonb_build_object('mode', mode, 'count', c, 'total_kg', t, 'transport_kg', tr)
                            order by c desc, mode), '[]'::jsonb)
    into by_mode
    from (select mode, count(*) c, sum(total_kg) t, sum(transport_kg) tr
            from public.carbon_submissions group by mode) x;

  select coalesce(jsonb_agg(jsonb_build_object('city', city, 'count', c, 'total_kg', t) order by c desc, city), '[]'::jsonb)
    into by_city
    from (select city, count(*) c, sum(total_kg) t from public.carbon_submissions
           group by city order by count(*) desc, city) x;

  select coalesce(jsonb_agg(jsonb_build_object('field', v.field, 'label', v.label, 'unit', ef.unit,
                              'amount', v.amount, 'factor', ef.factor, 'kg', round(v.amount * ef.factor, 4)) order by v.ord), '[]'::jsonb),
         coalesce(sum(v.amount * ef.factor), 0)
    into op_items, op_total
    from (values
      (1, 'electricity_kwh', 'Elektrik tüketimi', o.electricity_kwh, 'Operasyon|Elektrik'),
      (2, 'natural_gas_m3', 'Doğal gaz', o.natural_gas_m3, 'Operasyon|Doğalgaz'),
      (3, 'water_m3', 'Su', o.water_m3, 'Operasyon|Su'),
      (4, 'paper_kg', 'Basılı kâğıt', o.paper_kg, 'Operasyon|Kâğıt'),
      (5, 'mixed_waste_kg', 'Karışık atık (düzenli depolama)', o.mixed_waste_kg, 'Operasyon|Karışık atık düzenli depolama'),
      (6, 'food_waste_landfill_kg', 'Gıda atığı (düzenli depolama)', o.food_waste_landfill_kg, 'Operasyon|Gıda atığı düzenli depolama'),
      (7, 'food_waste_compost_kg', 'Gıda atığı (kompost)', o.food_waste_compost_kg, 'Operasyon|Gıda atığı kompost')
    ) as v(ord, field, label, amount, fkey)
    join public.emission_factors ef on ef.key = v.fkey;

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'event_name', s.event_name, 'event_date', s.event_date, 'destination_city', s.destination_city,
      'target_participants', s.target_participants, 'tree_equivalent_kg', s.tree_equivalent_kg,
      'submissions_open', s.submissions_open, 'live_counter_enabled', s.live_counter_enabled),
    'responses', n,
    'measured', jsonb_build_object(
      'total_kg', m_total, 'transport_kg', m_transport, 'accommodation_kg', m_accom,
      'avg_kg', case when n > 0 then round(m_total / n, 4) else 0 end,
      'hotel_nights', nights, 'hotel_guests', hotel_n,
      'last_mile_users', lm_n, 'last_mile_kg', lm_kg),
    'estimate', jsonb_build_object(
      'target_participants', target, 'coverage', coverage, 'over_target', over_target,
      'participant_estimated_kg', round(estimated, 4)),
    'operational', jsonb_build_object('total_kg', round(op_total, 4), 'items', op_items),
    'event_total', jsonb_build_object(
      'measured_kg', round(m_total + op_total, 4),
      'estimated_kg', round(estimated + op_total, 4)),
    'by_mode', by_mode,
    'by_city', by_city,
    -- Dikilecek ağaç: katsayı girilmediyse NULL. event_estimated = tahmini etkinlik toplamına göre;
    -- participants_individual = yanıt verenlerin her birine gösterilen (kişi bazlı yukarı yuvarlanmış) sayıların toplamı.
    'trees', case when s.tree_equivalent_kg is null then null else jsonb_build_object(
      'kg_per_tree', s.tree_equivalent_kg,
      'event_estimated', ceil((estimated + op_total) / s.tree_equivalent_kg),
      'participants_individual', (select coalesce(sum(greatest(1, ceil(total_kg / s.tree_equivalent_kg))), 0) from public.carbon_submissions)
    ) end
  );
end;
$$;

-- Sayfalı son kayıtlar (kimlik verisi yok: yalnızca anonim faaliyet verisi).
create or replace function public.admin_recent_submissions(p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_admin() then raise exception 'not_authorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'total', (select count(*) from public.carbon_submissions),
    'rows', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc), '[]'::jsonb)
               from (select id, created_at, city, mode, subtype, distance_km, occupancy, hotel_nights,
                            room_occupancy, transport_kg, accommodation_kg, total_kg
                       from public.carbon_submissions
                      order by created_at desc, id desc
                      limit v_limit offset v_offset) r)
  );
end;
$$;

-- Kayıt silme (yalnızca admin): tek kayıt veya tümü. "Tümü" için sunucu tarafında da onay metni istenir.
-- (WHERE true: Supabase'in güvenli-silme uzantısı WHERE'siz DELETE'i reddeder.)
create or replace function public.admin_delete_submission(p_id bigint)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'not_authorized' using errcode = '42501'; end if;
  delete from public.carbon_submissions where id = p_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.admin_delete_all_submissions(p_confirm text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'not_authorized' using errcode = '42501'; end if;
  if p_confirm is distinct from 'SİL' then raise exception 'confirmation_required' using errcode = '22023'; end if;
  delete from public.carbon_submissions where true;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Etkinlik ayarlarını güncelle (yalnızca gönderilen alanlar değişir; boş string = NULL).
create or replace function public.admin_update_settings(p jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'not_authorized' using errcode = '42501'; end if;
  update public.event_settings set
    event_name = case when p ? 'event_name' and btrim(p->>'event_name') <> '' then btrim(p->>'event_name') else event_name end,
    event_date = case when p ? 'event_date' then nullif(p->>'event_date', '')::date else event_date end,
    target_participants = case when p ? 'target_participants' then nullif(p->>'target_participants', '')::integer else target_participants end,
    tree_equivalent_kg = case when p ? 'tree_equivalent_kg' then nullif(p->>'tree_equivalent_kg', '')::numeric else tree_equivalent_kg end,
    submissions_open = case when p ? 'submissions_open' then (p->>'submissions_open')::boolean else submissions_open end,
    live_counter_enabled = case when p ? 'live_counter_enabled' then (p->>'live_counter_enabled')::boolean else live_counter_enabled end,
    updated_at = now()
  where id = 1;
end;
$$;

-- Operasyon girdilerini kaydet (Excel "Etkinlik Girdileri").
create or replace function public.admin_save_operational(p jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'not_authorized' using errcode = '42501'; end if;
  insert into public.event_operational_inputs (event_id, electricity_kwh, natural_gas_m3, water_m3, paper_kg,
      mixed_waste_kg, food_waste_landfill_kg, food_waste_compost_kg)
  values (1,
      coalesce(nullif(p->>'electricity_kwh', '')::numeric, 0), coalesce(nullif(p->>'natural_gas_m3', '')::numeric, 0),
      coalesce(nullif(p->>'water_m3', '')::numeric, 0), coalesce(nullif(p->>'paper_kg', '')::numeric, 0),
      coalesce(nullif(p->>'mixed_waste_kg', '')::numeric, 0), coalesce(nullif(p->>'food_waste_landfill_kg', '')::numeric, 0),
      coalesce(nullif(p->>'food_waste_compost_kg', '')::numeric, 0))
  on conflict (event_id) do update set
      electricity_kwh = excluded.electricity_kwh, natural_gas_m3 = excluded.natural_gas_m3, water_m3 = excluded.water_m3,
      paper_kg = excluded.paper_kg, mixed_waste_kg = excluded.mixed_waste_kg,
      food_waste_landfill_kg = excluded.food_waste_landfill_kg, food_waste_compost_kg = excluded.food_waste_compost_kg,
      updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Fonksiyon yetkileri: önce herkesten al, sonra yalnızca gerekenlere ver.
-- ---------------------------------------------------------------------------
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.submit_carbon(uuid, text, text, text, integer, integer, integer, numeric, text, numeric, integer) from public, anon, authenticated;
revoke all on function public.public_counter() from public, anon, authenticated;
revoke all on function public.admin_summary() from public, anon, authenticated;
revoke all on function public.admin_recent_submissions(integer, integer) from public, anon, authenticated;
revoke all on function public.admin_update_settings(jsonb) from public, anon, authenticated;
revoke all on function public.admin_save_operational(jsonb) from public, anon, authenticated;
revoke all on function public.admin_delete_submission(bigint) from public, anon, authenticated;
revoke all on function public.admin_delete_all_submissions(text) from public, anon, authenticated;

grant execute on function public.submit_carbon(uuid, text, text, text, integer, integer, integer, numeric, text, numeric, integer) to anon, authenticated;
grant execute on function public.public_counter() to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_summary() to authenticated;
grant execute on function public.admin_recent_submissions(integer, integer) to authenticated;
grant execute on function public.admin_update_settings(jsonb) to authenticated;
grant execute on function public.admin_save_operational(jsonb) to authenticated;
grant execute on function public.admin_delete_submission(bigint) to authenticated;
grant execute on function public.admin_delete_all_submissions(text) to authenticated;
