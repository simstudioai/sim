import { NextRequest } from 'next/server'
import { db } from '@/db'
import { savedTemplates, templates } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { auth } from '@/lib/auth'

const logger = createLogger('SavedTemplatesAPI')

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Validate authentication
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user?.id) {
      return createErrorResponse('Unauthorized', 401)
    }

    const url = new URL(request.url)
    const includeState = url.searchParams.get('includeState') === 'true'
    
    logger.info(`[${requestId}] Fetching saved templates for user ${session.user.id}${includeState ? ' with state' : ''}`)

    // Get saved templates with template data
    const savedTemplatesList = await db
      .select({
        id: templates.id,
        name: templates.name,
        short_description: templates.short_description,
        long_description: templates.long_description,
        authorId: templates.authorId,
        authorName: templates.authorName,
        views: templates.views,
        category: templates.category,
        createdAt: templates.createdAt,
        updatedAt: templates.updatedAt,
        // Include state if requested
        ...(includeState ? { state: templates.state } : {}),
        // Include saved template metadata
        timesUsed: savedTemplates.timesUsed,
        lastUsedAt: savedTemplates.lastUsedAt,
        savedAt: savedTemplates.createdAt,
      })
      .from(savedTemplates)
      .innerJoin(templates, eq(savedTemplates.templateId, templates.id))
      .where(eq(savedTemplates.userId, session.user.id))
      .orderBy(savedTemplates.createdAt) // Most recently saved first

    // Transform to match expected format
    const formattedTemplates = savedTemplatesList.map(template => ({
      id: template.id,
      name: template.name,
      short_description: template.short_description,
      long_description: template.long_description,
      authorId: template.authorId,
      authorName: template.authorName,
      views: template.views,
      category: template.category,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      // Include state as workflowState if requested
      ...(includeState && 'state' in template ? { workflowState: template.state } : {}),
      // Add saved-specific metadata
      timesUsed: template.timesUsed,
      lastUsedAt: template.lastUsedAt,
      savedAt: template.savedAt,
    }))

    logger.info(`[${requestId}] Successfully fetched ${formattedTemplates.length} saved templates`)
    
    return createSuccessResponse({
      saved: formattedTemplates,
      total: formattedTemplates.length
    })

  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching saved templates:`, error)
    return createErrorResponse(`Failed to fetch saved templates: ${error.message}`, 500)
  }
} 