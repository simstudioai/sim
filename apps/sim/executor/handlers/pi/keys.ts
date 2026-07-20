/**
 * Model, provider-key, and cost resolution shared by Pi backends. Local mode
 * mirrors the Agent block — keys resolve through `getApiKeyWithBYOK`, so a
 * Sim-hosted key may be used and billed. Cloud Code Review has the same
 * host-side key boundary. Cloud PR alone requires the user's own key (the
 * block's API Key field, or a stored workspace BYOK key) because that mode runs
 * the model client in an untrusted sandbox. Cost uses the billing multiplier and
 * is zeroed for BYOK / non-billable models.
 */

import type { CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent'
import { getApiKeyWithBYOK, getBYOKKey } from '@/lib/api-key/byok'
import { getCostMultiplier } from '@/lib/core/config/env-flags'
import { isPiSupportedProvider, type PiSupportedProvider } from '@/providers/pi-providers'
import { calculateCost, shouldBillModelUsage } from '@/providers/utils'

/** Resolved provider key and BYOK flag for a Pi run. */
interface PiKeyResolution {
  apiKey: string
  isBYOK: boolean
}

type PiKeyMode = 'cloud' | 'cloud_review' | 'local'

interface ResolvePiModelKeyParams {
  providerId: PiSupportedProvider
  model: string
  mode: PiKeyMode
  workspaceId?: string
  apiKey?: string
}

/** Providers whose key Sim can store as a workspace BYOK key (read back for cloud). */
const WORKSPACE_BYOK_PROVIDER_IDS = ['anthropic', 'openai', 'google', 'mistral', 'xai'] as const

type WorkspaceByokProvider = (typeof WORKSPACE_BYOK_PROVIDER_IDS)[number]

function isWorkspaceByokProvider(providerId: string): providerId is WorkspaceByokProvider {
  return WORKSPACE_BYOK_PROVIDER_IDS.some((candidate) => candidate === providerId)
}

/** Resolves a usable API key for an already validated provider/model pair. */
export async function resolvePiModelKey(params: ResolvePiModelKeyParams): Promise<PiKeyResolution> {
  const { providerId } = params

  if (params.mode === 'cloud') {
    if (params.apiKey) {
      return { apiKey: params.apiKey, isBYOK: true }
    }
    if (params.workspaceId && isWorkspaceByokProvider(providerId)) {
      const byok = await getBYOKKey(params.workspaceId, providerId)
      if (byok) {
        return { apiKey: byok.apiKey, isBYOK: true }
      }
    }
    throw new Error(
      isWorkspaceByokProvider(providerId)
        ? 'Cloud mode requires your own provider API key (BYOK). Enter it in the API Key field, or store one in Settings > BYOK.'
        : 'Cloud mode requires your own provider API key (BYOK). Enter it in the API Key field.'
    )
  }

  if (params.mode === 'cloud_review' && params.apiKey) {
    return { apiKey: params.apiKey, isBYOK: true }
  }

  const { apiKey, isBYOK } = await getApiKeyWithBYOK(
    providerId,
    params.model,
    params.workspaceId,
    params.apiKey
  )
  return { apiKey, isBYOK }
}

/** Run cost, zeroed for BYOK keys and models Sim does not bill. */
export function computePiCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  isBYOK: boolean
) {
  if (isBYOK || !shouldBillModelUsage(model)) {
    return { input: 0, output: 0, total: 0 }
  }
  const multiplier = getCostMultiplier()
  return calculateCost(model, inputTokens, outputTokens, false, multiplier, multiplier)
}

/**
 * Env var the Pi CLI reads each provider's key from in the cloud sandbox. Keyed
 * by {@link PiSupportedProvider}, so this map and the shared support set (which
 * also drives the block's model dropdown) cannot drift — adding a provider to the
 * set forces adding its env var here.
 */
const PROVIDER_API_KEY_ENV_VARS: Record<PiSupportedProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  xai: 'XAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}

/**
 * Env var name a provider's API key is exposed under for the Pi CLI in the cloud
 * sandbox, or `null` when Pi cannot run the provider via a single key. The cloud
 * backend rejects `null` providers with a clear error rather than guessing.
 */
export function providerApiKeyEnvVar(providerId: string): string | null {
  return isPiSupportedProvider(providerId) ? PROVIDER_API_KEY_ENV_VARS[providerId] : null
}

/** Maps a Sim thinking level to Pi's `ThinkingLevel` (shared by both backends). */
export function mapThinkingLevel(level?: string): CreateAgentSessionOptions['thinkingLevel'] {
  if (!level || level === 'none') return 'off'
  if (level === 'max') return 'xhigh'
  if (level === 'low' || level === 'medium' || level === 'high') return level
  return undefined
}
