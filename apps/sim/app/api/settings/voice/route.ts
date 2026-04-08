import { NextResponse } from 'next/server'
import { hasSTTService } from '@/lib/speech/config'

/**
 * Returns whether server-side STT is configured.
 * Unauthenticated — the response is a single boolean,
 * not sensitive data, and deployed chat visitors need it.
 */
export async function GET() {
  return NextResponse.json({ sttAvailable: hasSTTService() })
}
