// Formu geliştiren ekibin künyesi (logo + açıklayıcı cümle).
export default function Credit() {
  return (
    <aside className="credit" aria-label="Geliştirici">
      <img src="/istasyon-logo.png" alt="İSTASYON" width="160" height="40" loading="lazy" decoding="async" />
      <p>
        Bu karbon hesaplama formu <b>İSTASYON</b> ekibi tarafından geliştirilmiştir. Amacı, etkinliğin karbon ayak izini
        kişisel veri toplamadan, şeffaf ve anonim biçimde ölçmektir.
      </p>
    </aside>
  );
}
