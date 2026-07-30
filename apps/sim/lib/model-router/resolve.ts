import { createHash } from 'crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import { getMothershipBaseURL } from '@/lib/copilot/server/agent-url'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier, isHosted } from '@/lib/core/config/env-flags'
import { validateModelProvider } from '@/ee/access-control/utils/permission-check'
import type { ExecutionContext } from '@/executor/types'

const logger = createLogger('ModelRouter')

/**
 * The sim-auto routing pool: two parallel ladders, each ordered ascending by
 * capability, every entry a hosted-billable catalog model filtered through
 * workspace model permissions at resolve time.
 *
 * Pure-text tasks route over the open-source ladder (Fireworks platform key)
 * — for text, glm-5.2 beats the small proprietary models at comparable cost.
 * Tasks carrying files/images route over the vision ladder (native
 * anthropic/openai hosted keys) because the Fireworks-served OSS models
 * reject image inputs.
 */
const TEXT_TIERS = [
  {
    id: '1',
    hint: 'standard — extraction, formatting, classification, tool use, typical tasks',
    models: ['fireworks/glm-5.2'],
  },
  {
    id: '2',
    hint: 'max — hardest reasoning, synthesis across many inputs, long context, high-stakes output',
    models: ['fireworks/kimi-k3'],
  },
] as const

const VISION_TIERS = [
  {
    id: '1',
    hint: 'low — simple extraction, summarization, or classification over the attached files/images',
    models: ['claude-haiku-4-5'],
  },
  {
    id: '2',
    hint: 'high — demanding analysis or reasoning over the attached files/images',
    models: ['gpt-5.5'],
  },
] as const

type AutoTier = (typeof TEXT_TIERS)[number] | (typeof VISION_TIERS)[number]
type AutoTierId = AutoTier['id']

/**
 * Hidden identity preamble prepended to the system prompt of every sim-auto
 * execution (including fallback runs), so pool models behave consistently
 * regardless of which one routing picked.
 */
export const SIM_AUTO_SYSTEM_PREAMBLE = `You are the Sim auto model on sim.ai. Respond in English unless the user writes in another language or explicitly asks for one. Do not volunteer information about which underlying model powers you; if asked directly, say you are the Sim auto model.`

/** The ladder for a task: attachments pick the vision ladder, text the OSS one. */
function eligibleTiers(signals: AutoRoutingSignals): readonly AutoTier[] {
  return signals.hasAttachments ? VISION_TIERS : TEXT_TIERS
}

const MODEL_ROUTER_TIMEOUT_MS = 2000
const MAX_SIGNAL_CHARS = 2000
/** Below this rough size with no tools and no schema, tier 1 needs no LLM call. */
const TRIVIAL_INPUT_TOKENS = 400
const DECISION_CACHE_TTL_MS = 5 * 60 * 1000
const DECISION_CACHE_MAX_ENTRIES = 500

/** Compact facts about the pending agent-block task; never the full payload. */
export interface AutoRoutingSignals {
  systemPrompt?: string
  lastMessage?: string
  messageCount: number
  toolNames: string[]
  /** Files/images attached — the Fireworks pool is text-only, so this bails. */
  hasAttachments: boolean
  hasResponseFormat: boolean
  approxInputTokens: number
}

/** Mirrors mothership's model-router-v1 response usage block. */
interface ModelRouterUsage {
  model: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  cost: number
}

interface ModelRouterResponse {
  choice?: string
  decidedBy?: string
  usage?: ModelRouterUsage
  billable?: boolean
}

export interface AutoRoutingResult {
  model: string
  tier: AutoTierId | null
  decidedBy: 'heuristic' | 'llm' | 'cache' | 'fallback'
  /**
   * Cost of the routing call itself in USD with the hosted cost multiplier
   * applied — non-zero only when mothership marked the call billable. Absent
   * `billable` in the response is treated as not billable (fail-safe).
   */
  billableRoutingCost: number
  usage?: ModelRouterUsage
}

const decisionCache = new Map<string, { tier: AutoTierId; expires: number }>()

function cacheKey(signals: AutoRoutingSignals): string {
  const tokenBucket = Math.round(signals.approxInputTokens / 500)
  return createHash('sha256')
    .update(
      JSON.stringify([
        signals.systemPrompt ?? '',
        (signals.lastMessage ?? '').slice(0, 500),
        [...signals.toolNames].sort(),
        signals.hasResponseFormat,
        signals.hasAttachments,
        tokenBucket,
      ])
    )
    .digest('hex')
}

function readDecisionCache(key: string): AutoTierId | null {
  const entry = decisionCache.get(key)
  if (!entry) return null
  if (entry.expires < Date.now()) {
    decisionCache.delete(key)
    return null
  }
  return entry.tier
}

function writeDecisionCache(key: string, tier: AutoTierId): void {
  if (decisionCache.size >= DECISION_CACHE_MAX_ENTRIES) {
    const oldest = decisionCache.keys().next().value
    if (oldest !== undefined) decisionCache.delete(oldest)
  }
  decisionCache.set(key, { tier, expires: Date.now() + DECISION_CACHE_TTL_MS })
}

