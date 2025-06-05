import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('PublicWorkflowAPI')

// Cache response for performance
export const revalidate = 3600

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params

    // First, check if the workflow exists and is published to the templates
    const templatesEntry = await db
      .select({
        id: schema.templates.id,
        workflowId: schema.templates.workflowId,
        state: schema.templates.state,
        name: schema.templates.name,
        longDescription: schema.templates.long_description,
        shortDescription: schema.templates.short_description,
        category: schema.templates.category,
        authorId: schema.templates.authorId,
        authorName: schema.templates.authorName,
      })
      .from(schema.templates)
      .where(eq(schema.templates.workflowId, id))
      .limit(1)
      .then((rows) => rows[0])

    if (!templatesEntry) {
      // Check if workflow exists but is not in templates
      const workflowExists = await db
        .select({ id: schema.workflow.id })
        .from(schema.workflow)
        .where(eq(schema.workflow.id, id))
        .limit(1)
        .then((rows) => rows.length > 0)

      if (!workflowExists) {
        logger.warn(`[${requestId}] Workflow not found: ${id}`)
        return createErrorResponse('Workflow not found', 404)
      }

      logger.warn(`[${requestId}] Workflow exists but is not published: ${id}`)
      return createErrorResponse('Workflow is not published', 403)
    }

    logger.info(`[${requestId}] Retrieved public workflow: ${id}`)

    return createSuccessResponse({
      id: templatesEntry.workflowId,
      name: templatesEntry.name,
      longDescription: templatesEntry.longDescription,
      shortDescription: templatesEntry.shortDescription,
      category: templatesEntry.category,
      authorId: templatesEntry.authorId,
      authorName: templatesEntry.authorName,
      state: templatesEntry.state,
      isPublic: true,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting public workflow: ${(await params).id}`, error)
    return createErrorResponse('Failed to get public workflow', 500)
  }
}
