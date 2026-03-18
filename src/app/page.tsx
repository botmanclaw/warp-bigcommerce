const G = '#39FF14'

export default function HomePage() {
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
      <div style={{ maxWidth: 560, textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 12,
          background: G,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px',
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#050505" strokeWidth="2" fill="none" strokeLinecap="round"/>
          </svg>
        </div>

        <h1 style={{ color: '#f0f0f0', fontSize: 28, fontWeight: 800, margin: '0 0 12px' }}>
          Warp Freight for BigCommerce
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 16, margin: '0 0 32px', lineHeight: 1.6 }}>
          Give your shoppers live LTL freight rates at checkout, powered by Warp&apos;s carrier network.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'left', marginBottom: 40 }}>
          {[
            ['Live rates at checkout', 'Warp LTL rates appear alongside standard shipping options — no manual input required.'],
            ['Automatic residential detection', 'Residential surcharges are applied automatically based on delivery address type.'],
            ['Real transit time', 'Business day estimates shown to shoppers at time of quote.'],
            ['One-time setup', 'Paste your Warp API key once. Rates are fetched automatically on every checkout.'],
          ].map(([title, desc]) => (
            <div key={title} style={{
              background: '#0d0d0d',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 12,
              padding: '16px 20px',
              display: 'flex',
              gap: 14,
              alignItems: 'flex-start',
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: G, flexShrink: 0, marginTop: 6,
              }} />
              <div>
                <div style={{ color: '#f0f0f0', fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{title}</div>
                <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, lineHeight: 1.5 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>

        <a
          href="https://www.bigcommerce.com/apps/"
          target="_blank"
          style={{
            display: 'inline-block',
            background: G,
            color: '#050505',
            borderRadius: 8,
            padding: '12px 28px',
            fontWeight: 700,
            fontSize: 14,
            textDecoration: 'none',
          }}
        >
          Install from BigCommerce App Marketplace
        </a>

        <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, marginTop: 24 }}>
          Need help?{' '}
          <a href="mailto:support@wearewarp.com" style={{ color: G, textDecoration: 'none' }}>
            support@wearewarp.com
          </a>
        </p>
      </div>
    </div>
  )
}
