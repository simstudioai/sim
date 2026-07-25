/**
 * The host-side `web_search` tool used by Local Dev and Review Code, both of which run the Pi SDK
 * in Sim's process. Create PR has no host in the loop and registers a sandbox extension instead.
 *
 * Provider calls go through `executeTool` so they inherit Sim's URL validation, IP pinning, and
 * workspace tool denylist. The key is passed explicitly, which is what makes hosted-key injection
 * return early — Pi search can never spend a Sim-owned key.
 */

import { createLogger } from '@sim/logger'
import type { PiSearchConfig, PiToolSpec } from '@/executor/handlers/pi/backend'
import { PI_SEARCH_PROVIDERS } from '@/executor/handlers/pi/keys'
import {
  buildPiSearchProviderArgs,
  extractPiSearchRecords,
  normalizePiSearchRecords,
  PI_SEARCH_BUDGET_MESSAGE,
  PI_SEARCH_MAX_CALLS_PER_RUN,
  PI_SEARCH_PROMPT_GUIDELINES,
  PI_SEARCH_TIMEOUT_MS,
  PI_SEARCH_TOOL_DESCRIPTION,
  PI_SEARCH_TOOL_NAME,
  PI_SEARCH_TOOL_PARAMETERS,
  parsePiSearchArgs,
  serializePiSearchEnvelope,
} from '@/executor/handlers/pi/search/normalize'
import type { ExecutionContext } from '@/executor/types'
import { executeTool } from '@/tools'

const logger = createLogger('PiSearchTool')

/**
 * Parallel's `transformResponse` reports an absent `results` array as a failure, while Exa, Serper,
 * and Firecrawl all return success with an empty collection. Matching this one literal from
 * `tools/parallel/search.ts` keeps a benign empty search from reaching the agent as a tool error on
 * one provider out of four. `tool.test.ts` asserts the real tool still produces it, since drift here
 * would be silent.
 */
export const PARALLEL_EMPTY_RESULTS_ERROR = 'No results returned from search'

/**
 * Names the failure without quoting the provider. `executeTool` reports an HTTP status in
 * `output.status`, and Sim's own transport phrases a timeout as "Request timed out after Nms" — the
 * one `result.error` substring safe to branch on, since it is generated locally rather than derived
 * from the response.
 */
function describePiSearchFailure(label: string, status: unknown, error: unknown): string {
  if (status === 401 || status === 403) {
    return `${label} search was rejected as unauthorized. Check that the ${label} API key is valid and has search access.`
  }
  if (status === 429) {
    return `${label} search was rate limited. Wait before searching again or reduce how often you search.`
  }
  if (typeof status === 'number') {
    return `${label} search failed with HTTP ${status}.`
  }
  if (typeof error === 'string' && /timed out/i.test(error)) {
    return `${label} search timed out after ${PI_SEARCH_TIMEOUT_MS / 1_000} seconds. Try a narrower query.`
  }
  return `${label} search could not reach the provider.`
}

/**
 * Builds the search tool for a host-side run. The Pi mode is passed explicitly because
 * `ExecutionContext` does not carry it, and it is what makes a "search stopped working" report
 * attributable to one mode.
 */
export function buildPiSearchToolSpec(
  ctx: ExecutionContext,
  search: Pick<PiSearchConfig, 'provider' | 'apiKey' | 'keySource'>,
  mode: 'local' | 'cloud_review'
): PiToolSpec {
  const { label, toolId } = PI_SEARCH_PROVIDERS[search.provider]
  const logContext = {
    provider: search.provider,
    // A populated block field shadows a stored workspace key without a word anywhere else, so this
    // is what turns "search suddenly fails after switching providers" into a one-line diagnosis.
    keySource: search.keySource,
    mode,
    executionId: ctx.executionId,
  }

  // Per spec, i.e. per run: the handler builds one of these for each Pi execution.
  let calls = 0

  return {
    name: PI_SEARCH_TOOL_NAME,
    description: PI_SEARCH_TOOL_DESCRIPTION,
    parameters: PI_SEARCH_TOOL_PARAMETERS,
    promptGuidelines: PI_SEARCH_PROMPT_GUIDELINES,
    execute: async (args) => {
      const { query, numResults } = parsePiSearchArgs(args)

      calls += 1
      if (calls > PI_SEARCH_MAX_CALLS_PER_RUN) {
        logger.warn('Pi search budget exhausted', { ...logContext, calls })
        return { text: PI_SEARCH_BUDGET_MESSAGE, isError: true }
      }

      const result = await executeTool(
        toolId,
        {
          ...buildPiSearchProviderArgs(search.provider, { query, numResults }),
          apiKey: search.apiKey,
          // None of the four search tools declares a timeout, and the transport falls back to five
          // minutes without one — against ten seconds in the Create PR extension.
          timeout: PI_SEARCH_TIMEOUT_MS,
        },
        { executionContext: ctx }
      )

      if (!result.success) {
        if (result.error === PARALLEL_EMPTY_RESULTS_ERROR) {
          logger.info('Pi search returned no results', { ...logContext, resultCount: 0 })
          return { text: serializePiSearchEnvelope([]), isError: false }
        }

        const status = (result.output as { status?: unknown } | undefined)?.status
        logger.warn('Pi search failed', { ...logContext, status })
        return {
          // Classified rather than quoted: `result.error` can carry provider-response-derived text
          // for all four providers, which the untrusted-results guideline does not cover. Only the
          // shape of the failure is reported, so the agent is not told to check a valid key after a
          // timeout or a rate limit.
          text: describePiSearchFailure(label, status, result.error),
          isError: true,
        }
      }

      const results = normalizePiSearchRecords(
        search.provider,
        extractPiSearchRecords(search.provider, result.output),
        numResults
      )
      logger.info('Pi search completed', { ...logContext, resultCount: results.length })
      return { text: serializePiSearchEnvelope(results), isError: false }
    },
  }
}
