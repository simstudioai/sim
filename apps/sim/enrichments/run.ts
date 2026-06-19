import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { EnrichmentProviderOutcome, EnrichmentRunDetail } from '@/lib/table/types'
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
  /** Per-provider cascade breakdown + timing for the enrichment details panel. */
  detail: EnrichmentRunDetail
}

/**
 * Detail for a terminal cell that recorded no provider attempt — missing
 * required inputs, or cancelled before any provider ran. Every provider is
 * marked `skipped` so the details panel stays informative (shows the configured
 * cascade) instead of empty.
 */
export function skippedEnrichmentDetail(
  enrichment: EnrichmentConfig,
  opts: { aborted?: boolean } = {}
): EnrichmentRunDetail {
  const now = new Date().toISOString()
  return {
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    totalCost: 0,
    matchedProvider: null,
    aborted: opts.aborted ?? false,
    providers: enrichment.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      toolId: provider.toolId,
      status: 'skipped' as const,
      cost: 0,
      durationMs: 0,
      error: null,
    })),
  }
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
  let matchedProvider: string | null = null
  let winner: { result: Record<string, unknown>; label: string } | null = null
  const providers: EnrichmentProviderOutcome[] = []
  const startedAt = Date.now()

  for (let i = 0; i < enrichment.providers.length; i++) {
    const provider = enrichment.providers[i]
    if (ctx.signal?.aborted) break
    const params = provider.buildParams(inputs)
    if (!params) {
      providers.push({
        id: provider.id,
        label: provider.label,
        toolId: provider.toolId,
        status: 'skipped',
        cost: 0,
        durationMs: 0,
        error: null,
      })
      continue
    }
    ranCount++
    const providerStart = Date.now()
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
        if (status === 404) {
          providers.push({
            id: provider.id,
            label: provider.label,
            toolId: provider.toolId,
            status: 'no_match',
            cost: 0,
            durationMs: Date.now() - providerStart,
            error: null,
          })
          continue
        }
        throw new Error(response.error ?? `${provider.toolId} failed`)
      }
      const providerCost = readCost(response.output)
      cost += providerCost
      const result = provider.mapOutput(response.output)
      if (result && hasResult(result)) {
        providers.push({
          id: provider.id,
          label: provider.label,
          toolId: provider.toolId,
          status: 'matched',
          cost: providerCost,
          durationMs: Date.now() - providerStart,
          error: null,
        })
        matchedProvider = provider.id
        winner = { result, label: provider.label }
        logger.info('Enrichment hit', { enrichmentId: enrichment.id, provider: provider.id })
        break
      }
      // Ran cleanly but mapped to nothing — a no-match, fall through to the next.
      providers.push({
        id: provider.id,
        label: provider.label,
        toolId: provider.toolId,
        status: 'no_match',
        cost: providerCost,
        durationMs: Date.now() - providerStart,
        error: null,
      })
    } catch (err) {
      errorCount++
      lastError = getErrorMessage(err)
      providers.push({
        id: provider.id,
        label: provider.label,
        toolId: provider.toolId,
        status: 'error',
        cost: 0,
        durationMs: Date.now() - providerStart,
        error: lastError,
      })
      logger.warn('Enrichment provider failed; trying next', {
        enrichmentId: enrichment.id,
        provider: provider.id,
        error: lastError,
      })
    }
  }

  // Any provider not represented yet never ran — the cascade short-circuited on
  // a match or aborted mid-run. Record them as `not_run` (in registry order) so
  // the panel always shows the full configured cascade.
  const seen = new Set(providers.map((p) => p.id))
  for (const provider of enrichment.providers) {
    if (seen.has(provider.id)) continue
    providers.push({
      id: provider.id,
      label: provider.label,
      toolId: provider.toolId,
      status: 'not_run',
      cost: 0,
      durationMs: 0,
      error: null,
    })
  }

  const completedAt = Date.now()
  const detail: EnrichmentRunDetail = {
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: completedAt - startedAt,
    totalCost: cost,
    matchedProvider,
    aborted: Boolean(ctx.signal?.aborted),
    providers,
  }

  if (winner) {
    return { result: winner.result, cost, error: null, provider: winner.label, detail }
  }

  // No provider hit. Surface an error only when every provider that ran errored
  // (infra/auth/rate-limit) — a clean miss returns a blank result instead.
  const error = ranCount > 0 && errorCount === ranCount ? lastError : null
  return { result: {}, cost, error, provider: null, detail }
}
