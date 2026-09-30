# Etkinlik Karbon Ayak İzi

Etkinliğe (Gaziantep) gelen katılımcıların ulaşım ve konaklama kaynaklı karbon ayak izini **anonim** ve hızlı hesaplayan mobil öncelikli web uygulaması; organizatör için toplam etkinlik raporu.

- **Katılımcı (`/`)**: QR ile açılır, 4–5 kısa soru, yalnızca kendi sonucunu görür. Ad, telefon, e-posta, kurum, ülke **alınmaz**.
- **Yönetici (`/admin`)**: Supabase Auth girişi + `admin_users` yetkisi. Toplamlar, ulaşım dağılımı, ölçülen/tahmini ayrımı, operasyon girdileri, CSV rapor.

Stack: React + Vite · Supabase (Postgres, Auth, RLS) · Cloudflare Pages.

## Hesap modeli (Excel: "Etkinlik KArbon Ayak İzi.xlsx")

```
toplam_km   = tek yön km × 2                      (varış: Gaziantep)
ulaşım      = toplam_km × faktör / araç_doluluğu  (yalnızca özel araç; diğerlerinde bölme yok)
konaklama   = gece × 32,1 / oda_doluluğu
toplam      = ulaşım + konaklama
tahmini katılımcı = ölçülen / yanıt × hedef katılımcı   (hedef girilmezse = ölçülen)
etkinlik toplamı  = tahmini katılımcı + operasyon
```

Faktörler tek yerde: [src/data/factors.js](src/data/factors.js) (kaynak: UK GHG Conversion Factors 2026, T.C. ETKB). `npm run gen:sql` bunu `supabase/reference_data.sql`'e aktarır; sunucu hesabı **veritabanındaki** kopyayı kullanır.

**Excel'den tek bilinçli sapma:** yanıt sayısı hedef katılımcıyı aşarsa tahmini değer, ölçülenin altına indirilmez (ölçülen = tahmini) ve panelde uyarı çıkar.

**Mesafe:** Kara ulaşımında (özel araç, otobüs, servis, tren, tramvay/metro, taksi, motosiklet) katılımcıya "yaklaşık kaç km yol kat ettiniz?" sorulur; ilden hesaplanan statik mesafe öneri olarak dolu gelir, katılımcı değiştirebilir (0–3000 km, sunucuda doğrulanır; kayıtta `distance_source` = `user`/`city`). Gaziantep'ten gelenlerde öneri yoktur, km yazılır. Yaya/bisiklet 0 km, uçak ilden kuş uçuşudur.

**Dikilecek ağaç:** Admin panelinde "1 ağaç eşdeğeri (kg CO₂e)" girildiğinde katılımcı sonuç ekranında animasyonlu olarak "karbon ayak izinize karşılık N ağaç dikilecek" görür (N = ⌈kişisel emisyon / katsayı⌉). Panel toplam dikilecek ağaç sayısını gösterir. Katsayıyı organizatör belirler; boşsa ağaç gösterilmez.

Arayüzde uçak için yalnızca "İç hat - ortalama" sunulur (etkinlik Türkiye içinde); sunucu Excel'deki 7 uçuş sınıfının hepsini kabul eder.

### Mesafeler
81 ilin Gaziantep'e tek yön karayolu ve kuş uçuşu mesafesi statiktir: [src/data/cities.js](src/data/cities.js). Çalışma zamanında Nominatim/OSRM **çağrılmaz**. Veri tek seferlik `npm run gen:cities` ile üretilmiştir (OSRM karayolu; uçakta haversine). Kurumca doğrulanmış mesafe isterseniz bu dosyayı ve `npm run gen:sql` çıktısını güncelleyin.

## Güvenlik modeli

| Konu | Uygulama |
|---|---|
| Tablo erişimi | Tüm tablolarda RLS açık, anon/authenticated için politika ve yetki **yok** — tarayıcıdan doğrudan okuma/yazma mümkün değil |
| Katılımcı yazımı | Yalnızca `submit_carbon()` (SECURITY DEFINER). Ham girdiyi doğrular; mesafe, faktör ve toplamı **DB tablolarından kendisi** hesaplar. İstemci `total_kg` gönderemez |
| Serbest metin | Yok: il, ulaşım ve alt tür tablolardan doğrulanır (kişisel veri sızdırma ve CSV formül enjeksiyonu kapalı) |
| Çift gönderim | Tarayıcıda üretilen rastgele `session_id` (saklanmaz, izleme yapmaz); aynı ID ikinci kayıt açmaz |
| Admin | `admin_*` fonksiyonları `admin_users`'ta `auth.uid()` arar; giriş yapmak tek başına yetki vermez |
| Toplamlar | Veritabanında hesaplanır (COUNT/SUM/GROUP BY), tablo sayfalıdır → 1000+ kayıtta PostgREST limiti sorun olmaz |
| Gizli anahtar | `service_role`/secret key hiçbir yerde kullanılmaz. Yalnızca publishable (anon) anahtar |

Test edilmiş: `npm test` (36 test) şemayı gerçek bir Postgres'te (PGlite) çalıştırır: anon'un SELECT/INSERT reddi, admin olmayan reddi, 81 il × 4 senaryo sunucu = istemci hesabı, geçersiz girdiler, çift gönderim, 1500 kayıtta toplamlar, kapsama/operasyon, sayfalama, eski MVP tablosunun kilitlenmesi.

**Bilinen sınır (spam):** anon anahtar herkese açık olduğundan bir betik *geçerli görünümlü* yanıtlar gönderebilir; sahte kg değeri gönderemez. Önlemler: sunucu doğrulaması, benzersiz `session_id`, admin panelinden **"Form yanıt kabul ediyor"** anahtarı (acil kapatma), tablo kısıtları. Bot baskısı beklenirse sonraki adım: Edge Function + Cloudflare Turnstile (şemaya dokunmadan eklenebilir).

## Kurulum

### 1) Supabase
1. Yeni proje açın. **Authentication → Providers → Email**: yönetici hesabınızı oluşturduktan sonra **"Allow new users to sign up" kapatın**.
2. SQL Editor: önce [supabase/schema.sql](supabase/schema.sql), sonra [supabase/reference_data.sql](supabase/reference_data.sql) çalıştırın.
3. Yönetici ekleme: [ADMIN_SETUP.md](ADMIN_SETUP.md).

### 2) Yerel çalıştırma
```bash
cp .env.example .env.local   # URL ve publishable key'i yazın
npm install
npm run dev
```
`.env.local` Git'e girmez. **Secret / service_role anahtarını asla buraya koymayın.**

### 3) Cloudflare Pages
GitHub reposunu bağlayın:
- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variables (Production): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`

Projede üst düzey `404.html` yoktur; Cloudflare Pages bu durumda SPA gibi davranıp `/admin` gibi yolları `index.html`'e yönlendirir. `.node-version` Node 22'yi seçer.
QR kodu, deploy URL'si (`*.pages.dev` veya özel domain) kesinleştikten sonra üretin.

## Geliştirme
```bash
npm test          # hesap + SQL/RLS testleri
npm run gen:sql   # factors.js + cities.js -> supabase/reference_data.sql
npm run build
```

## Yapılmayanlar / sonraya bırakılanlar
- Gıda faktörleri (Excel'de var): katılımcı formunda yemek sorusu olmadığı için kullanılmıyor; gerekirse admin tarafına menü/öğün sayısı girdisi eklenir.
- XLSX/PDF rapor (CSV hazır).
- Ağaç katsayısı organizatörce belirlenip panelden girilmelidir (girilene kadar ağaç gösterilmez).
