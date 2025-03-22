import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { apiKey } from '@/db/schema'
import { db } from '@/db'

const logger = createLogger('ApiKeysRoute')

// GET /api/user/api-keys - Get all API keys for the current user
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Fetch all API keys for this user
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
      .where(eq(apiKey.userId, userId))
      .orderBy(apiKey.createdAt)

    const maskedKeys = keys.map((key) => ({
      ...key,
      key: key.key,
    }))

    return NextResponse.json({ keys: maskedKeys })
  } catch (error) {
    logger.error('Failed to fetch API keys', { error })
    return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 })
  }
}

// POST /api/user/api-keys - Create a new API key
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()

    // Validate the request
    const { name } = body
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Invalid request. Name is required.' }, { status: 400 })
    }

    // Generate an API key - we'll use a prefix to identify this as an API key (sim_)
    const keyValue = `sim_${nanoid(32)}`

    // Insert the new API key
    const [newKey] = await db
      .insert(apiKey)
      .values({
        id: nanoid(),
        userId,
        name,
        key: keyValue,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({
        id: apiKey.id,
        name: apiKey.name,
        key: apiKey.key,
        createdAt: apiKey.createdAt,
      })

    return NextResponse.json({ key: newKey })
  } catch (error) {
    logger.error('Failed to create API key', { error })
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 })
  }
}
