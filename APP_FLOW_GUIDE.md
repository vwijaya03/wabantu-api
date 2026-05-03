# WABantu Flow Guide (NestJS + Next.js)

Panduan ini dibuat untuk kamu yang baru mulai dengan NestJS dan Next.js.
Fokusnya: **bagaimana aplikasi bekerja dari ujung ke ujung**, bagaimana
**endpoint path terbentuk**, dan bagaimana data mengalir.

---

## 1) Gambaran besar

WABantu terdiri dari 3 bagian:

1. `infra/`  
   Menjalankan Postgres + Redis.
2. `api/` (NestJS)  
   Menyediakan endpoint backend (`/api/v1/...`).
3. `web-frontend/` (Next.js App Router)  
   Menyediakan UI web (`/`, `/login`, `/dashboard`, dll) dan memanggil API.

---

## 2) Arsitektur request (high level)

Contoh user login dari browser:

1. User submit form login di halaman Next.js `/login`.
2. Browser memanggil `POST /api/v1/auth/login` (same-origin ke Next.js), lalu
   Next rewrite meneruskan ke API `http://localhost:3001/api/v1/...` saat dev.
3. API validasi email/password.
4. Jika valid:
   - API buat session di Redis.
   - API sign JWT.
   - API set cookie `wabantu_at` (HttpOnly) di response.
5. Frontend redirect ke `/dashboard`.
6. Halaman dashboard (server-side) memanggil `/auth/me` dengan cookie tadi.
7. Jika valid, dashboard render data user; kalau tidak valid, redirect balik ke `/login`.

---

## 3) Cara endpoint path API terbentuk (NestJS)

Path final endpoint di NestJS dibentuk oleh gabungan:

1. **Global prefix** dari `main.ts`: `api`  
2. **Versioning URI** dari `main.ts`: `v1`  
3. **Controller path** dari `@Controller({ path: '...', version: '1' })`  
4. **Method path** dari decorator `@Get('...')`, `@Post('...')`, dll

Contoh nyata:

- `AuthController`:
  - controller path: `auth`
  - method `@Post('login')`
  - final path: **`/api/v1/auth/login`**

- `BusinessController`:
  - controller path: `business/profile`
  - method `@Patch()`
  - final path: **`/api/v1/business/profile`**

---

## 4) Peta endpoint yang sudah dibuat

