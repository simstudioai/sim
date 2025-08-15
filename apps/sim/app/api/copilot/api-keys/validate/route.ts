import { type NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { eq } from 'drizzle-orm'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { copilotApiKeys } from '@/db/schema'

const logger = createLogger('CopilotApiKeysValidate')

function computeLookup(plaintext: string, keyString: string): string {
  // Deterministic MAC: HMAC-SHA256(DB_KEY, plaintext)
  return createHmac('sha256', Buffer.from(keyString, 'utf8')).update(plaintext, 'utf8').digest('hex')
}

export async function POST(req: NextRequest) {
  try {
    if (!env.AGENT_API_DB_ENCRYPTION_KEY) {
      logger.error('AGENT_API_DB_ENCRYPTION_KEY is not set')
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    }

    const body = await req.json().catch(() => null)
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey : undefined

    logger.info('Received API key for validation', { apiKey })

    if (!apiKey) {
      return NextResponse.json({ valid: false }, { status: 200 })
    }

    const lookup = computeLookup(apiKey, env.AGENT_API_DB_ENCRYPTION_KEY)

    const exists = await db
      .select({ id: copilotApiKeys.id })
      .from(copilotApiKeys)
      .where(eq(copilotApiKeys.apiKeyLookup, lookup))
      .limit(1)

    return NextResponse.json({ valid: exists.length > 0 }, { status: 200 })
  } catch (error) {
    logger.error('Error validating copilot API key', { error })
    return NextResponse.json({ error: 'Failed to validate key' }, { status: 500 })
  }
} 