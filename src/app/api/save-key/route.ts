// Saves merchant's origin ZIP from the setup iFrame
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { store_hash, origin_zip } = await req.json()

  if (!store_hash || !origin_zip) {
    return NextResponse.json({ ok: false, error: 'Missing fields' }, { status: 400 })
  }

  if (!/^\d{5}$/.test(origin_zip)) {
    return NextResponse.json({ ok: false, error: 'Invalid ZIP code' }, { status: 400 })
  }

  await supabase
    .from('bc_merchants')
    .update({ origin_zip, configured_at: new Date().toISOString() })
    .eq('store_hash', store_hash)

  return NextResponse.json({ ok: true })
}
