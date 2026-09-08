import { notFound, redirect } from 'next/navigation';
import { getPool } from '@/lib/db';
import { allocateSlot } from '@/lib/slot-engine';
import { generateOrderId } from '@/lib/utils';

export default async function PaymentLinkRedirectPage({
  params,
}: {
  params: Promise<{ linkId: string }>;
}) {
  const { linkId } = await params;
  const pool = getPool();

  const linkRes = await pool.query(
    `SELECT * FROM payment_links WHERE id = $1 AND is_active = true`,
    [linkId]
  );

  if (linkRes.rows.length === 0) {
    notFound();
  }

  const link = linkRes.rows[0];
  const baseAmount = Math.floor(parseFloat(link.amount));
  const orderId = generateOrderId();

  const slot = await allocateSlot(baseAmount, orderId);
  const expiresAt = new Date(Date.now() + 90 * 1000);

  await pool.query(
    `INSERT INTO orders (
        id, merchant_id, base_amount, offset_cents, final_amount,
        vpa_id, tier, status, metadata, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)`,
    [
      orderId,
      link.merchant_id,
      baseAmount,
      slot.offsetCents,
      slot.finalAmount,
      slot.vpaId,
      slot.tier,
      JSON.stringify({ link_id: link.id, title: link.title }),
      expiresAt,
    ]
  );

  redirect(`/pay/${orderId}`);
}
