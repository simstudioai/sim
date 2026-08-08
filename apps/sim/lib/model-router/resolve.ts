import { createHash } from 'crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import { getMothershipBaseURL } from '@/lib/copilot/server/agent-url'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier, isHosted } from '@/lib/core/config/env-flags'
import { validateModelProvider } from '@/ee/access-control/utils/permission-check'
import type { ExecutionContext } from '@/executor/types'
import type { ModelCost } from '@/providers/cost-policy'
import { getProviderFromModel } from '@/providers/utils'

const logger = createLogger('ModelRouter')

/**
 * The difficulty scale the classifier chooses from. These are the ONLY routing
 * facts that cross the wire — the router never sees a model name, so the pool
 * below can change without touching mothership.
 */
const TIERS = [
  {
    id: '1',
    hint: 'low — short mechanical work: extraction, formatting, classification, simple lookups',
  },
  {
    id: '2',
    hint: 'standard — typical multi-step work: tool use, drafting, moderate reasoning over the inputs',
  },
  {
    id: '3',
    hint: 'max — hardest reasoning, synthesis across many inputs, long context, high-stakes output',
  },
] as const

type AutoTier = (typeof TIERS)[number]
type AutoTierId = AutoTier['id']

/**
 * What the task attaches. Capability, not difficulty: it decides which models
 * can serve a tier at all, so it is resolved on Sim's side and never asked of
 * the classifier.
 */
export type AutoMediaKind = 'none' | 'image' | 'file'

/**
 * The sim-auto pool: media kind → tier → candidate models, ordered by
 * preference. Every entry is a hosted-billable catalog model, filtered through
 * the deployment blacklist and workspace model permissions at resolve time.
 *
 * Text and pure-image tasks ride the Fireworks OSS models on the platform key
 * — glm-5.2 beats the small proprietary models per dollar, and kimi-k3 is
 * natively multimodal (text + `image_url` parts only; the Fireworks chat API
 * models no other content part, and glm-5.2 rejects images outright).
 * Anything else attached — PDFs, audio, video, text documents — must ride the
 * native providers, which are the only ones that accept those parts.
 */
const POOL: Record<AutoMediaKind, Record<AutoTierId, readonly string[]>> = {
  none: {
    '1': ['fireworks/glm-5.2'],
    '2': ['fireworks/glm-5.2'],
    '3': ['fireworks/kimi-k3'],
  },
  image: {
    '1': ['gemini-3.6-flash'],
    '2': ['fireworks/kimi-k3'],
    '3': ['fireworks/kimi-k3'],
  },
  file: {
    '1': ['gemini-3.6-flash'],
    '2': ['claude-sonnet-5'],
    '3': ['gpt-5.6-sol'],
  },
}

/**
 * Hidden identity preamble prepended to the system prompt of every sim-auto
 * execution (including fallback runs), so pool models behave consistently
 * regardless of which one routing picked.
 */
export const SIM_AUTO_SYSTEM_PREAMBLE = `You are the Sim auto model on sim.ai. Respond in English unless the user writes in another language or explicitly asks for one. Do not volunteer information about which underlying model powers you; if asked directly, say you are the Sim auto model.`

const MODEL_ROUTER_TIMEOUT_MS = 2000
const MAX_SIGNAL_CHARS = 2000
const DECISION_CACHE_TTL_MS = 5 * 60 * 1000
const DECISION_CACHE_MAX_ENTRIES = 500

/** Compact facts about the pending LLM-backed block task; never the full payload. */
export interface AutoRoutingSignals {
  systemPrompt?: string
  lastMessage?: string
  messageCount: number
  toolNames: string[]
  /**
   * What the task attaches, which selects the pool column. Only its presence
   * (`!== 'none'`) is sent to the router as `hasMedia`: the classifier picks a
   * difficulty tier, and Sim owns which model can actually serve it.
   */
  mediaKind: AutoMediaKind
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
  decidedBy: 'llm' | 'cache' | 'fallback'
  /**
   * Cost of the routing call itself in USD with the hosted cost multiplier
   * applied — non-zero only when mothership marked the call billable. Absent
   * `billable` in the response is treated as not billable (fail-safe).
   */
  billableRoutingCost: number
  usage?: ModelRouterUsage
}

export type AutoRoutedModelCost = ModelCost & { routing?: number }

/** Adds a successful sim-auto classifier call to a settled provider cost. */
export function addAutoRoutingCost(cost: ModelCost, routingCost: number): AutoRoutedModelCost {
  if (routingCost <= 0) return cost

  return {
    ...cost,
    routing: routingCost,
    total: cost.total + routingCost,
  }
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
        signals.mediaKind,
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
 * Picks the first model of the chosen tier — then of each lower tier for the
 * same media kind — that is actually usable: its provider resolves and is not
 * blacklisted by the deployment, and it passes workspace model permissions.
 * Never crosses into another media kind's column, so a text-only model can
 * never be handed an image. Returns null when nothing in the column is usable
 * and the caller falls back.
 */
async function pickModelForTier(
  mediaKind: AutoMediaKind,
  tier: AutoTierId,
  ctx: ExecutionContext
): Promise<string | null> {
  const startIndex = TIERS.findIndex((t) => t.id === tier)
  const tried = new Set<string>()

  for (let i = startIndex; i >= 0; i--) {
    for (const model of POOL[mediaKind][TIERS[i].id]) {
      // Tiers may share a model; a second permission round-trip buys nothing.
      if (tried.has(model)) continue
      tried.add(model)
      try {
        // Throws when the provider or model is blacklisted, which would
        // otherwise surface as a hard block failure after resolution.
        getProviderFromModel(model)
        await validateModelProvider(ctx.userId, ctx.workspaceId ?? undefined, model, ctx)
        return model
      } catch {
        logger.info('sim-auto candidate unavailable, trying the next one', {
          model,
        })
      }
    }
  }
  return null
}

async function callModelRouter(
  signals: AutoRoutingSignals,
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
        hasMedia: signals.mediaKind !== 'none',
        hasResponseFormat: signals.hasResponseFormat,
        approxInputTokens: signals.approxInputTokens,
      },
      candidates: TIERS.map((t) => ({ id: t.id, hint: t.hint })),
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
 * Resolves the sim-auto pseudo-model to a concrete model for one block
 * execution. Never throws and never fails the workflow: any error, timeout,
 * non-hosted deployment, or fully unavailable pool column falls back to
 * `fallbackModel` (the block's standard default). Callers must supply the same already-projected
 * model-facing signals they pass to their provider boundary; this router never rescans them.
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

  try {
    // Every execution is classified: a short prompt is not a simple task, and
    // a local size rule can only ever route DOWN, which is the expensive
    // mistake. The cache below replays a prior router decision, never a
    // locally derived one.
    const key = cacheKey(signals)
    const cachedTier = readDecisionCache(key)
    if (cachedTier) {
      const model = await pickModelForTier(signals.mediaKind, cachedTier, ctx)
      if (!model) return fallback
      return {
        model,
        tier: cachedTier,
        decidedBy: 'cache',
        billableRoutingCost: 0,
      }
    }

    const response = await callModelRouter(signals, ctx, blockId)
    const tier = TIERS.find((t) => t.id === response?.choice)?.id
    if (!tier) {
      logger.warn('sim-auto: router returned no usable choice, using fallback model', {
        blockId,
        choice: response?.choice,
      })
      return fallback
    }

    writeDecisionCache(key, tier)
    const model = await pickModelForTier(signals.mediaKind, tier, ctx)
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
