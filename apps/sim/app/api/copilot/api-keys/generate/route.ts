import { createCipheriv, createHash, createHmac, randomBytes } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { generateApiKey } from '@/lib/utils'
import { db } from '@/db'
import { copilotApiKeys } from '@/db/schema'

const logger = createLogger('CopilotApiKeysGenerate')

function deriveKey(keyString: string): Buffer {
  return createHash('sha256').update(keyString, 'utf8').digest()
}

function encryptRandomIv(plaintext: string, keyString: string): string {
  const key = deriveKey(keyString)
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return `${iv.toString('hex')}:${encrypted}:${authTag}`
}

function computeLookup(plaintext: string, keyString: string): string {
  // Deterministic, constant-time comparable MAC: HMAC-SHA256(DB_KEY, plaintext)
  return createHmac('sha256', Buffer.from(keyString, 'utf8'))
    .update(plaintext, 'utf8')
    .digest('hex')
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!env.AGENT_API_DB_ENCRYPTION_KEY) {
      logger.error('AGENT_API_DB_ENCRYPTION_KEY is not set')
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    }

    const userId = session.user.id

    // Generate and prefix the key (strip the generic sim_ prefix from the random part)
    const rawKey = generateApiKey().replace(/^sim_/, '')
    const plaintextKey = `sk-sim-copilot-${rawKey}`

    // Encrypt with random IV for confidentiality
    const dbEncrypted = encryptRandomIv(plaintextKey, env.AGENT_API_DB_ENCRYPTION_KEY)

    // Compute deterministic lookup value for O(1) search
    const lookup = computeLookup(plaintextKey, env.AGENT_API_DB_ENCRYPTION_KEY)

    const [inserted] = await db
      .insert(copilotApiKeys)
      .values({ userId, apiKeyEncrypted: dbEncrypted, apiKeyLookup: lookup })
      .returning({ id: copilotApiKeys.id })

    return NextResponse.json(
      { success: true, key: { id: inserted.id, apiKey: plaintextKey } },
      { status: 201 }
    )
  } catch (error) {
    logger.error('Failed to generate copilot API key', { error })
    return NextResponse.json({ error: 'Failed to generate copilot API key' }, { status: 500 })
  }
}
