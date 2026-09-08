import { getPool } from './db';
import { generateApiKey, generateWebhookSecret } from './utils';

let _migrationDone = false;

export async function runMigrations(): Promise<void> {
  if (_migrationDone) return;

  const pool = getPool();
  const client = await pool.connect();

  try {
    console.log('[Gateway Migrate] Initializing schema and tables...');

    await client.query(`
      CREATE SCHEMA IF NOT EXISTS gateway;

      CREATE TABLE IF NOT EXISTS gateway.merchants (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) NOT NULL,
          email VARCHAR(255) UNIQUE,
          password_hash VARCHAR(255),
          business_name VARCHAR(255),
          phone VARCHAR(20),
          balance NUMERIC(12, 2) DEFAULT 0.00,
          total_earned NUMERIC(12, 2) DEFAULT 0.00,
          payout_upi_id VARCHAR(100),
          payout_bank_acc VARCHAR(50),
          payout_ifsc VARCHAR(20),
          payout_holder_name VARCHAR(100),
          status VARCHAR(20) DEFAULT 'active',
          api_key VARCHAR(64) NOT NULL UNIQUE,
          webhook_url TEXT,
          webhook_secret VARCHAR(64),
          rate_limit_per_min INT DEFAULT 30,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Ensure columns exist if table was already created in prior migration
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE;
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS business_name VARCHAR(255);
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS balance NUMERIC(12, 2) DEFAULT 0.00;
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS total_earned NUMERIC(12, 2) DEFAULT 0.00;
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS payout_upi_id VARCHAR(100);
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS payout_bank_acc VARCHAR(50);
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS payout_ifsc VARCHAR(20);
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS payout_holder_name VARCHAR(100);
      ALTER TABLE gateway.merchants ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

      CREATE TABLE IF NOT EXISTS gateway.vpas (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          vpa_address VARCHAR(100) NOT NULL UNIQUE,
          label VARCHAR(50),
          account_suffix VARCHAR(10),
          is_active BOOLEAN DEFAULT true,
          current_load INT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS gateway.orders (
          id VARCHAR(30) PRIMARY KEY,
          merchant_id UUID NOT NULL REFERENCES gateway.merchants(id),
          idempotency_key VARCHAR(64),
          base_amount INT NOT NULL,
          offset_cents INT NOT NULL,
          final_amount NUMERIC(10,2) NOT NULL,
          vpa_id UUID NOT NULL REFERENCES gateway.vpas(id),
          tier SMALLINT DEFAULT 1,
          status VARCHAR(20) DEFAULT 'pending',
          customer_name VARCHAR(100),
          customer_email VARCHAR(100),
          customer_phone VARCHAR(20),
          metadata JSONB DEFAULT '{}',
          callback_url TEXT,
          merchant_webhook_url TEXT,
          utr VARCHAR(30),
          expires_at TIMESTAMPTZ NOT NULL,
          paid_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          CONSTRAINT uq_gateway_idempotency UNIQUE (merchant_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_gw_orders_pending ON gateway.orders (final_amount, vpa_id)
          WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_gw_orders_expires ON gateway.orders (expires_at)
          WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_gw_orders_merchant ON gateway.orders (merchant_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS gateway.payment_receipts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id VARCHAR(30) REFERENCES gateway.orders(id),
          utr VARCHAR(30),
          raw_message TEXT,
          sender VARCHAR(100),
          amount NUMERIC(10,2),
          matched BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS gateway.webhook_deliveries (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id VARCHAR(30) NOT NULL REFERENCES gateway.orders(id),
          merchant_id UUID NOT NULL REFERENCES gateway.merchants(id),
          url TEXT NOT NULL,
          payload JSONB NOT NULL,
          signature TEXT NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',
          attempts INT DEFAULT 0,
          max_attempts INT DEFAULT 5,
          last_attempt_at TIMESTAMPTZ,
          next_retry_at TIMESTAMPTZ,
          last_error TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_gw_webhook_retry ON gateway.webhook_deliveries (next_retry_at)
          WHERE status = 'pending' OR status = 'failed';

      CREATE TABLE IF NOT EXISTS gateway.settlements (
          id VARCHAR(32) PRIMARY KEY,
          merchant_id UUID NOT NULL REFERENCES gateway.merchants(id),
          amount NUMERIC(12, 2) NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',
          payout_method VARCHAR(20) DEFAULT 'upi',
          payout_address TEXT NOT NULL,
          utr_reference VARCHAR(64),
          notes TEXT,
          requested_at TIMESTAMPTZ DEFAULT NOW(),
          settled_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_gw_settlements_merchant ON gateway.settlements (merchant_id, requested_at DESC);

      CREATE TABLE IF NOT EXISTS gateway.payment_links (
          id VARCHAR(32) PRIMARY KEY,
          merchant_id UUID NOT NULL REFERENCES gateway.merchants(id),
          title VARCHAR(255) NOT NULL,
          description TEXT,
          amount NUMERIC(10, 2) NOT NULL,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_gw_payment_links_merchant ON gateway.payment_links (merchant_id, created_at DESC);

      CREATE OR REPLACE VIEW gateway.vpa_health AS
      SELECT
          v.id,
          v.vpa_address,
          v.label,
          v.current_load,
          v.is_active,
          COUNT(o.id) FILTER (WHERE o.status = 'paid') as paid_count,
          COUNT(o.id) FILTER (WHERE o.status = 'expired') as expired_count,
          ROUND(
              COALESCE(
                  (COUNT(o.id) FILTER (WHERE o.status = 'paid')::numeric /
                  NULLIF(COUNT(o.id) FILTER (WHERE o.status IN ('paid', 'expired')), 0)) * 100,
                  100.0
              ), 1
          ) as success_rate
      FROM gateway.vpas v
      LEFT JOIN gateway.orders o ON o.vpa_id = v.id
          AND o.created_at > NOW() - INTERVAL '24 hours'
      GROUP BY v.id, v.vpa_address, v.label, v.current_load, v.is_active;
    `);

    // Seed default active VPA if none exist
    const vpaCount = await client.query('SELECT COUNT(*) FROM gateway.vpas');
    if (parseInt(vpaCount.rows[0].count, 10) === 0) {
      const defaultUpi = process.env.DEFAULT_UPI_ID || '918310870493@waaxis';
      const defaultSuffix = process.env.DEFAULT_UPI_SUFFIX || '0493';
      await client.query(
        `INSERT INTO gateway.vpas (vpa_address, label, account_suffix, is_active)
         VALUES ($1, $2, $3, true)`,
        [defaultUpi, 'Primary UPI Handle', defaultSuffix]
      );
      console.log(`[Gateway Migrate] Seeded initial VPA: ${defaultUpi}`);
    }

    _migrationDone = true;
    console.log('[Gateway Migrate] Razorpay-style multi-tenant migrations completed successfully.');
  } catch (err) {
    console.error('[Gateway Migrate] Migration error:', err);
    throw err;
  } finally {
    client.release();
  }
}
