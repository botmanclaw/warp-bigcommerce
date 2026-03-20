'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

const G = '#39FF14'

function SetupInner() {
  const params = useSearchParams()
  const storeHash = params.get('store_hash') ||
    (typeof document !== 'undefined'
      ? document.cookie.split('; ').find(r => r.startsWith('bc_store_hash='))?.split('=')[1] ?? ''
      : '')

  const [originZip, setOriginZip] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSave() {
    if (!originZip.trim() || !/^\d{5}$/.test(originZip.trim())) {
      setErrorMsg('Please enter a valid 5-digit ZIP code')
      return
    }
    setStatus('saving')
    setErrorMsg('')

    const res = await fetch('/api/save-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store_hash: storeHash, origin_zip: originZip.trim() }),
    })
    const data = await res.json()

    if (data.ok) {
      setStatus('success')
    } else {
      setStatus('error')
      setErrorMsg(data.error || 'Something went wrong')
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#050505',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', 'Helvetica Neue', sans-serif",
      padding: '40px 24px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 480,
        background: '#0d0d0d',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: '40px',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: G,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#050505" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div style={{ color: '#f0f0f0', fontWeight: 700, fontSize: 16 }}>Warp Freight</div>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>BigCommerce Integration</div>
          </div>
        </div>

        {status === 'success' ? (
          <div>
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'rgba(57,255,20,0.12)',
              border: `1px solid ${G}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 20,
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <polyline points="20 6 9 17 4 12" stroke={G} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 style={{ color: '#f0f0f0', fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>
              Warp is ready
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, margin: '0 0 24px', lineHeight: 1.6 }}>
              Your origin ZIP has been saved. Shoppers will now see live Warp LTL freight rates at checkout.
            </p>
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
              You can update your origin ZIP anytime by returning to this page.
            </p>
          </div>
        ) : (
          <div>
            <h2 style={{ color: '#f0f0f0', fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>
              Set up Warp Freight
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, margin: '0 0 28px', lineHeight: 1.6 }}>
              Enter your warehouse or fulfillment center ZIP code. Warp will calculate live LTL freight rates from this location to your customers at checkout.
            </p>

            <div style={{ marginBottom: 20 }}>
              <label style={{
                display: 'block',
                color: 'rgba(255,255,255,0.6)',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 8,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}>
                Origin ZIP Code
              </label>
              <input
                type="text"
                value={originZip}
                onChange={e => setOriginZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                placeholder="e.g. 90210"
                maxLength={5}
                style={{
                  width: '100%',
                  background: '#111',
                  border: `1px solid ${originZip.length === 5 ? 'rgba(57,255,20,0.4)' : 'rgba(255,255,255,0.12)'}`,
                  borderRadius: 8,
                  padding: '12px 14px',
                  color: '#f0f0f0',
                  fontSize: 18,
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
            </div>

            {errorMsg && (
              <div style={{
                background: 'rgba(255,60,60,0.08)',
                border: '1px solid rgba(255,60,60,0.25)',
                borderRadius: 8,
                padding: '10px 14px',
                color: 'rgba(255,100,100,0.9)',
                fontSize: 13,
                marginBottom: 20,
              }}>
                {errorMsg}
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={status === 'saving'}
              style={{
                width: '100%',
                background: G,
                color: '#050505',
                border: 'none',
                borderRadius: 8,
                padding: '12px 0',
                fontSize: 14,
                fontWeight: 700,
                cursor: status === 'saving' ? 'not-allowed' : 'pointer',
                opacity: status === 'saving' ? 0.7 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {status === 'saving' ? 'Saving...' : 'Save & Activate'}
            </button>

            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginTop: 20, textAlign: 'center' }}>
              Powered by{' '}
              <a href="https://wearewarp.com" target="_blank" style={{ color: G, textDecoration: 'none' }}>
                Warp
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SetupPage() {
  return (
    <Suspense fallback={null}>
      <SetupInner />
    </Suspense>
  )
}
