import { db } from '@sim/db'
import { templates } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalApiKey } from '@/lib/copilot/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { sanitizeForCopilot } from '@/lib/workflows/json-sanitizer'

const logger = createLogger('TemplatesSanitizedAPI')

export const revalidate = 0

/**
 * GET /api/templates/approved/sanitized
 * Returns all approved templates with their sanitized JSONs, names, and descriptions
 * Requires internal API secret authentication via X-API-Key header
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    // Check internal API key authentication
    const authResult = checkInternalApiKey(request)
    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized access to approved sanitized templates: ${authResult.error}`)
      return NextResponse.json({ error: authResult.error }, { status: 401 })
    }

    logger.info(`[${requestId}] Fetching all approved templates with sanitized JSON`)

    // Fetch all approved templates
    const approvedTemplates = await db
      .select({
        id: templates.id,
        name: templates.name,
        details: templates.details,
        state: templates.state,
        tags: templates.tags,
      })
      .from(templates)
      .where(eq(templates.status, 'approved'))

    logger.info(`[${requestId}] Found ${approvedTemplates.length} approved templates`)

    // Process each template to sanitize for copilot
    const sanitizedTemplates = approvedTemplates.map((template) => {
      try {
        // The template.state is already credential-sanitized, now sanitize for copilot
        const copilotSanitized = sanitizeForCopilot(template.state as any)

        // Extract description from details
        const details = template.details as { tagline?: string; about?: string } | null
        const description = details?.tagline || details?.about || ''

        return {
          id: template.id,
          name: template.name,
          description,
          tags: template.tags,
          sanitizedJson: copilotSanitized,
        }
      } catch (error) {
        logger.error(`[${requestId}] Error sanitizing template ${template.id}`, {
          error: error instanceof Error ? error.message : String(error),
        })
        // Skip templates that fail to sanitize
        return null
      }
    }).filter((t): t is NonNullable<typeof t> => t !== null)

    logger.info(
      `[${requestId}] Successfully sanitized ${sanitizedTemplates.length} templates for copilot`
    )

    return NextResponse.json({
      templates: sanitizedTemplates,
      count: sanitizedTemplates.length,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching approved sanitized templates`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

