/**
 * Model, provider-key, and cost resolution shared by Pi backends. Local Dev
 * mirrors the Agent block — keys resolve through `getApiKeyWithBYOK`, so a
 * Sim-hosted key may be used and billed. Review Code has the same host-side key
 * boundary. Create PR alone requires the user's own key (the
 * block's API Key field, or a stored workspace BYOK key) because that mode runs
 * the model client in an untrusted sandbox. Cost uses the billing multiplier and
 * is zeroed for BYOK / non-billable models.
 */

import type { CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent'
import { getApiKeyWithBYOK, getBYOKKey } from '@/lib/api-key/byok'
import { getCostMultiplier } from '@/lib/core/config/env-flags'
import type { PiSupportedProvider } from '@/providers/pi-provider-configs'
import {
  getPiProviderApiKeyEnvVar,
  getPiWorkspaceBYOKProviderId,
  isPiSupportedProvider,
} from '@/providers/pi-providers'
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

/** Resolves a usable API key for an already validated provider/model pair. */
export async function resolvePiModelKey(params: ResolvePiModelKeyParams): Promise<PiKeyResolution> {
  const { providerId } = params

  if (params.apiKey) {
    return { apiKey: params.apiKey, isBYOK: true }
  }

  if (params.mode === 'cloud') {
    const workspaceBYOKProviderId = getPiWorkspaceBYOKProviderId(providerId)
    if (params.workspaceId && workspaceBYOKProviderId) {
      const byok = await getBYOKKey(params.workspaceId, workspaceBYOKProviderId)
      if (byok) {
        return { apiKey: byok.apiKey, isBYOK: true }
      }
    }
    throw new Error(
      workspaceBYOKProviderId
        ? 'Create PR requires your own provider API key (BYOK). Enter it in the API Key field, or store one in Settings > BYOK.'
        : 'Create PR requires your own provider API key (BYOK). Enter it in the API Key field.'
    )
  }

  const { apiKey, isBYOK } = await getApiKeyWithBYOK(
    providerId,
    params.model,
    params.workspaceId,
    undefined
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
 * Env var name a provider's API key is exposed under for the Pi CLI in the cloud
 * sandbox, or `null` when Pi cannot run the provider via a single key. The cloud
 * backend rejects `null` providers with a clear error rather than guessing.
 */
export function providerApiKeyEnvVar(providerId: string): string | null {
  return isPiSupportedProvider(providerId) ? getPiProviderApiKeyEnvVar(providerId) : null
}

/** Maps a Sim thinking level to Pi's `ThinkingLevel` (shared by both backends). */
export function mapThinkingLevel(level?: string): CreateAgentSessionOptions['thinkingLevel'] {
  if (!level || level === 'none') return 'off'
  if (level === 'max') return 'xhigh'
  if (level === 'low' || level === 'medium' || level === 'high') return level
  return undefined
}
