import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { createApiKey, getApiKeyDisplayFormat } from '@/lib/api-key/auth'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { apiKey } from '@/db/schema'

const logger = createLogger('ApiKeysAPI')

// GET /api/users/me/api-keys - Get all API keys for the current user
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const keys = await db
      .select({
        id: apiKey.id,
        name: apiKey.name,
        key: apiKey.key,
        createdAt: apiKey.createdAt,
        lastUsed: apiKey.lastUsed,
        expiresAt: apiKey.expiresAt,
      })
      .from(apiKey)
      .where(and(eq(apiKey.userId, userId), eq(apiKey.type, 'personal')))
      .orderBy(apiKey.createdAt)

    const maskedKeys = await Promise.all(
      keys.map(async (key) => {
        const displayFormat = await getApiKeyDisplayFormat(key.key)
        return {
          ...key,
          key: key.key,
          displayKey: displayFormat,
        }
      })
    )

    return NextResponse.json({ keys: maskedKeys })
  } catch (error) {
    logger.error('Failed to fetch API keys', { error })
    return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 })
  }
}

// POST /api/users/me/api-keys - Create a new API key
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()

    const { name: rawName } = body
    if (!rawName || typeof rawName !== 'string') {
      return NextResponse.json({ error: 'Invalid request. Name is required.' }, { status: 400 })
    }

    const name = rawName.trim()
    if (!name) {
      return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 })
    }

    const existingKey = await db
      .select()
      .from(apiKey)
      .where(and(eq(apiKey.userId, userId), eq(apiKey.name, name), eq(apiKey.type, 'personal')))
      .limit(1)

    if (existingKey.length > 0) {
      return NextResponse.json(
        {
          error: `A personal API key named "${name}" already exists. Please choose a different name.`,
        },
        { status: 409 }
      )
    }

    const { key: plainKey, encryptedKey } = await createApiKey(true)

    if (!encryptedKey) {
      throw new Error('Failed to encrypt API key for storage')
    }

    const [newKey] = await db
      .insert(apiKey)
      .values({
        id: nanoid(),
        userId,
        workspaceId: null,
        name,
        key: encryptedKey,
        type: 'personal',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({
        id: apiKey.id,
        name: apiKey.name,
        createdAt: apiKey.createdAt,
      })

    return NextResponse.json({
      key: {
        ...newKey,
        key: plainKey,
      },
    })
  } catch (error) {
    logger.error('Failed to create API key', { error })
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 })
  }
}
