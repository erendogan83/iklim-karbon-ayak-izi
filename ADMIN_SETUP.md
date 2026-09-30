# Admin kurulumu

1. Supabase **Authentication → Users → Add user** ile yönetici e-posta/şifresini oluşturun (Auto Confirm işaretli).
2. Oluşan kullanıcının UUID'sini kopyalayın.
3. **SQL Editor**'da çalıştırın (`schema.sql` ve `reference_data.sql` çalıştırıldıktan sonra):

```sql
insert into public.admin_users (user_id) values ('BURAYA-USER-UUID');
```

4. **Authentication → Providers → Email → "Allow new users to sign up"** seçeneğini kapatın (başkaları hesap açamasın).
5. Siteye `/admin` ile girin. Katılımcı formu `/` adresinde kalır.

Yetki modeli: giriş yapmış olmak yeterli değildir; `admin_users` tablosunda kaydı olmayan kullanıcı "Yetkiniz yok" görür ve hiçbir veri alamaz (`admin_*` fonksiyonları veritabanı tarafında da reddeder).

Yönetici eklemek/çıkarmak yalnızca SQL Editor'dan yapılır:
```sql
delete from public.admin_users where user_id = 'UUID';
```

## Etkinlikten önce test verisini temizleme
Admin panelinden (`/admin`):
- **Tek kayıt:** "Son kayıtlar" tablosunda satırın sonundaki **Sil** düğmesi (onay sorar).
- **Tüm kayıtlar:** panelin en altındaki **"Deneme verilerini temizle"** bölümünde kutuya **SİL** yazıp **"Tüm kayıtları sil"**. Geri alınamaz; gerçek veri varsa önce **CSV rapor indir**. Etkinlik ayarları ve operasyon girdileri silinmez.

Alternatif (SQL Editor): `truncate public.carbon_submissions;`
