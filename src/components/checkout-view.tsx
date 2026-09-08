'use client';

import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { StatusBadge } from './status-badge';

interface CheckoutViewProps {
  order: {
    id: string;
    merchant: string;
    amount: number;
    final_amount: number;
    vpa: string;
    status: string;
    expires_at: string;
    callback_url?: string;
    utr?: string;
  };
}

export const CheckoutView: React.FC<CheckoutViewProps> = ({ order }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState(order.status);
  const [utr, setUtr] = useState(order.utr || '');
  const [remainingSeconds, setRemainingSeconds] = useState(90);
  const [redirectCount, setRedirectCount] = useState<number | null>(null);

  const finalAmountStr = order.final_amount.toFixed(2);
  const upiIntentUrl = `upi://pay?pa=${encodeURIComponent(order.vpa)}&pn=${encodeURIComponent(order.merchant || 'Merchant')}&am=${finalAmountStr}&cu=INR&tn=${encodeURIComponent(order.id)}`;

  // Render high-contrast QR Code on canvas (pure canvas, zero icons)
  useEffect(() => {
    if (canvasRef.current && status === 'pending') {
      QRCode.toCanvas(
        canvasRef.current,
        upiIntentUrl,
        {
          width: 220,
          margin: 1,
          color: {
            dark: '#f4f4f5',
            light: '#121214',
          },
        },
        (err) => {
          if (err) console.error('Failed to generate QR:', err);
        }
      );
    }
  }, [upiIntentUrl, status]);

  // Connect to SSE Live Status Stream
  useEffect(() => {
    if (status !== 'pending') return;

    const eventSource = new EventSource(`/api/v1/orders/${order.id}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status) {
          setStatus(data.status);
        }
        if (data.utr) {
          setUtr(data.utr);
        }
        if (typeof data.remaining_seconds === 'number') {
          setRemainingSeconds(data.remaining_seconds);
        }

        if (data.status === 'paid') {
          eventSource.close();
          if (order.callback_url) {
            setRedirectCount(2);
          }
        } else if (data.status === 'expired') {
          eventSource.close();
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [order.id, order.callback_url, status]);

  // Handle redirect countdown
  useEffect(() => {
    if (redirectCount === null) return;
    if (redirectCount <= 0) {
      if (order.callback_url) {
        const url = new URL(order.callback_url);
        url.searchParams.set('order_id', order.id);
        url.searchParams.set('status', 'paid');
        if (utr) url.searchParams.set('utr', utr);
        window.location.href = url.toString();
      }
      return;
    }

    const timer = setTimeout(() => {
      setRedirectCount((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [redirectCount, order.callback_url, order.id, utr]);

  const copyVpa = () => {
    navigator.clipboard.writeText(order.vpa);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyAmount = () => {
    navigator.clipboard.writeText(finalAmountStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-[#f4f4f5] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#121214] border border-[#27272a] rounded-lg shadow-2xl overflow-hidden">
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-[#27272a] flex items-center justify-between">
          <div>
            <div className="text-[10px] font-mono text-[#a1a1aa] uppercase tracking-widest">
              FLUXPAY // SECURE GATEWAY
            </div>
            <div className="text-sm font-semibold text-[#f4f4f5] tracking-tight">
              {order.merchant || 'Merchant Checkout'}
            </div>
          </div>
          <StatusBadge status={status} />
        </div>

        {/* Progress bar for 90s countdown */}
        {status === 'pending' && (
          <div className="w-full bg-[#18181b] h-1">
            <div
              className="bg-[#ff6600] h-1 transition-all duration-1000 ease-linear"
              style={{ width: `${Math.max(0, Math.min(100, (remainingSeconds / 90) * 100))}%` }}
            />
          </div>
        )}

        {/* Content Body */}
        <div className="p-6">
          {status === 'paid' ? (
            <div className="py-8 text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-emerald-950/80 border border-emerald-600 flex items-center justify-center text-emerald-400 font-mono text-xl">
                ✓
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#f4f4f5] tracking-tight">
                  PAYMENT VERIFIED
                </h2>
                <p className="text-xs text-[#a1a1aa] mt-1 font-mono">
                  {utr ? `BANK UTR: ${utr}` : 'INSTANT VERIFICATION CONFIRMED'}
                </p>
              </div>
              <div className="bg-[#18181b] border border-[#27272a] rounded p-3 text-xs font-mono text-zinc-400">
                Amount Paid: <span className="text-[#f4f4f5] font-bold">₹{finalAmountStr}</span>
              </div>
              {redirectCount !== null ? (
                <p className="text-xs text-[#ff6600] font-mono">
                  Redirecting to client app in {redirectCount}s...
                </p>
              ) : order.callback_url ? (
                <a
                  href={order.callback_url}
                  className="inline-block px-4 py-2 bg-[#ff6600] text-black font-semibold text-xs rounded hover:bg-[#ff7a1a] transition"
                >
                  RETURN TO APP
                </a>
              ) : null}
            </div>
          ) : status === 'expired' ? (
            <div className="py-8 text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-400 font-mono text-xl">
                ✕
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#f4f4f5] tracking-tight">
                  PAYMENT WINDOW EXPIRED
                </h2>
                <p className="text-xs text-[#a1a1aa] mt-1">
                  The allocated 90-second payment slot timed out and was automatically released.
                </p>
              </div>
              <p className="text-xs text-zinc-500 font-mono">
                Please return to the application and initiate a fresh checkout.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Amount Display */}
              <div className="text-center bg-[#0b0b0b] border border-[#27272a] rounded-lg p-4">
                <div className="text-[11px] font-mono text-[#a1a1aa] uppercase tracking-wider">
                  EXACT AMOUNT TO PAY
                </div>
                <div className="text-3xl font-mono font-bold text-[#f4f4f5] mt-1 tracking-tight flex items-center justify-center gap-2">
                  <span>₹{finalAmountStr}</span>
                  <button
                    type="button"
                    onClick={copyAmount}
                    className="text-[10px] font-mono uppercase px-2 py-0.5 border border-[#3f3f46] rounded text-[#a1a1aa] hover:text-[#f4f4f5] hover:border-[#71717a]"
                  >
                    {copied ? 'COPIED' : 'COPY'}
                  </button>
                </div>
                <div className="text-[11px] font-mono text-[#ff6600] mt-2">
                  CRITICAL: Pay exact decimal amount for instant zero-typing activation
                </div>
              </div>

              {/* QR Code */}
              <div className="flex flex-col items-center justify-center space-y-2">
                <div className="p-3 bg-[#121214] border border-[#27272a] rounded-lg">
                  <canvas ref={canvasRef} className="block rounded" />
                </div>
                <div className="text-[11px] font-mono text-[#71717a]">
                  Scan with any UPI application (GPay, PhonePe, Paytm, CRED)
                </div>
              </div>

              {/* VPA Address Block */}
              <div className="bg-[#18181b] border border-[#27272a] rounded p-3 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-mono text-[#a1a1aa] uppercase">
                    UPI ID (VPA)
                  </div>
                  <div className="text-xs font-mono text-[#f4f4f5] mt-0.5">
                    {order.vpa}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={copyVpa}
                  className="text-xs font-mono uppercase px-3 py-1 bg-[#27272a] hover:bg-[#3f3f46] text-[#f4f4f5] rounded transition"
                >
                  {copied ? 'COPIED' : 'COPY ID'}
                </button>
              </div>

              {/* Mobile Deep Link Buttons */}
              <div className="space-y-2">
                <div className="text-[10px] font-mono text-[#a1a1aa] uppercase text-center">
                  PAY VIA MOBILE APPS (DIRECT INTENT)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={upiIntentUrl}
                    className="text-center py-2 px-3 bg-[#18181b] hover:bg-[#202023] border border-[#27272a] rounded text-xs font-mono text-[#f4f4f5] transition"
                  >
                    OPEN GPAY
                  </a>
                  <a
                    href={upiIntentUrl}
                    className="text-center py-2 px-3 bg-[#18181b] hover:bg-[#202023] border border-[#27272a] rounded text-xs font-mono text-[#f4f4f5] transition"
                  >
                    OPEN PHONEPE
                  </a>
                  <a
                    href={upiIntentUrl}
                    className="text-center py-2 px-3 bg-[#18181b] hover:bg-[#202023] border border-[#27272a] rounded text-xs font-mono text-[#f4f4f5] transition"
                  >
                    OPEN PAYTM
                  </a>
                  <a
                    href={upiIntentUrl}
                    className="text-center py-2 px-3 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-semibold rounded text-xs font-mono transition"
                  >
                    DEFAULT UPI APP
                  </a>
                </div>
              </div>

              {/* Order Meta Footer */}
              <div className="pt-2 border-t border-[#27272a] flex items-center justify-between text-[11px] font-mono text-[#71717a]">
                <span>ORDER: {order.id}</span>
                <span>TIMEOUT: {remainingSeconds}s</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