### Auth (`AuthController`)
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout` (auth required)
- `GET /api/v1/auth/me` (auth required)

### Business Profile (`BusinessController`)
- `GET /api/v1/business/profile` (auth required) — respons **plain object** dengan
  `reportingTimezone` yang sudah dinormalisasi (`resolveReportingTimezone`, allowlist IANA).
- `PATCH /api/v1/business/profile` (owner only) — field `reportingTimezone` opsional;
  harus ada di `REPORTING_TIMEZONE_ALLOWLIST`; respons sama seperti GET.

Implementasi: entity `BusinessProfile` → mapper `toBusinessProfileResponse()` di
`src/business/mappers/business-profile-response.mapper.ts` (dipanggil controller
setelah service), supaya serialisasi respons stabil untuk UI.

### Knowledge Base (`KnowledgeBaseController`)
- `GET /api/v1/knowledge-base`
- `POST /api/v1/knowledge-base`
- `PATCH /api/v1/knowledge-base/:id`
- `DELETE /api/v1/knowledge-base/:id`

### WhatsApp (`WhatsappController`)
- `GET /api/v1/whatsapp/channels`
- `POST /api/v1/whatsapp/meta/connect/init` (owner only)
- `POST /api/v1/whatsapp/meta/connect/callback` (public, dipanggil frontend setelah redirect OAuth)
- `DELETE /api/v1/whatsapp/channels/:id`
- `POST /api/v1/whatsapp/channels/:id/test-message`
- `GET /api/v1/whatsapp/webhook/meta` (public)
- `POST /api/v1/whatsapp/webhook/meta` (public)

### Inbox (`InboxController`)
- `GET /api/v1/inbox/unread-summary` — total `unread_count` seluruh percakapan (badge sidebar & header)
- `GET /api/v1/inbox/stream` — **SSE** (cookie auth): Redis pub/sub saat webhook menyimpan pesan masuk → UI invalidate cache tanpa polling HTTP interval
- `GET /api/v1/inbox/conversations` — daftar paginated (query: `search`, `unreadOnly`, `aiHandled`, `limit`, `cursor` base64) → `{ items, nextCursor }`
- `GET /api/v1/inbox/conversations/:id/messages` — riwayat pesan: `limit`, **`cursor`** (base64url JSON `{ createdAt, id }`, halaman berikutnya = pesan lebih lama) atau legacy `offset`; respons `{ messages, nextCursor, nextOffset }` (salah satu null sesuai mode)
- `PATCH /api/v1/inbox/conversations/:id/read`
- `POST /api/v1/inbox/conversations/:id/handoff` — serahkan ke manusia
- `POST /api/v1/inbox/conversations/:id/ai-resume` — aktifkan lagi AI
- `POST /api/v1/inbox/conversations/:id/messages` — balasan manual dari dashboard

### Leads (`LeadsController`)
- `GET /api/v1/leads` — optional filter `?status=...`
- `PATCH /api/v1/leads/:id`

### Billing (`BillingController`, owner)
- `GET /api/v1/billing/overview`
- `GET /api/v1/billing/invoices`
- `POST /api/v1/billing/select-plan`

### Analytics (`AnalyticsController`)
- `GET /api/v1/analytics/overview` — query optional `?days=` (default 30); batas
  “hari ini” mengikuti `reportingTimezone` pada profil bisnis tenant

### Health
- `GET /health`
- `GET /health/ready`

Catatan: health endpoint sengaja **tidak** memakai prefix `/api/v1`.

---

## 5) Modul penting di API

Di `api/src/app.module.ts`, modul utama yang di-import:

- `ConfigModule`: load dan validasi env.
- `LoggerModule`: request logging.
- `ThrottlerModule`: rate limiting.
- `DatabaseModule`: koneksi DB system + tenant resolver.
- `RedisModule`: redis client.
- `AuthModule`, `BusinessModule`, `KnowledgeBaseModule`, `WhatsappModule`, `InboxModule`, `LeadsModule`, `AnalyticsModule`, `BillingModule`, `HealthModule`.

Global guard:

- `ThrottlerGuard` (rate limit)
- `JwtAuthGuard` (auth by default)

Artinya semua route default-nya butuh auth, kecuali yang diberi `@Public()`.

---

## 6) Auth flow detail (API)

### Register
`POST /api/v1/auth/register`

1. Validasi DTO (`RegisterDto`).
2. Normalisasi email.
3. Cek duplicate berdasarkan `email_hash`.
4. Simpan:
   - tenant baru (`tenant`)
   - tenant connection metadata (`tenant_company`)
   - akun (`tenant_account`)
5. Buat schema tenant di `jb_tenant` (mis. `t_namatoko`) + seed `business_profile`.
6. Buat Redis session.
7. Sign JWT.
8. Set cookie `wabantu_at`.

### Login
`POST /api/v1/auth/login`

1. Cari akun via `email_hash`.
2. `bcrypt.compare()` password.
3. Load tenant + tenant_company.
4. Buat Redis session baru.
5. Sign JWT + set cookie.

### Check Me
`GET /api/v1/auth/me`

1. `JwtAuthGuard` ambil token dari cookie/header.
2. `JwtStrategy` verifikasi signature JWT.
3. Cross-check session id (`sid`) di Redis.
4. Return profile user + tenant.

---

## 7) Multi-tenant model yang dipakai

Model DB:

- `jb_system`: master tenant/account metadata.
- `jb_tenant`: data tenant per schema (`t_<slug>`).

Kenapa:

- Login tetap cepat dan terpusat.
- Data tenant terisolasi per schema.
- Bisa scale ke dedicated DB per tenant nanti lewat `tenant_company.host/database`.

---

## 8) Enkripsi data sensitif (at rest)

Sudah aktif field-level encryption:

- `tenant_account.email`
- `tenant_account.name`
- `tenant.name` (businessName master)
- `business_profile.business_name`

Implementasi:

- TypeORM column transformer (`to` encrypt, `from` decrypt).
- Data disimpan ciphertext di Postgres.
- Saat dibaca entity, otomatis didecrypt sebelum jadi response API.

Untuk lookup email tetap cepat, dipakai kolom tambahan:

- `email_hash` (SHA-256, deterministic, indexed unique).

---

## 9) Frontend route flow (Next.js App Router)

Struktur route group:

- `(marketing)` => `/`, `/pricing`
- `(auth)` => `/login`, `/register`
- `(dashboard)` => `/dashboard/*`

### Guarding dashboard

1. `proxy.ts`:
   - jika akses `/dashboard/*` tanpa cookie `wabantu_at` => redirect ke `/login?next=...`
2. `app/(dashboard)/layout.tsx`:
   - server-side call `getServerUser()` ke `/auth/me`
   - jika gagal => redirect ke `/login`
   - jika sukses => render dashboard + inject `AuthProvider`

Kenapa double-check (proxy + layout)?

- Proxy cepat untuk case obvious (tanpa cookie).
- Layout adalah source of truth untuk validasi session sebenarnya.

### Flow connect WhatsApp terbaru (OAuth-only)

Saat ini UI hanya mendukung **1 cara** connect WhatsApp, yaitu OAuth Meta (tanpa form access token manual):

1. User buka `/dashboard/whatsapp/onboarding`.
2. User isi:
   - `Nama channel`
   - `Nomor WhatsApp Business`
   - `Meta App ID`
   - `Meta App Secret`
3. Frontend call `POST /api/v1/whatsapp/meta/connect/init` untuk membuat `oauthUrl` + `state`.
4. API menyimpan `state` + app credentials sementara di Redis (TTL 10 menit).
5. Frontend simpan data non-sensitive sementara di `localStorage`, lalu redirect ke OAuth Meta.
6. Setelah authorize, Meta redirect balik ke `/dashboard/whatsapp/onboarding?code=...&state=...`.
7. Frontend auto-detect `code` + `state`, validasi dengan data pending, lalu auto-call
   `POST /api/v1/whatsapp/meta/connect/callback`.
8. API:
   - menukar `code -> access_token`
   - auto-discover `meta_waba_id` + `meta_phone_number_id` dari Graph API (`/me?fields=whatsapp_business_accounts{...}`)
   - upsert `whatsapp_channel` per-tenant
   - menyimpan `meta_app_id` + `meta_app_secret` per channel
9. Frontend refresh list channel di `/dashboard/whatsapp`.

Catatan:

- **`POST .../connect/init` hanya membuat OAuth URL** — tidak mengembalikan `meta_waba_id` / `meta_phone_number_id`. ID baru dicoba di **`.../callback`** lewat Graph.
- Jika Graph tidak mengembalikan daftar WABA (scope/token, akun dibatasi, dll.), kolom ID bisa tetap kosong sampai terisi dari webhook atau diperbaiki di Meta.
- `metaPhoneNumberId` dan `metaWabaId` dari body callback bersifat opsional; auto-discovery mengisi jika cocok dengan nomor onboarding.
- `access_token` channel disimpan terenkripsi di database.
- `meta_app_secret` channel juga disimpan terenkripsi.
- Halaman overview dashboard (`/dashboard`) membaca status WhatsApp dari `/whatsapp/channels`, jadi checklist/status tidak lagi hardcoded.

### Webhook masuk (setelah channel terhubung)

Payload Meta menyertakan **`phone_number_id`** dan **`display_phone_number`**. Resolver tenant tidak hanya mengandalkan ID di DB: ia **mencocokkan nomor tampilan** dengan `whatsapp_channel.phoneNumber` (normalisasi), dan jika channel ketemu tanpa `meta_phone_number_id`, API dapat **menyimpan backfill** dari webhook.

---

## 10) Kenapa kadang login sukses tapi balik ke login lagi?

Penyebab paling umum:

1. `API_URL_INTERNAL` salah / kosong di frontend env.
2. Cookie ada tapi session Redis invalid (stale cookie).
3. API tidak reachable dari frontend server-side render context.

Checklist cepat:

- `web-frontend/.env.local`
  - `NEXT_PUBLIC_API_URL=/api/v1`
  - `API_URL_INTERNAL=http://localhost:3001/api/v1`
- API running dan bisa hit `/api/v1/auth/me`.
- Redis port benar dan bisa diakses API.

---

## 10.1) Logout Network Error di browser

Jika API sementara tidak reachable saat klik logout, frontend sekarang tetap:

1. Menangkap error request logout (tidak jadi `unhandledRejection`).
2. Clear state user di client.
3. Redirect user ke `/login`.

Artinya UX logout tetap aman walaupun ada gangguan jaringan sesaat.

---

## 11) File yang paling penting untuk dipelajari dulu

### API
- `api/src/main.ts`
- `api/src/app.module.ts`
- `api/src/auth/auth.controller.ts`
- `api/src/auth/auth.service.ts`
- `api/src/database/tenant/tenant-connection.service.ts`

### Frontend
- `web-frontend/proxy.ts`
- `web-frontend/app/(dashboard)/layout.tsx`
- `web-frontend/lib/api/server.ts`
- `web-frontend/lib/api/business.ts`
- `web-frontend/lib/reporting-timezones.ts`
- `web-frontend/app/(dashboard)/dashboard/ai-settings/page.tsx`
- `web-frontend/app/(auth)/login/page.tsx`

---

## 12) Next learning steps (recommended)

1. Tambah endpoint baru sederhana di API (contoh: `GET /api/v1/ping`).
2. Tampilkan endpoint itu di halaman dashboard.
3. Logging request + response sederhana.
4. Lanjut ke webhook ingestion WhatsApp + queue worker.

Kalau kamu mau, next saya bisa bantu bikin **diagram sequence** (login + auth guard + dashboard render) dalam bentuk Mermaid supaya lebih visual.
