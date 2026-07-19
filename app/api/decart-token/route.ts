import { createDecartClient } from '@decartai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { pickDecartApiKey } from '@/lib/watermark'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Preference watermark envoyee par le client (bouton "Logo MirageCam" du
  // dashboard). Le serveur decide de la cle : le client ne voit jamais les cles.
  const noWatermarkRequested = request.nextUrl.searchParams.get('no_watermark') === '1'
  const { apiKey, usedNoWatermark } = pickDecartApiKey(noWatermarkRequested)

  if (!apiKey) {
    console.error('[Decart Token] DECART_API_KEY not configured')
    return NextResponse.json(
      { error: 'Service temporairement indisponible' },
      { status: 500 }
    )
  }

  try {
    const client = createDecartClient({ apiKey })

    // Token ephemere avec restrictions
    const token = await client.tokens.create({
      expiresIn: 600, // 10 minutes max
      allowedModels: ['lucy-2.5', 'lucy-2.1'],
    })

    console.log(`[Decart Token] Token cree | noWatermark=${usedNoWatermark}`)

    return NextResponse.json({
      success: true,
      token: token.apiKey || (token as any).token,
      expiresAt: token.expiresAt,
      noWatermark: usedNoWatermark
    })
  } catch (error: any) {
    console.error('[Decart Token] Error:', error.message)
    return NextResponse.json(
      { error: 'Impossible de demarrer le swap. Reessaie.', details: error.message },
      { status: 500 }
    )
  }
}
