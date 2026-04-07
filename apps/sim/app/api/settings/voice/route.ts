import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { hasSTTService } from '@/lib/speech/transcriber'

export async function GET() {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ sttAvailable: hasSTTService() })
}
