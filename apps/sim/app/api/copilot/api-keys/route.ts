import { createDecipheriv, createHash } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { copilotApiKeys } from '@/db/schema'

const logger = createLogger('CopilotApiKeys')

function deriveKey(keyString: string): Buffer {
  return createHash('sha256').update(keyString, 'utf8').digest()
}

function decryptWithKey(encryptedValue: string, keyString: string): string {
  const parts = encryptedValue.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format')
  }
  const [ivHex, encryptedHex, authTagHex] = parts
  const key = deriveKey(keyString)
  const iv = Buffer.from(ivHex, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

export async function GET(request: NextRequest) {
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

    const rows = await db
      .select({ id: copilotApiKeys.id, apiKeyEncrypted: copilotApiKeys.apiKeyEncrypted })
      .from(copilotApiKeys)
      .where(eq(copilotApiKeys.userId, userId))

    const keys = rows.map((row) => ({
      id: row.id,
      apiKey: decryptWithKey(row.apiKeyEncrypted, env.AGENT_API_DB_ENCRYPTION_KEY as string),
    }))

    return NextResponse.json({ keys }, { status: 200 })
  } catch (error) {
    logger.error('Failed to get copilot API keys', { error })
    return NextResponse.json({ error: 'Failed to get keys' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    await db
      .delete(copilotApiKeys)
      .where(and(eq(copilotApiKeys.userId, userId), eq(copilotApiKeys.id, id)))

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error('Failed to delete copilot API key', { error })
    return NextResponse.json({ error: 'Failed to delete key' }, { status: 500 })
  }
}
