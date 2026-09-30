import { createClient } from '@supabase/supabase-js';

// Ortam değişkenleri (VITE_*) build sırasında koda gömülür. Tanımlı değilse aşağıdaki yedek değerler kullanılır.
// İkisi de HERKESE AÇIK değerdir (Project URL ve publishable key her ziyaretçinin tarayıcısında zaten görünür);
// veri güvenliğini anahtar değil, veritabanındaki RLS ve yetki kuralları sağlar.
// Secret / service_role anahtarı ASLA buraya veya herhangi bir VITE_ değişkenine konmaz.
const FALLBACK_URL = 'https://raaxdupfpgmoedfsycqi.supabase.co';
const FALLBACK_PUBLISHABLE_KEY = 'sb_publishable_amEb6e1MIeCllRAr5QYRNg_oyc2NlWo';

const url = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || FALLBACK_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key) : null;
