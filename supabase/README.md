# Supabase kurulum notu

1. Yeni Supabase projesi açın.
2. SQL Editor → **`schema.sql`**, ardından **`reference_data.sql`** çalıştırın (ikisi de tekrar çalıştırılabilir).
   - Projede eski MVP tablosu varsa `carbon_submissions_mvp_backup` adıyla saklanır ve kilitlenir.
3. Yönetici ekleyin: [../ADMIN_SETUP.md](../ADMIN_SETUP.md).
4. Project URL ve **Publishable key**'i `.env.local`'e (yerel) ve Cloudflare Pages ortam değişkenlerine koyun.

`reference_data.sql` elle düzenlenmez; `src/data/factors.js` ve `src/data/cities.js` değişince `npm run gen:sql` ile yeniden üretilir. Faktör değişikliği yalnızca **yeni** yanıtları etkiler (her kayıt `factor_version` taşır).

**Önemli:** `service_role` / Secret key frontend'e, Vite env'e, GitHub'a veya Cloudflare istemci değişkenlerine KOYULMAZ. Bu uygulama o anahtarı hiç kullanmaz.