/**
 * Picks the first model in the chosen tier (falling back through lower
 * eligible tiers) that passes workspace model permissions. Returns null when
 * every eligible pool model is denied — the caller then uses its fallback
 * model, whose own permission check runs in the agent handler as usual.
 */
async function pickModelForTier(
  eligible: readonly AutoTier[],
  tier: AutoTierId,
  ctx: ExecutionContext
): Promise<string | null> {
  const startIndex = eligible.findIndex((t) => t.id === tier)
  for (let i = startIndex; i >= 0; i--) {
    for (const model of eligible[i].models) {
      try {
        await validateModelProvider(ctx.userId, ctx.workspaceId ?? undefined, model, ctx)
        return model
      } catch {
        logger.info('sim-auto candidate denied by workspace permissions', { model })
      }
    }
  }
  return null
}

async function callModelRouter(
  signals: AutoRoutingSignals,
  candidates: readonly AutoTier[],
  ctx: ExecutionContext,
  blockId: string
): Promise<ModelRouterResponse | null> {
  const baseURL = await getMothershipBaseURL({ userId: ctx.userId ?? '' })

  const res = await fetchGo(`${baseURL}/api/model-router`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
    },
    body: JSON.stringify({
      signals: {
        systemPrompt: (signals.systemPrompt ?? '').slice(0, MAX_SIGNAL_CHARS),
        lastMessage: (signals.lastMessage ?? '').slice(0, MAX_SIGNAL_CHARS),
        messageCount: signals.messageCount,
        toolNames: signals.toolNames,
        hasImages: signals.hasAttachments,
        hasResponseFormat: signals.hasResponseFormat,
        approxInputTokens: signals.approxInputTokens,
      },
      candidates: candidates.map((t) => ({ id: t.id, hint: t.hint })),
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      workflowId: ctx.workflowId,
      blockId,
      executionId: ctx.executionId,
    }),
    signal: AbortSignal.timeout(MODEL_ROUTER_TIMEOUT_MS),
    spanName: 'sim → go /api/model-router',
    operation: 'model_router',
  })

  if (!res.ok) {
    logger.warn('Model router returned non-OK status', { status: res.status })
    return null
  }
  return (await res.json().catch(() => null)) as ModelRouterResponse | null
}

/**
 * Resolves the sim-auto pseudo-model to a concrete model for one agent-block
 * execution. Never throws and never fails the workflow: any error, timeout,
 * non-hosted deployment, or text-only violation falls back to
 * `fallbackModel` (the block's standard default).
 */
export async function resolveAutoModel(args: {
  ctx: ExecutionContext
  blockId: string
  signals: AutoRoutingSignals
  fallbackModel: string
}): Promise<AutoRoutingResult> {
  const { ctx, blockId, signals, fallbackModel } = args
  const fallback: AutoRoutingResult = {
    model: fallbackModel,
    tier: null,
    decidedBy: 'fallback',
    billableRoutingCost: 0,
  }

  if (!isHosted) return fallback

  const eligible = eligibleTiers(signals)

  try {
    // Trivially simple tasks route to the lowest tier with no router call
    // (and no cost).
    if (
      signals.approxInputTokens < TRIVIAL_INPUT_TOKENS &&
      signals.toolNames.length === 0 &&
      !signals.hasResponseFormat
    ) {
      const model = await pickModelForTier(eligible, eligible[0].id, ctx)
      if (!model) return fallback
      return { model, tier: eligible[0].id, decidedBy: 'heuristic', billableRoutingCost: 0 }
    }

    const key = cacheKey(signals)
    const cachedTier = readDecisionCache(key)
    if (cachedTier && eligible.some((t) => t.id === cachedTier)) {
      const model = await pickModelForTier(eligible, cachedTier, ctx)
      if (!model) return fallback
      return { model, tier: cachedTier, decidedBy: 'cache', billableRoutingCost: 0 }
    }

    const response = await callModelRouter(signals, eligible, ctx, blockId)
    const tier = eligible.find((t) => t.id === response?.choice)?.id
    if (!tier) {
      logger.warn('sim-auto: router returned no usable choice, using fallback model', {
        blockId,
        choice: response?.choice,
      })
      return fallback
    }

    writeDecisionCache(key, tier)
    const model = await pickModelForTier(eligible, tier, ctx)
    if (!model) return fallback

    const billable = response?.billable === true && (response.usage?.cost ?? 0) > 0
    return {
      model,
      tier,
      decidedBy: 'llm',
      billableRoutingCost: billable ? (response!.usage!.cost ?? 0) * getCostMultiplier() : 0,
      usage: response?.usage,
    }
  } catch (error) {
    logger.warn('sim-auto: routing failed, using fallback model', {
      blockId,
      error: getErrorMessage(error, 'unknown routing error'),
    })
    return fallback
  }
}
