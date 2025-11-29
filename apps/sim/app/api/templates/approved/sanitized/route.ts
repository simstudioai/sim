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
    const url = new URL(request.url)
    const hasApiKey = !!request.headers.get('x-api-key')

    // Check internal API key authentication
    const authResult = checkInternalApiKey(request)
    if (!authResult.success) {
      logger.warn(`[${requestId}] Authentication failed for approved sanitized templates`, {
        error: authResult.error,
        hasApiKey,
        howToUse: 'Add header: X-API-Key: <INTERNAL_API_SECRET>',
      })
      return NextResponse.json(
        {
          error: authResult.error,
          hint: 'Include X-API-Key header with INTERNAL_API_SECRET value',
        },
        { status: 401 }
      )
    }

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

    // Process each template to sanitize for copilot
    const sanitizedTemplates = approvedTemplates
      .map((template) => {
        try {
          const copilotSanitized = sanitizeForCopilot(template.state as any)

          if (copilotSanitized?.blocks) {
            Object.values(copilotSanitized.blocks).forEach((block: any) => {
              if (block && typeof block === 'object') {
                block.outputs = undefined
                block.position = undefined
                block.height = undefined
                block.layout = undefined
                block.horizontalHandles = undefined

                // Also clean nested nodes recursively
                if (block.nestedNodes) {
                  Object.values(block.nestedNodes).forEach((nestedBlock: any) => {
                    if (nestedBlock && typeof nestedBlock === 'object') {
                      nestedBlock.outputs = undefined
                      nestedBlock.position = undefined
                      nestedBlock.height = undefined
                      nestedBlock.layout = undefined
                      nestedBlock.horizontalHandles = undefined
                    }
                  })
                }
              }
            })
          }

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
          return null
        }
      })
      .filter((t): t is NonNullable<typeof t> => t !== null)

    const response = {
      templates: sanitizedTemplates,
      count: sanitizedTemplates.length,
    }

    return NextResponse.json(response)
  } catch (error) {
    logger.error(`[${requestId}] Error fetching approved sanitized templates`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      {
        error: 'Internal server error',
        requestId,
      },
      { status: 500 }
    )
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
