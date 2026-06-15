import { createLogger } from '@sim/logger'
import { EnrichmentRun } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { getEnrichment } from '@/enrichments/registry'
import { runEnrichment } from '@/enrichments/run'

interface EnrichmentRunParams {
  enrichmentId: string
  inputs: Record<string, unknown>
}

interface EnrichmentRunResult {
  matched: boolean
  result: Record<string, unknown>
  provider: string | null
  /** Hosted-key cost surfaced for per-round billing (omitted for BYOK / free). */
  _serviceCost?: { service: string; cost: number }
}

/**
 * Direct one-off enrichment lookup. Runs the same provider cascade as table
 * enrichments (`runEnrichment`) for a single entity and returns the result
 * inline — no table required. The hosted-key cost is surfaced as `_serviceCost`
 * so copilot's per-round billing charges for it, matching how the media tools
 * bill (see image/generate-image.ts).
 */
export const enrichmentRunServerTool: BaseServerTool<EnrichmentRunParams, EnrichmentRunResult> = {
  name: EnrichmentRun.id,
  async execute(params: EnrichmentRunParams, context): Promise<EnrichmentRunResult> {
    const logger = createLogger('EnrichmentRunServerTool')
    const { enrichmentId, inputs } = params

    if (!enrichmentId || typeof enrichmentId !== 'string') {
      throw new Error('enrichmentId is required')
    }
    const workspaceId = context?.workspaceId
    if (!workspaceId) {
      throw new Error('workspaceId is required to run an enrichment')
    }
    const enrichment = getEnrichment(enrichmentId)
    if (!enrichment) {
      throw new Error(`Unknown enrichment "${enrichmentId}"`)
    }

    const { result, cost, error, provider } = await runEnrichment(enrichment, inputs ?? {}, {
      workspaceId,
      signal: context?.abortSignal,
    })

    const matched = Object.keys(result).length > 0
    logger.info('Enrichment run', { enrichmentId, matched, provider, cost })

    // A genuine "no match" returns normally (matched: false). Only surface an
    // error when every provider that ran failed (infra/auth/rate-limit).
    if (error && !matched) {
      throw new Error(error)
    }

    return {
      matched,
      result,
      provider,
      ...(cost > 0 ? { _serviceCost: { service: provider ?? enrichmentId, cost } } : {}),
    }
  },
}
