import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { runEnrichmentContract } from '@/lib/api/contracts/tools/enrichment'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getEnrichment } from '@/enrichments/registry'
import { runEnrichment } from '@/enrichments/run'

const logger = createLogger('EnrichmentRunAPI')

/**
 * POST /api/tools/enrichment/run
 *
 * Runs a registry enrichment's provider cascade and returns its outputs. Backs
 * the Enrichment workflow block; called server-to-server by the executor, so it
 * authenticates with the internal token. The cascade injects the workspace's
 * BYOK / hosted key via `executeTool` using `workspaceId`.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(
    runEnrichmentContract,
    request,
    {},
    {
      validationErrorResponse: (error) =>
        NextResponse.json(
          { error: getValidationErrorMessage(error, 'Invalid request') },
          {
            status: 400,
          }
        ),
    }
  )
  if (!parsed.success) return parsed.response

  const { enrichmentId, inputs, workspaceId } = parsed.data.body
  const enrichment = getEnrichment(enrichmentId)
  if (!enrichment) {
    return NextResponse.json({ error: `Unknown enrichment "${enrichmentId}"` }, { status: 400 })
  }

  const { result, cost, error, provider } = await runEnrichment(enrichment, inputs, {
    workspaceId,
    signal: request.signal,
  })

  logger.info('Enrichment block run', {
    enrichmentId,
    matched: Object.keys(result).length > 0,
    provider,
  })
  return NextResponse.json({
    matched: Object.keys(result).length > 0,
    result,
    cost,
    error,
    provider,
  })
})
