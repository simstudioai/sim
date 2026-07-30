import { db } from '@sim/db'
import { apiKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createPersonalApiKeyContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getApiKeyDisplayFormat } from '@/lib/api-key/auth'
import { performCreatePersonalApiKey } from '@/lib/api-key/orchestration'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('ApiKeysAPI')

// GET /api/users/me/api-keys - Get all API keys for the current user
export const GET = withRouteHandler(async (request: NextRequest) => {
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
          id: key.id,
          name: key.name,
          createdAt: key.createdAt,
          lastUsed: key.lastUsed,
          expiresAt: key.expiresAt,
          displayKey: displayFormat,
        }
      })
    )

    return NextResponse.json({ keys: maskedKeys })
  } catch (error) {
    logger.error('Failed to fetch API keys', { error })
    return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 })
  }
})

// POST /api/users/me/api-keys - Create a new API key
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const parsed = await parseRequest(createPersonalApiKeyContract, request, {})
    if (!parsed.success) return parsed.response

    const { name } = parsed.data.body

    const result = await performCreatePersonalApiKey({
      userId,
      name,
      actorName: session.user.name,
      actorEmail: session.user.email,
      request,
    })
    if (!result.success || !result.key) {
      const status = result.errorCode === 'conflict' ? 409 : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    captureServerEvent(userId, 'api_key_created', {
      key_name: name,
      scope: 'personal',
    })

    return NextResponse.json({ key: result.key })
  } catch (error) {
    logger.error('Failed to create API key', { error })
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 })
  }
})
