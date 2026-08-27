import { parseList } from '@/tools/tinyfish/utils'
import type { ToolHostingConfig } from '@/tools/types'

/** Env var prefix for TinyFish hosted keys. One key serves every TinyFish surface. */
export const TINYFISH_API_KEY_PREFIX = 'TINYFISH_API_KEY'

/**
 * Dollar cost of a single TinyFish Agent step.
 *
 * TinyFish bills the Agent product per step from a prepaid wallet — there are
 * no plan tiers, so this rate is the same for every hosted key.
 *
 * Source: https://www.tinyfish.ai/pricing
 */
export const TINYFISH_AGENT_STEP_USD = 0.016

/**
 * Hosting config for the synchronous Agent run.
 *
 * The run response reports `num_of_steps`, which is the exact unit TinyFish
 * bills on, so the charge always comes from what the API reported rather than
 * an estimate.
 *
 * Two limits of this config are deliberate and worth knowing before raising it:
 *
 * - TinyFish's real Agent ceiling is 2 concurrent runs per account, and the
 *   token bucket has no concurrency dimension. `requestsPerMinute` is a
 *   proxy, not an equivalent: a synchronous run lasts minutes, so five per
 *   minute already permits more in-flight runs than the account allows. The
 *   value is kept low for that reason, but hitting the account ceiling
 *   surfaces as a TinyFish 429 rather than a Sim-side wait.
 * - Sim meters only successful executions, so a run that ends `FAILED` is
 *   unbilled even though TinyFish charged the hosted wallet for every step it
 *   took. Closing that needs a change to the executor's success gate, not to
 *   this pricing function.
 */
export function tinyfishAgentHosting<P>(): ToolHostingConfig<P> {
  return {
    envKeyPrefix: TINYFISH_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'tinyfish',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        const reported = output.numOfSteps
        if (reported == null) {
          throw new Error('TinyFish run response missing num_of_steps')
        }

        const numOfSteps = Number(reported)
        if (!Number.isFinite(numOfSteps)) {
          throw new Error('TinyFish run response returned a non-numeric num_of_steps')
        }

        return {
          cost: numOfSteps * TINYFISH_AGENT_STEP_USD,
          metadata: { steps: numOfSteps },
        }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 5,
    },
  }
}

/**
 * Hosting config for the Search API.
 *
 * Search never draws on the TinyFish wallet, so the hosted key costs nothing to
 * run. The documented ceiling is 30 requests/minute per account, so a key pool
 * only raises the total when each key belongs to a separate TinyFish account.
 * Each workspace therefore gets a third of one account's budget.
 *
 * Source: https://www.tinyfish.ai/pricing
 */
export function tinyfishSearchHosting<P>(): ToolHostingConfig<P> {
  return {
    envKeyPrefix: TINYFISH_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'tinyfish',
    pricing: {
      type: 'per_request',
      cost: 0,
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 10,
    },
  }
}

/**
 * Hosting config for the Fetch API.
 *
 * Fetch is free but its documented ceiling is measured in URLs (150/minute), not
 * requests, and one request carries up to 10 URLs. The URL count is therefore
 * tracked as its own dimension so a workspace batching 10 URLs per call is
 * throttled on the same axis TinyFish enforces. Usage is read from the submitted
 * list rather than the returned arrays, because TinyFish counts a URL it could
 * not fetch and the response would undercount one that landed in neither array.
 *
 * The 40/minute per-workspace share of the 150/minute account ceiling leaves room
 * for roughly three workspaces to run flat out on one key.
 *
 * Source: https://www.tinyfish.ai/pricing
 */
export function tinyfishFetchHosting<P>(): ToolHostingConfig<P> {
  return {
    envKeyPrefix: TINYFISH_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'tinyfish',
    pricing: {
      type: 'per_request',
      cost: 0,
    },
    rateLimit: {
      mode: 'custom',
      requestsPerMinute: 10,
      dimensions: [
        {
          name: 'urls',
          limitPerMinute: 40,
          extractUsage: (params) => parseList(params.urls as string | string[] | undefined).length,
        },
      ],
    },
  }
}
