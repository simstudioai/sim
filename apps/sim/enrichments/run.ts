import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { EnrichmentConfig, EnrichmentRunContext } from '@/enrichments/types'
import { executeTool } from '@/tools'

const logger = createLogger('Enrichments')

/** Outcome of running an enrichment's provider cascade for one row. */
export interface EnrichmentRunOutcome {
  /** Mapped output values from the winning provider, or `{}` when none hit. */
  result: Record<string, unknown>
  /** Total hosted-key cost (USD) across providers that ran; `0` for BYOK / free. */
  cost: number
  /**
   * Set only when every provider that actually ran errored (none produced a
   * clean result or a clean miss). Lets the caller mark the cell errored instead
   * of blanking it — a genuine "no match" still leaves this `null`.
   */
  error: string | null
  /** Label of the provider whose result was returned, or `null` on no match. */
  provider: string | null
}

/** True when at least one output value in the result is non-empty. */
function hasResult(result: Record<string, unknown>): boolean {
  return Object.values(result).some((v) => v !== undefined && v !== null && v !== '')
}

/** Reads the hosted-key cost `executeTool` merges into a successful output. */
function readCost(output: Record<string, unknown>): number {
  const total = (output.cost as { total?: unknown } | undefined)?.total
  return typeof total === 'number' && Number.isFinite(total) && total > 0 ? total : 0
}

/**
 * Runs an enrichment's provider cascade for one row. Tries providers in order;
 * the first that returns a non-empty result wins and is returned. A provider is
 * skipped when its `buildParams` returns `null` (insufficient inputs); a tool
 * failure or empty mapped result falls through to the next. When every provider
 * that ran errored, `error` is set so the caller can mark the cell errored; a
 * clean miss leaves `error: null` (blank cell). Hosted-key cost is accumulated
 * across providers for the caller to bill.
 *
 * Server-only: imports `executeTool`, which pulls in DB / mailer code. Only the
 * background cell executor imports this module (dynamically).
 */
export async function runEnrichment(
  enrichment: EnrichmentConfig,
  inputs: Record<string, unknown>,
  ctx: EnrichmentRunContext
): Promise<EnrichmentRunOutcome> {
  let cost = 0
  let ranCount = 0
  let errorCount = 0
  let lastError: string | null = null

  for (const provider of enrichment.providers) {
    if (ctx.signal?.aborted) break
    const params = provider.buildParams(inputs)
    if (!params) continue
    ranCount++
    try {
      const response = await executeTool(
        provider.toolId,
        { ...params, _context: { workspaceId: ctx.workspaceId } },
        { signal: ctx.signal }
      )
      if (!response.success) {
        // A 404 means the provider simply has no record for these inputs — a
        // clean no-match, not an infra failure. Fall through to the next
        // provider without counting it as an error (so the cell shows "Not
        // found" rather than an error). Other statuses (auth, rate-limit, 5xx)
        // are real errors and propagate.
        const status = (response.output as { status?: unknown } | undefined)?.status
        if (status === 404) continue
        throw new Error(response.error ?? `${provider.toolId} failed`)
      }
      cost += readCost(response.output)
      const result = provider.mapOutput(response.output)
      if (result && hasResult(result)) {
        logger.info('Enrichment hit', { enrichmentId: enrichment.id, provider: provider.id })
        return { result, cost, error: null, provider: provider.label }
      }
    } catch (err) {
      errorCount++
      lastError = getErrorMessage(err)
      logger.warn('Enrichment provider failed; trying next', {
        enrichmentId: enrichment.id,
        provider: provider.id,
        error: lastError,
      })
    }
  }

  // No provider hit. Surface an error only when every provider that ran errored
  // (infra/auth/rate-limit) — a clean miss returns a blank result instead.
  const error = ranCount > 0 && errorCount === ranCount ? lastError : null
  return { result: {}, cost, error, provider: null }
}
