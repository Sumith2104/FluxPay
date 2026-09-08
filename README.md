# FluxPay

> **High-Performance, Zero-Fee UPI Payment Gateway & Merchant Aggregator**  
> Accept payments on personal UPI accounts with automated real-time verification and zero transaction fees.

FluxPay is a Razorpay-style payment gateway platform built to enable online merchants to accept direct UPI payments with zero payment gateway processing fees. It automatically assigns unique micro-decimal offsets (e.g., ₹499.01, ₹499.02) to each transaction, ingests bank SMS alerts via **MacroDroid** on your phone, instantly confirms payments in under 1 millisecond, and automatically credits the merchant's wallet balance.

Built on the **Fluxbase** multi-tenant database engine.

---

## Key Features

- **Multi-Tenant Merchant Portal**:
  - Self-serve merchant **Sign Up** and **Login** (`/signup`, `/login`).
  - Edge-compatible session security (`gw_merchant_session`).
- **Merchant Dashboard (`/dashboard`)**:
  - Real-time **Withdrawable Balance** and lifetime transaction volume.
  - Live orders ledger with status badges, customer names, and bank UTR numbers.
- **Monthly Withdrawals & Settlements (`/dashboard/withdrawals`)**:
  - Configure payout destination (UPI ID or Bank Account Number + IFSC).
  - Submit monthly settlement requests with balance deduction.
- **Developer API Credentials (`/dashboard/apikeys`)**:
  - Live API keys (`sec_live_...`).
  - Webhook URL configuration with HMAC-SHA256 signature verification (`X-FluxPay-Signature`).
- **No-Code Payment Links (`/dashboard/links`)**:
  - Generate shareable payment links (`/pay/link/[linkId]`) for social media, WhatsApp, or email checkout.
- **MacroDroid Ingestion Engine (`POST /api/v1/webhook/incoming`)**:
  - Parses bank SMS alerts from personal savings accounts (Axis, HDFC, SBI, ICICI, etc.).
  - Extracts payment amounts with decimals, bank UTR, and account suffix.
  - Matches open orders and frees atomic slot keys in under 1 millisecond.
- **Strict Monospace Dark Aesthetic**:
  - Dark aesthetic (`#0b0b0b` / `#121214` / `#27272a` / `#ff6600`).
  - Zero emojis and zero SVG icons throughout all client interfaces.

---

## Architecture

```
[Customer / App]
       │
       ▼
[POST /api/v1/orders]  ──(API Key: sec_live_...)──►  [Slot Allocation Engine]
                                                             │
                                                             ├─► Allocate offset e.g. ₹499.01 (Redis)
                                                             └─► Insert order into Fluxbase (PostgreSQL)
                                                                     │
[Customer scans UPI QR & pays ₹499.01]                               │
       │                                                             │
       ▼                                                             │
[Bank receives credit]                                               │
       │                                                             │
[Bank SMS sent to Phone]                                             │
       │                                                             │
[MacroDroid HTTP POST /api/v1/webhook/incoming]                      │
       │                                                             │
       ▼                                                             │
[Match Engine] ──────────────────────────────────────────────────────┘
       │
       ├─► Marks order status = 'paid' & stores bank UTR
       ├─► Atomically increments merchant balance (balance = balance + 499.00)
       ├─► Frees atomic Redis slot key (<1ms)
       └─► Dispatches HMAC-signed webhook to Merchant
```

---

## Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

| Variable | Description | Example |
|---|---|---|
| `AWS_RDS_POSTGRES_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `DATABASE_POOL_MAX` | Max connections in PG pool | `10` |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL | `https://your-redis.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST Token | `AX6...` |
| `PAYMENT_WEBHOOK_SECRET` | Secret token for MacroDroid SMS ingestion | `sumith@fluxbase` |
| `GATEWAY_SESSION_SECRET` | Secret for HMAC merchant auth cookies | `your_secret_key` |
| `FLUXBASE_PROJECT_ID` | Fluxbase project ID | `0e3d63b989b94d08` |
| `FLUXBASE_PROJECT_SCHEMA`| PostgreSQL schema name | `flux_tenant_0e3d63b989b94d08` |
| `DEFAULT_UPI_ID` | Your personal receiver UPI handle | `918310870493@waaxis` |
| `DEFAULT_UPI_SUFFIX` | Last 4 digits of your linked bank account | `0493` |
| `NEXT_PUBLIC_GATEWAY_URL` | Base public URL for checkout links | `https://pay.yourdomain.com` |

---

## Hosting & Deployment

### Option 1: Deploy on Vercel (Recommended)

1. Push this repository to your GitHub account (`https://github.com/Sumith2104/FluxPay`).
2. Go to [vercel.com](https://vercel.com) and click **"Add New Project"**.
3. Import the `FluxPay` repository.
4. Set the **Framework Preset** to `Next.js`.
5. Under **Environment Variables**, add the keys from your `.env.local` table above.
6. Click **Deploy**. Vercel will build and assign you a live HTTPS URL (e.g. `https://fluxpay.vercel.app`).
7. Update `NEXT_PUBLIC_GATEWAY_URL` in your Vercel settings to your deployed domain.

### Option 2: Run with Docker / VPS

```bash
# Build production bundle
npm install
npm run build

# Start on port 3001
npm run start
```

---

## MacroDroid Automation Setup (Phone SMS Ingestion)

To automatically forward bank credits from your personal phone:

1. Install **MacroDroid** on your Android phone.
2. Create a new Macro:
   - **Trigger**: `SMS Received` → (Select Any Sender, or filter by your bank header e.g. `AXISBK`, `HDFCBK`, `SBIINB`).
   - **Action**: `HTTP Request`
     - **Method**: `POST`
     - **URL**: `https://your-deployed-domain.com/api/v1/webhook/incoming`
     - **Header 1**: `x-webhook-secret: YOUR_WEBHOOK_SECRET`
     - **Header 2**: `Content-Type: application/json`
     - **Body Content**: `{"text": "{sms_message}"}`
3. Save and enable the Macro.

---

## Merchant API Reference

### 1. Create an Order

```bash
curl -X POST https://your-domain.com/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "x-api-key: sec_live_YOUR_API_KEY" \
  -d '{
    "amount": 499.00,
    "customer_name": "Amit Patel",
    "customer_email": "amit@example.com",
    "metadata": { "order_ref": "ORDER_12345" }
  }'
```

**Response (201 Created):**
```json
{
  "success": true,
  "order_id": "ord_c2bab3151d0f823b",
  "checkout_url": "https://your-domain.com/pay/ord_c2bab3151d0f823b",
  "amount": 499,
  "final_amount": 499.01,
  "vpa": "918310870493@waaxis",
  "status": "pending",
  "expires_at": "2026-09-09T00:15:00.000Z"
}
```

### 2. Verify Incoming Webhooks

When a payment succeeds, FluxPay POSTs to your webhook URL with signature header `X-FluxPay-Signature: t={timestamp},v1={hmac_sha256}`:

```json
{
  "event": "payment.succeeded",
  "order_id": "ord_c2bab3151d0f823b",
  "amount": 499.01,
  "base_amount": 499,
  "utr": "425192841029",
  "paid_at": "2026-09-09T00:13:37.000Z",
  "customer": {
    "name": "Amit Patel",
    "email": "amit@example.com"
  }
}
```

---

## License

MIT © [Sumith2104](https://github.com/Sumith2104)
