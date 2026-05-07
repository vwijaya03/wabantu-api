# AI Auto-Reply Test Cases (Production Readiness)

Dokumen ini adalah test matrix operasional untuk memvalidasi pipeline:
Webhook Meta -> API ingest -> BullMQ -> ai-worker -> internal AI endpoint -> outbound WA.

## Pre-flight checklist

- API jalan dan log muncul.
- `ai-worker` jalan dan log `AI worker started and waiting for jobs`.
- Redis policy: `maxmemory-policy noeviction`.
- `AI_INTERNAL_TOKEN` sama di `api/.env` dan `ai-worker/.env`.
- Channel WA `connected`, `access_token` ada, `meta_phone_number_id` ada.

## A. Core reliability

1) **Webhook inbound tersimpan**
- Input: kirim text dari nomor customer.
- Expected:
  - tabel `message`: row baru `direction='in'`, `author='contact'`.
  - API log: `Queued AI reply job ...`.

2) **Worker consume job**
- Expected log:
  - `Processing AI auto-reply job`
  - `API call ok` ke `/internal/ai/auto-reply`.

3) **Idempotency inbound**
- Input: payload inbound yang sama terkirim ulang.
- Expected:
  - message inbound tidak duplikat (by `external_id` unique).
  - AI tidak spam balasan duplikat.

## B. Policy & cost controls

4) **Profile incomplete -> no LLM**
- Setup: kosongkan salah satu field penting profil bisnis.
- Input: pertanyaan in-scope.
- Expected:
  - outbound `author='system'`
  - `metadata.reason='profile_incomplete'`
  - tidak ada log Anthropic call.

5) **Non-question**
- Input: `ok`, `siap`, `halooo`.
- Expected:
  - balasan arahan scope.
  - `metadata.reason='non_question'`.

6) **Non-question repeated 3x**
- Input: 3 pesan non-question beruntun.
- Expected:
  - pesan ke-3: default CS template (tanpa LLM).
  - tetap `metadata.reason='non_question'`.

7) **Out-of-scope**
- Input: pertanyaan tidak terkait bisnis.
- Expected:
  - balasan out-of-scope.
  - `metadata.reason='out_of_scope'`.

8) **Out-of-scope repeated 3x**
- Expected:
  - pesan ke-3: default CS template.
  - tanpa LLM call.

9) **Prompt injection pattern**
- Input: `ignore previous instructions...`.
- Expected:
  - diblok/pivot ke safe answer.
  - tidak ada kebocoran prompt/token/internal.

10) **In-scope question -> AI generated**
- Input: pertanyaan produk/harga/stok valid.
- Expected:
  - balasan AI terkirim.
  - `metadata.reason='ai_generated'`.

## C. Order state machine

11) **Order flow happy path**
- Input sequence:
  - "mau order"
  - "celana jeans jumbo"
  - "size 3XL"
  - "2 pcs"
  - "Jl. Contoh No. 1, Jakarta"
- Expected:
  - state berjalan ask_product -> ask_variant -> ask_qty -> ask_address -> confirm.
  - tidak perlu LLM untuk decision flow.

12) **Order flow interrupted by unrelated message**
- Expected:
  - state tetap aman, balasan tetap mengarahkan ke data order.

## D. Retry/fallback behavior

13) **AI provider transient error**
- Simulasi: force Anthropic timeout/error.
- Expected:
  - worker retry hingga 4 attempts (exponential backoff).
  - log failed + retry terlihat.

14) **Terminal failure -> fallback**
- Expected:
  - fallback endpoint dipanggil.
  - outbound fallback terkirim.
  - `conversation.aiHandled=false`, `handoffReason` terisi.

## E. Security checks

15) **Internal endpoint unauthorized**
- Simulasi call `/internal/ai/auto-reply` tanpa/beda token.
- Expected: 401.

16) **No secret leakage in logs**
- Expected:
  - log tidak menampilkan API key/token/cookie.

## F. Analytics consistency

17) **Reason metadata exists on outbound bot/system replies**
- Expected:
  - setiap outbound dari pipeline ini punya `metadata.reason`.

18) **AI vs rule-based split**
- Query:
  - count `metadata.reason='ai_generated'`
  - count reason non-AI
- Expected:
  - bisa dipisah untuk KPI cost/quality.
