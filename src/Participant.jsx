import { useEffect, useMemo, useRef, useState } from 'react';
import { CITIES, DISTANCE_LIMITS, LIMITS, calculate, oneWayDistanceKm } from './lib/carbon.js';
import { MODES, MODE_BY_ID } from './data/modes.js';
import { EVENT_CONFIG } from './config.js';
import { newSessionId, submitCarbon, saveErrorMessage } from './api.js';
import Result from './Result.jsx';

const POPULAR = ['İstanbul', 'Ankara', 'İzmir', 'Adana', 'Şanlıurfa', 'Diyarbakır', 'Kahramanmaraş', 'Hatay', 'Mersin', 'Kayseri'];
const tr = (s) => s.toLocaleLowerCase('tr-TR');

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
  const [distanceEdit, setDistanceEdit] = useState(null); // null = kullanıcı dokunmadı, ilden gelen öneri geçerli
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { values, status: 'saving'|'saved'|'failed', trees, message }
  const sessionId = useRef(newSessionId()); // yalnızca çift gönderimi önler; saklanmaz, izleme yapmaz
  const headingRef = useRef(null);

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));
  const modeDef = MODE_BY_ID[form.mode];
  const needsDetails = Boolean(modeDef && (modeDef.subtypes.length > 1 || modeDef.askOccupancy || modeDef.askDistance));
  const steps = useMemo(() => ['city', 'mode', ...(needsDetails ? ['details'] : []), 'stay', 'confirm'], [needsDetails]);
  const current = steps[step];

  // İlden hesaplanan tek yön karayolu mesafesi öneri olarak gelir; Gaziantep'ten gelenlerde 0 olduğundan boş bırakılıp sorulur.
  const suggestedKm = modeDef?.askDistance && form.city ? Math.round(oneWayDistanceKm(form.city, form.mode)) : 0;
  const distanceValue = distanceEdit ?? (suggestedKm > 0 ? String(suggestedKm) : '');
  const distanceNumber = distanceValue === '' ? NaN : Number(distanceValue);

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
    setDistanceEdit(null);
  }

  async function save(values) {
    setResult((r) => ({ ...r, status: 'saving', message: '' }));
    try {
      const saved = await submitCarbon(sessionId.current, {
        city: values.city, mode: values.mode, subtype: values.subtype,
        occupancy: values.occupancy, hotelNights: values.hotel_nights, roomOccupancy: values.room_occupancy,
        distanceKm: values.distance_source === 'user' ? values.distance_km : null,
      });
      // Sunucu hesabı esastır.
      setResult({ values: { ...values, ...saved }, status: 'saved', trees: saved.tree_count ?? null, message: '' });
    } catch (e) {
      setResult((r) => ({ ...r, status: 'failed', message: saveErrorMessage(e.code) }));
    }
  }

  function next() {
    setError('');
    if (current === 'city' && !CITIES.includes(form.city)) return setError('Lütfen listeden geldiğiniz ili seçin.');
    if (current === 'mode' && !modeDef) return setError('Lütfen ulaşım türünü seçin.');
    if (current === 'details' && modeDef.askDistance
        && !(Number.isFinite(distanceNumber) && distanceNumber >= DISTANCE_LIMITS.min && distanceNumber <= DISTANCE_LIMITS.max)) {
      return setError(`Lütfen yaklaşık mesafeyi km olarak yazın (${DISTANCE_LIMITS.min}–${DISTANCE_LIMITS.max}).`);
    }
    if (current !== 'confirm') return setStep((s) => s + 1);

    const values = calculate({
      city: form.city, mode: form.mode, subtype: form.subtype,
      occupancy: form.occupancy, hotelNights: form.hotelNights, roomOccupancy: form.roomOccupancy,
      distanceKm: modeDef.askDistance ? distanceNumber : null,
    });
    setResult({ values, status: 'saving', trees: null, message: '' });
    save(values);
  }

  function restart() {
    sessionId.current = newSessionId();
    setForm(INITIAL); setDistanceEdit(null); setQuery(''); setError(''); setResult(null); setStep(0);
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
        {result ? (
          <Result headingRef={headingRef} values={result.values} trees={result.trees} status={result.status} message={result.message}
            onRetry={() => save(result.values)} onRestart={restart} />
        ) : (
          <div className="step" key={current}>
            {step === 0 && (
              <p className="intro">Etkinlikteki kişisel karbon ayak izinizi yaklaşık 1 dakikada hesaplayın.<br /><b>Anonim hesaplama:</b> ad soyad, telefon ve e-posta alınmaz.</p>
            )}
            <div className="eyebrow">{String(step + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</div>

            {current === 'city' && <>
              <h1 ref={headingRef} tabIndex={-1}>Etkinliğe nereden geldiniz?</h1>
              <p className="muted">Geldiğiniz ili seçin.</p>
              <label htmlFor="city-search" className="sr-only">İl ara</label>
              <input id="city-search" type="search" autoComplete="off" value={query} placeholder="İl ara…"
                onChange={(e) => { setQuery(e.target.value); if (form.city && e.target.value !== form.city) { update({ city: '' }); setDistanceEdit(null); } }} />
              {form.city && <p className="selected-city" aria-live="polite">✓ Seçilen il: <b>{form.city}</b></p>}
              <div className="chips" role="group" aria-label="İl önerileri">
                {cityMatches.map((c) => (
                  <button type="button" key={c} className={`chip ${form.city === c ? 'selected' : ''}`} aria-pressed={form.city === c}
                    onClick={() => { update({ city: c }); setDistanceEdit(null); setQuery(c); setError(''); }}>{c}</button>
                ))}
                {cityMatches.length === 0 && <span className="muted">Eşleşen il bulunamadı.</span>}
              </div>
            </>}

            {current === 'mode' && <>
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

            {current === 'details' && <>
              <h1 ref={headingRef} tabIndex={-1}>{modeDef.subtypeTitle ?? 'Yolculuk mesafeniz'}</h1>
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
              {modeDef.askDistance && <>
                <h2><label htmlFor="km">Yaklaşık kaç km yol kat ettiniz?</label></h2>
                <div className="km-field">
                  <input id="km" type="number" inputMode="numeric" min={DISTANCE_LIMITS.min} max={DISTANCE_LIMITS.max} step="1"
                    value={distanceValue} placeholder="0" onChange={(e) => { setDistanceEdit(e.target.value); setError(''); }} />
                  <span aria-hidden="true">km</span>
                </div>
                <p className="muted fine">
                  {suggestedKm > 0
                    ? `Tek yön, yaklaşık değer yeterli. ${form.city} – Gaziantep arası yaklaşık ${suggestedKm.toLocaleString('tr-TR')} km olarak dolduruldu; farklıysa değiştirin.`
                    : 'Tek yön, yaklaşık değer yeterli: evinizden etkinlik alanına yaklaşık mesafeyi yazın.'}
                </p>
              </>}
            </>}

            {current === 'stay' && <>
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

            {current === 'confirm' && <>
              <h1 ref={headingRef} tabIndex={-1}>Hazırsınız.</h1>
              <p className="muted">Cevaplarınızdan ulaşım ve konaklama kaynaklı yaklaşık karbon ayak izinizi hesaplayacağız.</p>
              <ul className="summary">
                <li>{form.city}</li>
                <li>{form.mode}{modeDef.subtypes.length > 1 ? ` · ${form.subtype}` : ''}{modeDef.askOccupancy ? ` · ${form.occupancy} kişi` : ''}{modeDef.askDistance ? ` · yaklaşık ${distanceNumber.toLocaleString('tr-TR')} km` : ''}</li>
                <li>{form.hotelNights > 0 ? `${form.hotelNights} gece · odada ${form.roomOccupancy} kişi` : 'Konaklama yok'}</li>
              </ul>
            </>}

            {error && <div className="error" role="alert">{error}</div>}

            <div className="actions">
              <button type="button" className="ghost" disabled={step === 0} onClick={() => { setError(''); setStep((s) => s - 1); }}>Geri</button>
              <button type="button" className="primary" onClick={next}>{current === 'confirm' ? 'Sonucumu Gör' : 'Devam Et'}</button>
            </div>
          </div>
        )}
      </section>
      <footer>Anonim hesaplama · Ad soyad, telefon ve e-posta alınmaz</footer>
    </main>
  );
}
