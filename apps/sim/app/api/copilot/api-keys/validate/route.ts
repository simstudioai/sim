import { NextResponse, type NextRequest } from 'next/server'
import { createDecipheriv, createHash, createHmac } from 'crypto'
import { eq } from 'drizzle-orm'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { copilotApiKeys } from '@/db/schema'

const logger = createLogger('CopilotApiKeysValidate')

function deriveKey(keyString: string): Buffer {
  return createHash('sha256').update(keyString, 'utf8').digest()
}

function decryptWithKey(encryptedValue: string, keyString: string): string {
  const [ivHex, encryptedHex, authTagHex] = encryptedValue.split(':')
  if (!ivHex || !encryptedHex || !authTagHex) {
    throw new Error('Invalid encrypted format')
  }
  const key = deriveKey(keyString)
  const iv = Buffer.from(ivHex, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

function computeLookup(plaintext: string, keyString: string): string {
  return createHmac('sha256', Buffer.from(keyString, 'utf8')).update(plaintext, 'utf8').digest('hex')
}

export async function POST(req: NextRequest) {
  try {
    if (!env.AGENT_API_NETWORK_ENCRYPTION_KEY || !env.AGENT_API_DB_ENCRYPTION_KEY) {
      logger.error('Encryption keys not configured')
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    }

    const body = await req.json()
    const { token } = body as { token?: string }
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ valid: false }, { status: 200 })
    }

    // Decrypt the incoming network-encrypted token to plaintext key
    let plaintextKey: string
    try {
      plaintextKey = decryptWithKey(token, env.AGENT_API_NETWORK_ENCRYPTION_KEY)
    } catch {
      return NextResponse.json({ valid: false }, { status: 200 })
    }

    // Compute deterministic lookup with DB key
    const lookup = computeLookup(plaintextKey, env.AGENT_API_DB_ENCRYPTION_KEY)

    // O(1) indexed equality lookup
    const exists = await db
      .select({ id: copilotApiKeys.id })
      .from(copilotApiKeys)
      .where(eq(copilotApiKeys.apiKeyLookup, lookup))
      .limit(1)

    const valid = exists.length > 0
    return NextResponse.json({ valid }, { status: 200 })
  } catch (error) {
    logger.error('Error validating copilot API key', { error })
    return NextResponse.json({ error: 'Failed to validate key' }, { status: 500 })
  }
} 