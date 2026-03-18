// Saves merchant's Warp API key from the setup iFrame
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getWarpQuote } from '@/lib/warp'

export async function POST(req: NextRequest) {
  const { store_hash, warp_api_key } = await req.json()

  if (!store_hash || !warp_api_key) {
    return NextResponse.json({ ok: false, error: 'Missing fields' }, { status: 400 })
  }

  // Validate the key works
  const result = await getWarpQuote(warp_api_key.trim(), {
    pickupZipcode: '60603',
    dropoffZipcode: '90021',
    commodityName: 'Test',
    totalWeight: 200,
    quantity: 1,
    length: 48,
    width: 40,
    height: 48,
    stackable: false,
  })

  if (!result) {
    return NextResponse.json({ ok: false, error: 'Invalid Warp API key — could not get a test quote' }, { status: 400 })
  }

  await supabase
    .from('bc_merchants')
    .update({ warp_api_key: warp_api_key.trim(), configured_at: new Date().toISOString() })
    .eq('store_hash', store_hash)

  return NextResponse.json({ ok: true })
}
