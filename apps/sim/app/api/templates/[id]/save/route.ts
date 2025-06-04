import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import { savedTemplates, templates } from '@/db/schema'

const logger = createLogger('SaveTemplateAPI')

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: templateId } = await params

  try {
    // Validate authentication
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user?.id) {
      return createErrorResponse('Unauthorized', 401)
    }

    logger.info(`[${requestId}] User ${session.user.id} saving template ${templateId}`)

    // Check if template exists
    const template = await db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.id, templateId))
      .limit(1)

    if (template.length === 0) {
      return createErrorResponse('Template not found', 404)
    }

    // Check if already saved
    const existingSave = await db
      .select()
      .from(savedTemplates)
      .where(
        and(eq(savedTemplates.userId, session.user.id), eq(savedTemplates.templateId, templateId))
      )
      .limit(1)

    if (existingSave.length > 0) {
      return createErrorResponse('Template already saved', 409)
    }

    // Save template
    await db.insert(savedTemplates).values({
      id: nanoid(),
      userId: session.user.id,
      templateId,
      timesUsed: 0,
    })

    logger.info(`[${requestId}] Successfully saved template ${templateId}`)
    return createSuccessResponse({ saved: true })
  } catch (error: any) {
    logger.error(`[${requestId}] Error saving template:`, error)
    return createErrorResponse(`Failed to save template: ${error.message}`, 500)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id: templateId } = await params

  try {
    // Validate authentication
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user?.id) {
      return createErrorResponse('Unauthorized', 401)
    }

    logger.info(`[${requestId}] User ${session.user.id} unsaving template ${templateId}`)

    // Remove from saved templates
    await db
      .delete(savedTemplates)
      .where(
        and(eq(savedTemplates.userId, session.user.id), eq(savedTemplates.templateId, templateId))
      )

    logger.info(`[${requestId}] Successfully unsaved template ${templateId}`)
    return createSuccessResponse({ saved: false })
  } catch (error: any) {
    logger.error(`[${requestId}] Error unsaving template:`, error)
    return createErrorResponse(`Failed to unsave template: ${error.message}`, 500)
  }
}
