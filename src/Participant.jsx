import { useEffect, useMemo, useRef, useState } from 'react';
import { CITIES, LIMITS, calculate } from './lib/carbon.js';
import { MODES, MODE_BY_ID } from './data/modes.js';
import { EVENT_CONFIG } from './config.js';
import { newSessionId, submitCarbon, saveErrorMessage } from './api.js';

const POPULAR = ['İstanbul', 'Ankara', 'İzmir', 'Adana', 'Şanlıurfa', 'Diyarbakır', 'Kahramanmaraş', 'Hatay', 'Mersin', 'Kayseri'];
const tr = (s) => s.toLocaleLowerCase('tr-TR');
const kg = (n) => Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const INITIAL = { city: '', mode: '', subtype: '', occupancy: 1, hotelNights: 0, roomOccupancy: 1 };

function Counter({ label, value, min, max, onChange }) {
  return (
    <div className="counter" role="group" aria-label={label}>
      <button type="button" aria-label={`${label}: azalt`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <output aria-live="polite"><strong>{value}</strong></output>
      <button type="button" aria-label={`${label}: artır`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

export default function Participant() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(INITIAL);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { values, status: 'saving'|'saved'|'failed', tree, message }
  const sessionId = useRef(newSessionId()); // yalnızca çift gönderimi önler; saklanmaz, izleme yapmaz
  const headingRef = useRef(null);

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));
  const modeDef = MODE_BY_ID[form.mode];
  const needsDetails = Boolean(modeDef && (modeDef.subtypes.length > 1 || modeDef.askOccupancy));
  const steps = useMemo(() => ['city', 'mode', ...(needsDetails ? ['details'] : []), 'stay', 'confirm'], [needsDetails]);
  const current = steps[step];

  useEffect(() => { headingRef.current?.focus(); }, [step, result === null]);
  // Gönderim gecikmesi olmasın: son adımda supabase paketini arka planda ısıt.
  useEffect(() => { if (current === 'confirm') import('./supabase.js').catch(() => {}); }, [current]);

  const cityMatches = useMemo(() => {
    const q = tr(query.trim());
    if (!q) return POPULAR;
    const starts = CITIES.filter((c) => tr(c).startsWith(q));
    const contains = CITIES.filter((c) => !tr(c).startsWith(q) && tr(c).includes(q));
    return [...starts, ...contains].slice(0, 8);
  }, [query]);

  function chooseMode(id) {
    update({ mode: id, subtype: MODE_BY_ID[id].defaultSubtype, occupancy: 1 });
  }

  async function save(values) {
    setResult((r) => ({ ...r, status: 'saving', message: '' }));
    try {
      const saved = await submitCarbon(sessionId.current, {
        city: values.city, mode: values.mode, subtype: values.subtype,
        occupancy: values.occupancy, hotelNights: values.hotel_nights, roomOccupancy: values.room_occupancy,
      });
      // Sunucu hesabı esastır.
      setResult({ values: { ...values, ...saved }, status: 'saved', tree: saved.tree_equivalent ?? null, message: '' });
    } catch (e) {
      setResult((r) => ({ ...r, status: 'failed', message: saveErrorMessage(e.code) }));
    }
  }

  function next() {
    setError('');
    if (current === 'city' && !CITIES.includes(form.city)) return setError('Lütfen listeden geldiğiniz ili seçin.');
    if (current === 'mode' && !modeDef) return setError('Lütfen ulaşım türünü seçin.');
    if (current !== 'confirm') return setStep((s) => s + 1);

    const values = calculate({
      city: form.city, mode: form.mode, subtype: form.subtype,
      occupancy: form.occupancy, hotelNights: form.hotelNights, roomOccupancy: form.roomOccupancy,
    });
    setResult({ values, status: 'saving', tree: null, message: '' });
    save(values);
  }

  function restart() {
    sessionId.current = newSessionId();
    setForm(INITIAL); setQuery(''); setError(''); setResult(null); setStep(0);
  }

  return (
    <main className="app-shell">
      <div className="brand">
        <span className="leaf" aria-hidden="true">◒</span>
        <div><strong>{EVENT_CONFIG.name.toLocaleUpperCase('tr-TR')}</strong><small>Etkinlik Karbon Ayak İzi</small></div>
      </div>

      {!result && (
        <div className="progress" role="progressbar" aria-label="İlerleme" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={step + 1} aria-valuetext={`Adım ${step + 1} / ${steps.length}`}>
          <span style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>
      )}

      <section className="card">
        {!result && step === 0 && (
          <p className="intro">Etkinlikteki kişisel karbon ayak izinizi yaklaşık 1 dakikada hesaplayın.<br /><b>Anonim hesaplama:</b> ad soyad, telefon ve e-posta alınmaz.</p>
        )}

        {!result && (
          <div className="eyebrow">{String(step + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</div>
        )}

        {!result && current === 'city' && <>
          <h1 ref={headingRef} tabIndex={-1}>Etkinliğe nereden geldiniz?</h1>
          <p className="muted">Geldiğiniz ili seçin. Mesafe otomatik hesaplanır.</p>
          <label htmlFor="city-search" className="sr-only">İl ara</label>
          <input id="city-search" type="search" autoComplete="off" value={query} placeholder="İl ara…"
            onChange={(e) => { setQuery(e.target.value); if (form.city && e.target.value !== form.city) update({ city: '' }); }} />
          {form.city && <p className="selected-city" aria-live="polite">✓ Seçilen il: <b>{form.city}</b></p>}
          <div className="chips" role="group" aria-label="İl önerileri">
            {cityMatches.map((c) => (
              <button type="button" key={c} className={`chip ${form.city === c ? 'selected' : ''}`} aria-pressed={form.city === c}
                onClick={() => { update({ city: c }); setQuery(c); setError(''); }}>{c}</button>
            ))}
            {cityMatches.length === 0 && <span className="muted">Eşleşen il bulunamadı.</span>}
          </div>
        </>}

        {!result && current === 'mode' && <>
          <h1 ref={headingRef} tabIndex={-1}>Nasıl geldiniz?</h1>
          <p className="muted">Ana ulaşım aracınızı seçin.</p>
          <div className="grid" role="group" aria-label="Ulaşım türü">
            {MODES.map((m) => (
              <button type="button" key={m.id} className={`option ${form.mode === m.id ? 'selected' : ''}`} aria-pressed={form.mode === m.id}
                onClick={() => { chooseMode(m.id); setError(''); }}>
                <span aria-hidden="true">{m.icon}</span><b>{m.label}</b>
              </button>
            ))}
          </div>
        </>}

        {!result && current === 'details' && <>
          <h1 ref={headingRef} tabIndex={-1}>{modeDef.subtypeTitle ?? 'Ulaşım ayrıntısı'}</h1>
          {modeDef.subtypes.length > 1 && (
            <div className="grid two" role="group" aria-label={modeDef.subtypeTitle}>
              {modeDef.subtypes.map((v) => (
                <button type="button" key={v} className={`option compact ${form.subtype === v ? 'selected' : ''}`} aria-pressed={form.subtype === v}
                  onClick={() => update({ subtype: v })}>{v}</button>
              ))}
            </div>
          )}
          {modeDef.askOccupancy && <>
            <h2>Araçta toplam kaç kişiydiniz?</h2>
            <Counter label="Araçtaki kişi sayısı" value={form.occupancy} {...LIMITS.occupancy} onChange={(v) => update({ occupancy: v })} />
          </>}
        </>}

        {!result && current === 'stay' && <>
          <h1 ref={headingRef} tabIndex={-1}>Gaziantep'te konaklayacak mısınız?</h1>
          <div className="grid two" role="group" aria-label="Konaklama">
            <button type="button" className={`option compact ${form.hotelNights === 0 ? 'selected' : ''}`} aria-pressed={form.hotelNights === 0}
              onClick={() => update({ hotelNights: 0, roomOccupancy: 1 })}>Hayır</button>
            <button type="button" className={`option compact ${form.hotelNights > 0 ? 'selected' : ''}`} aria-pressed={form.hotelNights > 0}
              onClick={() => update({ hotelNights: Math.max(1, form.hotelNights) })}>Evet</button>
          </div>
          {form.hotelNights > 0 && <>
            <h2>Kaç gece?</h2>
            <Counter label="Gece sayısı" value={form.hotelNights} min={1} max={LIMITS.hotelNights.max} onChange={(v) => update({ hotelNights: v })} />
            <h2>Odayı kaç kişi paylaşıyor?</h2>
            <Counter label="Odadaki kişi sayısı" value={form.roomOccupancy} {...LIMITS.roomOccupancy} onChange={(v) => update({ roomOccupancy: v })} />
          </>}
        </>}

        {!result && current === 'confirm' && <>
          <h1 ref={headingRef} tabIndex={-1}>Hazırsınız.</h1>
          <p className="muted">Cevaplarınızdan ulaşım ve konaklama kaynaklı yaklaşık karbon ayak izinizi hesaplayacağız.</p>
          <ul className="summary">
            <li>{form.city}</li>
            <li>{form.mode}{modeDef.subtypes.length > 1 ? ` · ${form.subtype}` : ''}{modeDef.askOccupancy ? ` · ${form.occupancy} kişi` : ''}</li>
            <li>{form.hotelNights > 0 ? `${form.hotelNights} gece · odada ${form.roomOccupancy} kişi` : 'Konaklama yok'}</li>
          </ul>
        </>}

        {result && (() => {
          const v = result.values;
          return (
            <div className="result">
              <div className="result-icon" aria-hidden="true">🌱</div>
              <div className="eyebrow">SONUÇ</div>
              <h1 ref={headingRef} tabIndex={-1} className="result-title">Karbon Ayak İziniz</h1>
              <div className="big-number">{kg(v.total_kg)}</div>
              <div className="unit">kg CO₂e</div>
              <div className="split">
                <div><small>Ulaşım</small><b>{kg(v.transport_kg)} kg CO₂e</b></div>
                <div><small>Konaklama</small><b>{kg(v.accommodation_kg)} kg CO₂e</b></div>
              </div>
              <p className="muted fine">Bu değer etkinlik kapsamında verdiğiniz ulaşım ve konaklama bilgilerine göre hesaplanan yaklaşık bireysel emisyon değeridir.</p>

              {result.tree != null && (
                <div className="tree-card">
                  <div className="tree" aria-hidden="true">🌳</div>
                  <div><small>Ağaç eşdeğeri (yaklaşık)</small><strong>≈ {result.tree.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</strong>
                    <p>Karşılaştırma amaçlı bir gösterimdir; karbon dengelemesi taahhüdü değildir.</p></div>
                </div>
              )}

              <div className={`status ${result.status}`} role="status" aria-live="polite">
                {result.status === 'saving' && 'Sonucunuz anonim olarak kaydediliyor…'}
                {result.status === 'saved' && '✓ Sonucunuz anonim olarak kaydedildi.'}
                {result.status === 'failed' && <>
                  <span>{result.message}</span>
                  <button type="button" className="ghost small" onClick={() => save(v)}>Tekrar dene</button>
                </>}
              </div>
              <button type="button" className="primary" onClick={restart} disabled={result.status === 'saving'}>Yeni hesaplama</button>
            </div>
          );
        })()}

        {error && <div className="error" role="alert">{error}</div>}

        {!result && (
          <div className="actions">
            <button type="button" className="ghost" disabled={step === 0} onClick={() => { setError(''); setStep((s) => s - 1); }}>Geri</button>
            <button type="button" className="primary" onClick={next}>{current === 'confirm' ? 'Sonucumu Gör' : 'Devam Et'}</button>
          </div>
        )}
      </section>
      <footer>Anonim hesaplama · Ad soyad, telefon ve e-posta alınmaz</footer>
    </main>
  );
}
