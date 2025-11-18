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
 *
 * Example usage:
 * curl -X GET https://your-domain.com/api/templates/approved/sanitized \
 *   -H "X-API-Key: your_internal_api_secret"
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    // Log incoming request details
    const url = new URL(request.url)
    const hasApiKey = !!request.headers.get('x-api-key')
    
    logger.info(`[${requestId}] Incoming request to /api/templates/approved/sanitized`, {
      method: request.method,
      url: url.pathname,
      fullUrl: url.toString(),
      hasApiKey,
      userAgent: request.headers.get('user-agent'),
      origin: request.headers.get('origin'),
    })

    // Check internal API key authentication
    const authResult = checkInternalApiKey(request)
    if (!authResult.success) {
      logger.warn(`[${requestId}] Authentication failed for approved sanitized templates`, {
        error: authResult.error,
        hasApiKey,
        howToUse: 'Add header: X-API-Key: <INTERNAL_API_SECRET>',
      })
      return NextResponse.json({ 
        error: authResult.error,
        hint: 'Include X-API-Key header with INTERNAL_API_SECRET value'
      }, { status: 401 })
    }

    logger.info(`[${requestId}] Authentication successful, fetching approved templates`)

    // Fetch all approved templates
    const approvedTemplates = await db
      .select({
        id: templates.id,
        name: templates.name,
        details: templates.details,
        state: templates.state,
        tags: templates.tags,
        requiredCredentials: templates.requiredCredentials,
      })
      .from(templates)
      .where(eq(templates.status, 'approved'))

    logger.info(`[${requestId}] Found ${approvedTemplates.length} approved templates`, {
      templateIds: approvedTemplates.map(t => t.id).slice(0, 5), // Log first 5 IDs
      totalCount: approvedTemplates.length,
    })

    // Process each template to sanitize for copilot
    const sanitizedTemplates = approvedTemplates.map((template) => {
      try {
        // The template.state is already credential-sanitized, now sanitize for copilot
        const copilotSanitized = sanitizeForCopilot(template.state as any)

        // Defensively remove any outputs fields that might have leaked through
        // This ensures runtime execution data is never sent to copilot
        if (copilotSanitized?.blocks) {
          Object.values(copilotSanitized.blocks).forEach((block: any) => {
            if (block && typeof block === 'object') {
              delete block.outputs
              delete block.position
              delete block.height
              delete block.layout
              delete block.horizontalHandles
              
              // Also clean nested nodes recursively
              if (block.nestedNodes) {
                Object.values(block.nestedNodes).forEach((nestedBlock: any) => {
                  if (nestedBlock && typeof nestedBlock === 'object') {
                    delete nestedBlock.outputs
                    delete nestedBlock.position
                    delete nestedBlock.height
                    delete nestedBlock.layout
                    delete nestedBlock.horizontalHandles
                  }
                })
              }
            }
          })
        }

        // Extract description from details
        const details = template.details as { tagline?: string; about?: string } | null
        const description = details?.tagline || details?.about || ''

        return {
          id: template.id,
          name: template.name,
          description,
          tags: template.tags,
          requiredCredentials: template.requiredCredentials,
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
      `[${requestId}] Successfully sanitized ${sanitizedTemplates.length} templates for copilot`,
      {
        totalTemplates: sanitizedTemplates.length,
        templateNames: sanitizedTemplates.map(t => t.name).slice(0, 5), // Log first 5 names
      }
    )

    const response = {
      templates: sanitizedTemplates,
      count: sanitizedTemplates.length,
    }

    logger.info(`[${requestId}] Sending response`, {
      responseSize: JSON.stringify(response).length,
      templateCount: sanitizedTemplates.length,
    })

    return NextResponse.json(response)
  } catch (error) {
    logger.error(`[${requestId}] Error fetching approved sanitized templates`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json({ 
      error: 'Internal server error',
      requestId,
    }, { status: 500 })
  }
}

// Add a helpful OPTIONS handler for CORS preflight
export async function OPTIONS(request: NextRequest) {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] OPTIONS request received for /api/templates/approved/sanitized`)
  
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'X-API-Key, Content-Type',
    },
  })
}

