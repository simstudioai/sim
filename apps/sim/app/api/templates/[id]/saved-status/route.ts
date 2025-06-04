import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import { savedTemplates } from '@/db/schema'

const logger = createLogger('TemplateSavedStatusAPI')

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: templateId } = await params

  try {
    // Validate authentication
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user?.id) {
      return createErrorResponse('Unauthorized', 401)
    }

    logger.info(
      `[${requestId}] Checking saved status for template ${templateId} by user ${session.user.id}`
    )

    // Check if template is saved by user
    const savedTemplate = await db
      .select({
        id: savedTemplates.id,
        timesUsed: savedTemplates.timesUsed,
        lastUsedAt: savedTemplates.lastUsedAt,
        savedAt: savedTemplates.createdAt,
      })
      .from(savedTemplates)
      .where(
        and(eq(savedTemplates.userId, session.user.id), eq(savedTemplates.templateId, templateId))
      )
      .limit(1)

    const isSaved = savedTemplate.length > 0

    logger.info(
      `[${requestId}] Template ${templateId} is ${isSaved ? 'saved' : 'not saved'} by user`
    )

    return createSuccessResponse({
      saved: isSaved,
      ...(isSaved && savedTemplate[0]
        ? {
            timesUsed: savedTemplate[0].timesUsed,
            lastUsedAt: savedTemplate[0].lastUsedAt,
            savedAt: savedTemplate[0].savedAt,
          }
        : {}),
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error checking saved status:`, error)
    return createErrorResponse(`Failed to check saved status: ${error.message}`, 500)
  }
}
