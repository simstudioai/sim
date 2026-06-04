import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { apiKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { apiKeyIdParamsSchema } from '@/lib/api/contracts'
import { getValidationErrorMessage } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ApiKeyAPI')

// DELETE /api/users/me/api-keys/[id] - Delete an API key
export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const parsedParams = apiKeyIdParamsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(parsedParams.error) },
        { status: 400 }
      )
    }
    const { id } = parsedParams.data

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userId = session.user.id
      const keyId = id

      // Delete the API key, ensuring it belongs to the current user
      const result = await db
        .delete(apiKey)
        .where(and(eq(apiKey.id, keyId), eq(apiKey.userId, userId), eq(apiKey.type, 'personal')))
        .returning({ id: apiKey.id, name: apiKey.name })

      if (!result.length) {
        return NextResponse.json({ error: 'API key not found' }, { status: 404 })
      }

      const deletedKey = result[0]

      recordAudit({
        workspaceId: null,
        actorId: userId,
        action: AuditAction.PERSONAL_API_KEY_REVOKED,
        resourceType: AuditResourceType.API_KEY,
        resourceId: keyId,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        resourceName: deletedKey.name,
        description: `Revoked personal API key: ${deletedKey.name}`,
        request,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete API key', { error })
      return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 })
    }
  }
)
