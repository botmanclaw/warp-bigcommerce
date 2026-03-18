import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Warp Freight for BigCommerce',
  description: 'Live LTL freight rates at checkout, powered by Warp',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#050505' }}>
        {children}
      </body>
    </html>
  )
}
