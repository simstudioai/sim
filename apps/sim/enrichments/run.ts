import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { EnrichmentConfig, EnrichmentRunContext } from '@/enrichments/types'
import { executeTool } from '@/tools'

const logger = createLogger('Enrichments')

/** True when at least one output value in the result is non-empty. */
function hasResult(result: Record<string, unknown>): boolean {
  return Object.values(result).some((v) => v !== undefined && v !== null && v !== '')
}

/**
 * Runs an enrichment's provider cascade for one row. Tries providers in order;
 * the first that returns a non-empty result wins and is returned. A provider is
 * skipped when its `buildParams` returns `null` (insufficient inputs); a tool
 * failure or empty mapped result falls through to the next. When every provider
 * misses, returns `{}` — the caller writes a blank (not errored) cell.
 *
 * Server-only: imports `executeTool`, which pulls in DB / mailer code. Only the
 * background cell executor imports this module (dynamically).
 */
export async function runEnrichment(
  enrichment: EnrichmentConfig,
  inputs: Record<string, unknown>,
  ctx: EnrichmentRunContext
): Promise<Record<string, unknown>> {
  for (const provider of enrichment.providers) {
    if (ctx.signal?.aborted) break
    const params = provider.buildParams(inputs)
    if (!params) continue
    try {
      const response = await executeTool(
        provider.toolId,
        { ...params, _context: { workspaceId: ctx.workspaceId } },
        { signal: ctx.signal }
      )
      if (!response.success) {
        throw new Error(response.error ?? `${provider.toolId} failed`)
      }
      const result = provider.mapOutput(response.output)
      if (result && hasResult(result)) {
        logger.info('Enrichment hit', { enrichmentId: enrichment.id, provider: provider.id })
        return result
      }
    } catch (err) {
      logger.warn('Enrichment provider failed; trying next', {
        enrichmentId: enrichment.id,
        provider: provider.id,
        error: getErrorMessage(err),
      })
    }
  }
  return {}
}
