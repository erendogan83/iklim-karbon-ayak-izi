import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase.js';

const PAGE_SIZE = 25;
const num = (n, d = 0) => Number(n ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const kgFmt = (n) => `${num(n, 2)} kg`;
const tonFmt = (kg) => `${num(Number(kg ?? 0) / 1000, 2)} t`;
const pct = (r) => (r == null ? '—' : `%${num(Number(r) * 100, 1)}`);

// CSV: UTF-8 BOM + ';' ayırıcı (Türkçe Excel). '=', '+', '-', '@' ile başlayan metinler formül enjeksiyonuna karşı etkisizleştirilir.
const csvCell = (v) => {
  let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
};

function buildReport(s) {
  const rows = [
    ['ETKİNLİK KARBON AYAK İZİ RAPORU'],
    ['Etkinlik adı', s.settings.event_name],
    ['Etkinlik tarihi', s.settings.event_date ?? ''],
    ['Rapor tarihi', new Date().toLocaleDateString('tr-TR')],
    [],
    ['ÖZET (kg CO2e)'],
    ['Hedef toplam katılımcı', s.estimate.target_participants ?? ''],
    ['Form cevap sayısı', s.responses],
    ['Kapsama oranı', s.estimate.coverage == null ? '' : Number(s.estimate.coverage)],
    ['Ölçülen katılımcı emisyonu', Number(s.measured.total_kg)],
    ['Tahmini katılımcı emisyonu', Number(s.estimate.participant_estimated_kg)],
    ['Operasyonel emisyon', Number(s.operational.total_kg)],
    ['Toplam etkinlik emisyonu (ölçülen + operasyon)', Number(s.event_total.measured_kg)],
    ['Toplam etkinlik emisyonu (tahmini + operasyon)', Number(s.event_total.estimated_kg)],
    [],
    ['Ulaşım kaynaklı (ölçülen)', Number(s.measured.transport_kg)],
    ['Konaklama kaynaklı (ölçülen)', Number(s.measured.accommodation_kg)],
    ['Konaklama yapan katılımcı', s.measured.hotel_guests],
    ['Toplam konaklama gecesi', s.measured.hotel_nights],
    ['Son kilometre ulaşımı kullanan katılımcı', s.measured.last_mile_users],
    ['Son kilometre ulaşımı emisyonu (kg CO2e)', Number(s.measured.last_mile_kg)],
    ['1 fide katsayısı (kg CO2e)', s.trees ? Number(s.trees.kg_per_tree) : ''],
    ['Dikilecek fide (tahmini etkinlik toplamına göre)', s.trees ? Number(s.trees.event_estimated) : ''],
    ['Dikilecek fide (katılımcı bazlı yuvarlamayla, yalnızca yanıt verenler)', s.trees ? Number(s.trees.participants_individual) : ''],
    [],
    ['ULAŞIM TÜRÜ DAĞILIMI'],
    ['Ulaşım türü', 'Katılımcı', 'Toplam kg CO2e', 'Ulaşım kg CO2e'],
    ...s.by_mode.map((m) => [m.mode, m.count, Number(m.total_kg), Number(m.transport_kg)]),
    [],
    ['İL BAZLI DAĞILIM'],
    ['İl', 'Katılımcı', 'Toplam kg CO2e'],
    ...s.by_city.map((c) => [c.city, c.count, Number(c.total_kg)]),
    [],
    ['OPERASYON GİRDİLERİ'],
    ['Kalem', 'Miktar', 'Birim', 'Faktör', 'kg CO2e'],
    ...s.operational.items.map((i) => [i.label, Number(i.amount), i.unit, Number(i.factor), Number(i.kg)]),
  ];
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(/invalid/i.test(err.message) ? 'E-posta veya şifre hatalı.' : 'Giriş yapılamadı. Lütfen tekrar deneyin.');
    setBusy(false);
  }
  return (
    <main className="admin-shell narrow">
      <section className="admin-card">
        <div className="eyebrow">YÖNETİCİ PANELİ</div>
        <h1>Karbon Ayak İzi</h1>
        <p className="muted">Bu alan yalnızca yetkili kullanıcılar içindir.</p>
        <form onSubmit={submit}>
          <label className="field"><span>E-posta</span>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="field"><span>Şifre</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <button className="primary" disabled={busy}>{busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</button>
        </form>
        {error && <div className="error" role="alert">{error}</div>}
      </section>
    </main>
  );
}

// İl bazlı dağılım: yatay çubuk grafik (katılımcı sayısı veya emisyon).
function CityChart({ rows }) {
  const [metric, setMetric] = useState('count');
  const [all, setAll] = useState(false);
  if (rows.length === 0) return <p className="muted">Henüz kayıt yok.</p>;
  const value = (r) => (metric === 'count' ? Number(r.count) : Number(r.total_kg));
  const sorted = [...rows].sort((a, b) => value(b) - value(a) || a.city.localeCompare(b.city, 'tr'));
  const shown = all ? sorted : sorted.slice(0, 12);
  const max = Math.max(1, ...shown.map(value));
  const sum = rows.reduce((a, r) => a + value(r), 0) || 1;
  return (
    <>
      <div className="seg" role="group" aria-label="Grafik ölçütü">
        <button type="button" className={metric === 'count' ? 'on' : ''} aria-pressed={metric === 'count'} onClick={() => setMetric('count')}>Katılımcı sayısı</button>
        <button type="button" className={metric === 'kg' ? 'on' : ''} aria-pressed={metric === 'kg'} onClick={() => setMetric('kg')}>Emisyon (kg CO₂e)</button>
      </div>
      {shown.map((r) => (
        <div className="bar" key={r.city}>
          <span>{r.city} <small>· %{num((value(r) / sum) * 100, 1)}</small></span>
          <b>{metric === 'count' ? num(r.count) : `${num(r.total_kg, 0)} kg`}</b>
          <i style={{ width: `${Math.max(2, (value(r) / max) * 100)}%` }} />
        </div>
      ))}
      {rows.length > 12 && (
        <button type="button" className="ghost small" onClick={() => setAll((v) => !v)}>
          {all ? 'Daha az göster' : `Tüm illeri göster (${rows.length})`}
        </button>
      )}
    </>
  );
}

// Tehlikeli bölge: tüm kayıtları silmek için "SİL" yazdırır.
function DangerZone({ total, busy, onDelete }) {
  const [text, setText] = useState('');
  const confirmed = text.trim().toLocaleUpperCase('tr-TR') === 'SİL';
  return (
    <section className="admin-card danger-zone">
      <h2>Deneme verilerini temizle</h2>
      <p className="muted">
        Tüm kayıtlar (<b>{num(total)}</b>) kalıcı olarak silinir ve <b>geri alınamaz</b>. Gerçek veri varsa önce yukarıdan CSV raporu indirin.
        Etkinlik ayarları ve operasyon girdileri silinmez.
      </p>
      <label className="field"><span>Onaylamak için SİL yazın</span>
        <input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" placeholder="SİL" /></label>
      <button type="button" className="danger" disabled={busy || total === 0 || !confirmed}
        onClick={async () => { await onDelete(); setText(''); }}>Tüm kayıtları sil</button>
    </section>
  );
}

function Stat({ label, value, sub }) {
  return <div><small>{label}</small><strong>{value}</strong>{sub && <span className="sub">{sub}</span>}</div>;
}

function SettingsForm({ settings, onSave, busy }) {
  const [s, setS] = useState({
    event_name: settings.event_name ?? '', event_date: settings.event_date ?? '',
    target_participants: settings.target_participants ?? '', tree_equivalent_kg: settings.tree_equivalent_kg ?? '',
    submissions_open: settings.submissions_open, live_counter_enabled: settings.live_counter_enabled ?? true,
  });
  const set = (k) => (e) => setS((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return (
    <form className="admin-card form-grid" onSubmit={(e) => { e.preventDefault(); onSave(s); }}>
      <h2>Etkinlik ayarları</h2>
      <label className="field"><span>Etkinlik adı</span><input value={s.event_name} onChange={set('event_name')} maxLength={120} required /></label>
      <label className="field"><span>Etkinlik tarihi</span><input type="date" value={s.event_date} onChange={set('event_date')} /></label>
      <label className="field"><span>Toplam katılımcı sayısı (hedef)</span>
        <input type="number" min="0" step="1" inputMode="numeric" value={s.target_participants} onChange={set('target_participants')} />
        <em>Girilirse katılımcı emisyonu kapsama oranına göre tahmin edilir.</em></label>
      <label className="field"><span>1 fidenin karşıladığı karbon (kg CO₂e)</span>
        <input type="number" min="0" step="any" inputMode="decimal" value={s.tree_equivalent_kg} onChange={set('tree_equivalent_kg')} />
        <em>Katılımcıya "karbon ayak izinize karşılık N adet fide dikilecektir" olarak gösterilir (yukarı yuvarlanır). Boş bırakılırsa fide gösterilmez. Önerilen yaklaşık değer: 50.</em></label>
      <label className="check"><input type="checkbox" checked={s.submissions_open} onChange={set('submissions_open')} /> Form yanıt kabul ediyor</label>
      <label className="check"><input type="checkbox" checked={s.live_counter_enabled} onChange={set('live_counter_enabled')} /> Katılımcıya sonuç sonrası canlı sayaç göster (yalnızca toplam sayılar)</label>
      <button className="primary" disabled={busy}>Ayarları kaydet</button>
    </form>
  );
}

function OperationalForm({ items, onSave, busy }) {
  const [vals, setVals] = useState(() => Object.fromEntries(items.map((i) => [i.field, i.amount])));
  return (
    <form className="admin-card form-grid" onSubmit={(e) => { e.preventDefault(); onSave(vals); }}>
      <h2>Etkinlik operasyon girdileri</h2>
      <p className="muted">Etkinlik bittikten sonra girilir. Katılımcıya sorulmaz.</p>
      {items.map((i) => (
        <label className="field" key={i.field}>
          <span>{i.label} ({i.unit})</span>
          <input type="number" min="0" step="any" inputMode="decimal" value={vals[i.field]}
            onChange={(e) => setVals((v) => ({ ...v, [i.field]: e.target.value }))} />
          <em>Faktör {num(i.factor, 5)} kg CO₂e/{i.unit} → {kgFmt(i.kg)}</em>
        </label>
      ))}
      <button className="primary" disabled={busy}>Operasyon girdilerini kaydet</button>
    </form>
  );
}

function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [recent, setRecent] = useState({ total: 0, rows: [] });
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const call = async (fn, args) => {
    const { data, error: err } = await supabase.rpc(fn, args);
    if (err) throw err;
    return data;
  };

  const load = useCallback(async (p = 0) => {
    setBusy(true); setError('');
    try {
      const [s, r] = await Promise.all([call('admin_summary'), call('admin_recent_submissions', { p_limit: PAGE_SIZE, p_offset: p * PAGE_SIZE })]);
      setSummary(s); setRecent(r); setPage(p);
    } catch (e) { setError(e.message || 'Veriler alınamadı.'); }
    setBusy(false);
  }, []);
  useEffect(() => { load(0); }, [load]);

  async function save(fn, payload, ok) {
    setBusy(true); setError(''); setNote('');
    try { await call(fn, { p: payload }); await load(page); setNote(ok); }
    catch (e) { setError(e.message || 'Kaydedilemedi.'); setBusy(false); }
  }

  async function removeOne(r) {
    if (!window.confirm(`Bu kaydı silmek istediğinize emin misiniz?\n${r.city} · ${r.mode} · ${num(r.total_kg, 2)} kg CO₂e`)) return;
    setBusy(true); setError(''); setNote('');
    try {
      await call('admin_delete_submission', { p_id: r.id });
      const lastPage = Math.max(0, Math.ceil((recent.total - 1) / PAGE_SIZE) - 1);
      await load(Math.min(page, lastPage));
      setNote('Kayıt silindi.');
    } catch (e) { setError(e.message || 'Silinemedi.'); setBusy(false); }
  }

  async function removeAll() {
    setBusy(true); setError(''); setNote('');
    try {
      const n = await call('admin_delete_all_submissions', { p_confirm: 'SİL' });
      await load(0);
      setNote(`${num(n)} kayıt silindi.`);
    } catch (e) { setError(e.message || 'Silinemedi.'); setBusy(false); }
  }

  if (!summary) return <main className="admin-shell">{error ? <div className="error" role="alert">{error}</div> : <p className="muted">Yükleniyor…</p>}</main>;

  const { measured, estimate, operational, event_total: total, settings } = summary;
  const pages = Math.max(1, Math.ceil(recent.total / PAGE_SIZE));
  const maxMode = Math.max(1, ...summary.by_mode.map((m) => m.count));

  return (
    <main className="admin-shell">
      <header className="admin-head">
        <div><div className="eyebrow">YÖNETİCİ PANELİ</div><h1>{settings.event_name}</h1></div>
        <div className="admin-actions">
          <button className="ghost" onClick={() => load(page)} disabled={busy}>Yenile</button>
          <button className="primary" onClick={() => download('karbon-ayak-izi-raporu.csv', buildReport(summary))}>CSV rapor indir</button>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>Çıkış</button>
        </div>
      </header>

      {error && <div className="error" role="alert">{error}</div>}
      {note && <div className="success" role="status">{note}</div>}
      {!settings.submissions_open && <div className="warn">Form şu anda yeni yanıt kabul etmiyor.</div>}

      <section className="stats" aria-label="Ölçülen katılımcı verileri">
        <Stat label="Form cevabı" value={num(summary.responses)} />
        <Stat label="Ölçülen toplam" value={tonFmt(measured.total_kg)} sub={`Kişi başı ${num(measured.avg_kg, 2)} kg`} />
        <Stat label="Ulaşım" value={tonFmt(measured.transport_kg)} sub={`Son kilometre: ${num(measured.last_mile_users)} kişi · ${kgFmt(measured.last_mile_kg)}`} />
        <Stat label="Konaklama" value={tonFmt(measured.accommodation_kg)} sub={`${num(measured.hotel_guests)} kişi · ${num(measured.hotel_nights)} gece`} />
        <Stat label="Dikilecek fide" value={summary.trees == null ? '—' : num(summary.trees.event_estimated)}
          sub={summary.trees == null ? 'Katsayı girilmedi' : `Katılımcı bazlı yuvarlamayla ${num(summary.trees.participants_individual)}`} />
      </section>

      <section className="admin-card">
        <h2>Etkinlik toplam karbon ayak izi</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Kalem</th><th className="r">Ölçülen</th><th className="r">Tahmini</th></tr></thead>
            <tbody>
              <tr><td>Katılımcı emisyonu<br /><small>{num(summary.responses)} yanıt{estimate.target_participants ? ` / ${num(estimate.target_participants)} hedef (kapsama ${pct(estimate.coverage)})` : ''}</small></td>
                <td className="r">{kgFmt(measured.total_kg)}</td><td className="r">{kgFmt(estimate.participant_estimated_kg)}</td></tr>
              <tr><td>Etkinlik operasyonu</td><td className="r">{kgFmt(operational.total_kg)}</td><td className="r">{kgFmt(operational.total_kg)}</td></tr>
              <tr className="total"><td>Toplam</td><td className="r">{kgFmt(total.measured_kg)}</td><td className="r">{kgFmt(total.estimated_kg)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="hint"><b>Ölçülen:</b> formu dolduran katılımcıların gerçek toplamı. <b>Tahmini:</b> ölçülen değer, kapsama oranına bölünerek tüm katılımcılara genellenir (Excel modeliyle aynı).</p>
        {!estimate.target_participants && <div className="warn">Toplam katılımcı sayısı girilmediği için tahmini değer ölçülen değere eşittir.</div>}
        {estimate.over_target && <div className="warn">Yanıt sayısı hedef katılımcı sayısını aşıyor; hedefi güncelleyin. Tahmini değer ölçülenin altına indirilmez.</div>}
        {estimate.coverage != null && Number(estimate.coverage) < 0.3 && <div className="warn">Kapsama düşük ({pct(estimate.coverage)}): tahmin belirsizliği yüksektir.</div>}
      </section>

      <section className="admin-card">
        <h2>Ulaşım türü dağılımı</h2>
        {summary.by_mode.length === 0 && <p className="muted">Henüz kayıt yok.</p>}
        {summary.by_mode.map((m) => (
          <div className="bar" key={m.mode}>
            <span>{m.mode} <small>· {kgFmt(m.total_kg)}</small></span><b>{num(m.count)}</b>
            <i style={{ width: `${Math.max(2, (m.count / maxMode) * 100)}%` }} />
          </div>
        ))}
      </section>

      <section className="admin-card">
        <h2>İl bazlı dağılım <small>({num(summary.by_city.length)} il)</small></h2>
        <CityChart rows={summary.by_city} />
      </section>

      <div className="two-col">
        <SettingsForm key={JSON.stringify(settings)} settings={settings} busy={busy}
          onSave={(s) => save('admin_update_settings', s, 'Ayarlar kaydedildi.')} />
        <OperationalForm key={JSON.stringify(operational.items)} items={operational.items} busy={busy}
          onSave={(v) => save('admin_save_operational', v, 'Operasyon girdileri kaydedildi.')} />
      </div>

      <section className="admin-card">
        <h2>Son kayıtlar <small>({num(recent.total)} kayıt)</small></h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tarih</th><th>İl</th><th>Ulaşım</th><th className="r">Tek yön km</th><th className="r">Gece</th><th className="r">Ulaşım kg</th><th className="r">Konaklama kg</th><th className="r">Toplam kg</th><th><span className="sr-only">İşlem</span></th></tr></thead>
            <tbody>
              {recent.rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString('tr-TR')}</td><td>{r.city}</td><td>{r.mode} · {r.subtype}</td>
                  <td className="r">{num(r.distance_km, 0)}</td><td className="r">{r.hotel_nights}</td>
                  <td className="r">{num(r.transport_kg, 2)}</td><td className="r">{num(r.accommodation_kg, 2)}</td><td className="r">{num(r.total_kg, 2)}</td>
                  <td className="r"><button type="button" className="ghost small danger" disabled={busy} onClick={() => removeOne(r)}>Sil</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <button className="ghost" disabled={busy || page === 0} onClick={() => load(page - 1)}>Önceki</button>
          <span>Sayfa {page + 1} / {pages}</span>
          <button className="ghost" disabled={busy || page + 1 >= pages} onClick={() => load(page + 1)}>Sonraki</button>
        </div>
      </section>

      <DangerZone total={recent.total} busy={busy} onDelete={removeAll} />
    </main>
  );
}

// Oturum + yetki kapısı: giriş yapmış olmak yetmez, admin_users kaydı gerekir.
function Gate() {
  const [state, setState] = useState('checking'); // checking | admin | denied | error
  useEffect(() => {
    let live = true;
    supabase.rpc('is_admin').then(({ data, error }) => { if (live) setState(error ? 'error' : data === true ? 'admin' : 'denied'); });
    return () => { live = false; };
  }, []);
  if (state === 'checking') return <main className="admin-shell narrow"><p className="muted">Yetki kontrol ediliyor…</p></main>;
  if (state === 'admin') return <Dashboard />;
  return (
    <main className="admin-shell narrow">
      <section className="admin-card">
        <h1>{state === 'denied' ? 'Yetkiniz yok' : 'Bağlantı hatası'}</h1>
        <p className="muted">{state === 'denied' ? 'Bu hesap yönetici olarak tanımlı değil.' : 'Yetki kontrol edilemedi. Lütfen daha sonra tekrar deneyin.'}</p>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>Çıkış</button>
      </section>
    </main>
  );
}

export default function Admin() {
  const [session, setSession] = useState(undefined); // undefined = yükleniyor
  useEffect(() => {
    if (!supabase) { setSession(null); return undefined; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!supabase) return <main className="admin-shell narrow"><div className="error" role="alert">Supabase ortam değişkenleri tanımlı değil (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY).</div></main>;
  if (session === undefined) return <main className="admin-shell narrow"><p className="muted">Yükleniyor…</p></main>;
  return session ? <Gate key={session.user.id} /> : <Login />;
}
