import { appendFileSync } from 'fs'
import { NextResponse } from 'next/server'

const LOG_PATH = process.env.DEBUG_LOG_PATH || '.cursor/debug.log'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const line = `${JSON.stringify({ ...body, timestamp: body.timestamp || Date.now() })}\n`
    appendFileSync(LOG_PATH, line, 'utf-8')
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
