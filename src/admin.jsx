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
    ['1 ağaç katsayısı (kg CO2e)', s.trees ? Number(s.trees.kg_per_tree) : ''],
    ['Dikilecek ağaç (tahmini etkinlik toplamına göre)', s.trees ? Number(s.trees.event_estimated) : ''],
    ['Dikilecek ağaç (katılımcı bazlı yuvarlamayla, yalnızca yanıt verenler)', s.trees ? Number(s.trees.participants_individual) : ''],
    [],
    ['ULAŞIM TÜRÜ DAĞILIMI'],
    ['Ulaşım türü', 'Katılımcı', 'Toplam kg CO2e', 'Ulaşım kg CO2e'],
    ...s.by_mode.map((m) => [m.mode, m.count, Number(m.total_kg), Number(m.transport_kg)]),
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

function Stat({ label, value, sub }) {
  return <div><small>{label}</small><strong>{value}</strong>{sub && <span className="sub">{sub}</span>}</div>;
}

function SettingsForm({ settings, onSave, busy }) {
  const [s, setS] = useState({
    event_name: settings.event_name ?? '', event_date: settings.event_date ?? '',
    target_participants: settings.target_participants ?? '', tree_equivalent_kg: settings.tree_equivalent_kg ?? '',
    submissions_open: settings.submissions_open,
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
      <label className="field"><span>1 ağaç eşdeğeri (kg CO₂e)</span>
        <input type="number" min="0" step="any" inputMode="decimal" value={s.tree_equivalent_kg} onChange={set('tree_equivalent_kg')} />
        <em>Katılımcıya "karbon ayak izinize karşılık N ağaç dikilecek" olarak gösterilir (yukarı yuvarlanır). Boş bırakılırsa ağaç gösterilmez. Değeri organizatör belirler.</em></label>
      <label className="check"><input type="checkbox" checked={s.submissions_open} onChange={set('submissions_open')} /> Form yanıt kabul ediyor</label>
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
        <Stat label="Ulaşım" value={tonFmt(measured.transport_kg)} />
        <Stat label="Konaklama" value={tonFmt(measured.accommodation_kg)} sub={`${num(measured.hotel_guests)} kişi · ${num(measured.hotel_nights)} gece`} />
        <Stat label="Dikilecek ağaç" value={summary.trees == null ? '—' : num(summary.trees.event_estimated)}
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
            <thead><tr><th>Tarih</th><th>İl</th><th>Ulaşım</th><th className="r">Tek yön km</th><th className="r">Gece</th><th className="r">Ulaşım kg</th><th className="r">Konaklama kg</th><th className="r">Toplam kg</th></tr></thead>
            <tbody>
              {recent.rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString('tr-TR')}</td><td>{r.city}</td><td>{r.mode} · {r.subtype}</td>
                  <td className="r">{num(r.distance_km, 0)}</td><td className="r">{r.hotel_nights}</td>
                  <td className="r">{num(r.transport_kg, 2)}</td><td className="r">{num(r.accommodation_kg, 2)}</td><td className="r">{num(r.total_kg, 2)}</td>
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
