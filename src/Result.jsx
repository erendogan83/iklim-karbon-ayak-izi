import { useEffect, useRef, useState } from 'react';
import { EVENT_CONFIG } from './config.js';

const MAX_TREES_SHOWN = 18;
const kg = (n) => Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

// Hedef değere doğru yumuşakça sayar. Hedef değişirse (örn. sunucu sonucu gelince) mevcut değerden devam eder.
function useCountUp(target, ms = 1300) {
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0));
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion()) { from.current = target; setValue(target); return undefined; }
    const start = from.current;
    let raf;
    let t0;
    const tick = (t) => {
      t0 ??= t;
      const p = Math.min(1, (t - t0) / ms);
      const v = start + (target - start) * (1 - (1 - p) ** 3);
      from.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

// Çam (kozalaklı) silueti
function Tree({ i }) {
  return (
    <svg className="tree-svg" viewBox="0 0 40 52" style={{ '--i': i }} aria-hidden="true">
      <rect x="18" y="42" width="4" height="9" rx="1" fill="#7a5a3a" />
      <polygon points="20,2 31,19 9,19" fill="#2a8a5e" />
      <polygon points="20,12 34,32 6,32" fill="#1f7a52" />
      <polygon points="20,24 37,45 3,45" fill="#186a46" />
    </svg>
  );
}

// values: hesap sonucu, trees: dikilecek ağaç sayısı (onaylı katsayı yoksa null)
export default function Result({ headingRef, values, trees, status, message, onRetry, onRestart }) {
  const total = useCountUp(Number(values.total_kg));
  const treeCount = useCountUp(trees ?? 0, 1100);
  const shown = Math.min(trees ?? 0, MAX_TREES_SHOWN);

  return (
    <div className="result">
      <div className="eyebrow">SONUÇ</div>
      <h1 ref={headingRef} tabIndex={-1} className="result-title">Karbon Ayak İziniz</h1>
      <div className="big-number" aria-label={`${kg(values.total_kg)} kilogram karbondioksit eşdeğeri`}>{kg(total)}</div>
      <div className="unit">kg CO₂e</div>
      <div className="split">
        <div><small>Ulaşım</small><b>{kg(values.transport_kg)} kg CO₂e</b></div>
        <div><small>Konaklama</small><b>{kg(values.accommodation_kg)} kg CO₂e</b></div>
      </div>
      <p className="muted fine">Bu değer etkinlik kapsamında verdiğiniz ulaşım ve konaklama bilgilerine göre hesaplanan yaklaşık bireysel emisyon değeridir.</p>

      {trees != null && (
        <div className="grove-card" role="group" aria-label="Dikilecek ağaç">
          {trees > 0 ? <>
            <div className="grove" aria-hidden="true">
              {Array.from({ length: shown }, (_, i) => <Tree key={i} i={i} />)}
              {trees > shown && <span className="grove-more">+{trees - shown}</span>}
            </div>
            <div className="grove-text">
              <strong><span className="tree-count">{Math.round(treeCount).toLocaleString('tr-TR')}</span> adet fide</strong>
              <p>Karbon ayak izinize karşılık {EVENT_CONFIG.planter} tarafından {trees.toLocaleString('tr-TR')} adet {EVENT_CONFIG.treeName} dikilecektir.</p>
              <small>Fide sayısı yaklaşık bir hesaba dayanır.</small>
            </div>
          </> : (
            <div className="grove-text"><strong>Teşekkürler!</strong><p>Ayak iziniz sıfır olduğu için ek fide dikimi gerekmiyor.</p></div>
          )}
        </div>
      )}

      <div className={`status ${status}`} role="status" aria-live="polite">
        {status === 'saving' && 'Sonucunuz anonim olarak kaydediliyor…'}
        {status === 'saved' && '✓ Sonucunuz anonim olarak kaydedildi.'}
        {status === 'failed' && <>
          <span>{message}</span>
          <button type="button" className="ghost small" onClick={onRetry}>Tekrar dene</button>
        </>}
      </div>
      <button type="button" className="primary" onClick={onRestart} disabled={status === 'saving'}>Yeni hesaplama</button>
    </div>
  );
}
