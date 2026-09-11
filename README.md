# GURMİNİK — Bağımsız Cloudflare Pages sürümü

Bu depo, GURMİNİK işletme takip uygulamasının ChatGPT Sites'tan bağımsız çalışan sürümüdür. Uygulama statik olarak Cloudflare Pages'ta yayınlanır; veriler mevcut Supabase projesinde saklanır. Giriş sistemi Supabase e-posta/şifre oturumudur ve ChatGPT hesabı gerektirmez.

## Korunan özellikler

- Alışlar, satışlar, ürünler, giderler, sıralamalar ve dönem raporları
- Şifreyle korunan satış tutarları ve ortalama satış fiyatları
- Telefon rehberi, WhatsApp/arama bağlantıları ve vCard 3.0/4.0 içe aktarma
- JSON yedek indirme/yükleme ve düzenli PDF raporları
- PWA olarak telefona yükleme, çevrimdışı kayıt kuyruğu ve Supabase Realtime senkronizasyonu
- Kullanıcıya özel Supabase RLS veri güvenliği

## Yerel çalışma

Gerekenler: Node.js 22 veya üzeri.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Tarayıcı adresi: `http://localhost:3000`

## Cloudflare Pages ayarları

Cloudflare Dashboard > Workers & Pages > Create > Pages > GitHub deposuna bağlan bölümünde:

| Ayar | Değer |
|---|---|
| Framework preset | Next.js (Static HTML Export) |
| Build command | `npm run build` |
| Build output directory | `out` |
| Root directory | `/` |
| Node sürümü | `22` |

Supabase URL ve publishable key kaynakta güvenli varsayılanlar olarak bulunur. İstenirse Cloudflare build ortamına `NEXT_PUBLIC_SUPABASE_URL` ve `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` değişkenleri eklenebilir. Frontend'e hiçbir zaman `service_role` veya secret key konulmamalıdır.

## Supabase Auth yönlendirmesi

Cloudflare Pages adresi belli olduktan sonra Supabase Dashboard > Authentication > URL Configuration bölümünde:

- Site URL: bağımsız üretim adresi
- Redirect URLs: üretim adresi ve gerekiyorsa `http://localhost:3000/**`

Uygulama kayıt onayını `window.location.origin` adresine yönlendirir.

## Yayın seçenekleri

### Cloudflare Git bağlantısı

Cloudflare Pages, GitHub deposuna bağlanırsa `main` dalındaki her değişiklik otomatik yayınlanır.

### Wrangler

Cloudflare oturumu bulunan bir bilgisayarda:

```bash
npm run deploy
```

### GitHub Actions

Hazır iş akışı `.github/workflows/cloudflare-pages.yml` içindedir. Kullanmak için GitHub deposuna `CLOUDFLARE_API_TOKEN` ve `CLOUDFLARE_ACCOUNT_ID` secrets değerleri eklenmelidir.

## Güvenlik

- Yalnızca Supabase publishable key tarayıcıya gönderilir.
- Bütün iş tablolarında RLS açıktır ve kayıtlar `owner_id = auth.uid()` ile ayrılır.
- Oturum tarayıcıda güvenli Supabase istemcisiyle saklanır ve otomatik yenilenir.
- Cloudflare güvenlik başlıkları `public/_headers` dosyasındadır.

## Derleme doğrulaması

```bash
npm ci
npm run build
```

Başarılı derlemenin çıktısı `out/` klasörüne yazılır ve doğrudan Cloudflare Pages'a yüklenebilir.
