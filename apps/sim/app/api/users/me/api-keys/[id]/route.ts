import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { apiKey } from '@/db/schema'

const logger = createLogger('ApiKeyAPI')

// DELETE /api/users/me/api-keys/[id] - Delete an API key
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Deleting API key: ${id}`)
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const keyId = id

    if (!keyId) {
      return NextResponse.json({ error: 'API key ID is required' }, { status: 400 })
    }

    // Delete the API key, ensuring it belongs to the current user
    const result = await db
      .delete(apiKey)
      .where(and(eq(apiKey.id, keyId), eq(apiKey.userId, userId)))
      .returning({ id: apiKey.id })

    if (!result.length) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to delete API key', { error })
    return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 })
  }
}
