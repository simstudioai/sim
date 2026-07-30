/**
 * Model, provider-key, and cost resolution shared by Pi backends. Local Dev
 * mirrors the Agent block — keys resolve through `getApiKeyWithBYOK`, so a
 * Sim-hosted key may be used and billed. Review Code has the same host-side key
 * boundary. Create PR alone requires the user's own key (the
 * block's API Key field, or a stored workspace BYOK key) because that mode runs
 * the model client in an untrusted sandbox. Cost uses the billing multiplier and
 * is zeroed for BYOK / non-billable models.
 *
 * Optional web search is keyed separately and more strictly: the block field or a
 * stored workspace key, never a Sim-hosted one, in every mode.
 */

import type { CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent'
import { getApiKeyWithBYOK, getBYOKKey } from '@/lib/api-key/byok'
import { calculateBillableModelCost } from '@/providers/cost-policy'
import type { PiSupportedProvider } from '@/providers/pi-provider-configs'
import {
  getPiProviderApiKeyEnvVar,
  getPiWorkspaceBYOKProviderId,
  isPiByokOnlyMode,
  isPiSupportedProvider,
} from '@/providers/pi-providers'

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

  if (isPiByokOnlyMode(params.mode)) {
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

interface PiSearchProviderConfig {
  /** User-facing name, used in setup errors and the review prompt. */
  label: string
  /** Sim tool the host-side adapter executes; also the id checked against workspace tool denylists. */
  toolId: string
}

/** The search providers the Pi block offers, keyed by the `searchProvider` field value. */
export const PI_SEARCH_PROVIDERS = {
  exa: { label: 'Exa', toolId: 'exa_search' },
  serper: { label: 'Serper', toolId: 'serper_search' },
  parallel: { label: 'Parallel AI', toolId: 'parallel_search' },
  firecrawl: { label: 'Firecrawl', toolId: 'firecrawl_search' },
} as const satisfies Record<string, PiSearchProviderConfig>

export type PiSearchProvider = keyof typeof PI_SEARCH_PROVIDERS

/**
 * Resolves the `searchProvider` field, distinguishing absent from invalid.
 *
 * Absent must mean `'none'`: the serializer never injects a subBlock `defaultValue`, so every Pi
 * block saved before this field existed arrives without it, and treating that as "search on" would
 * fail those runs. An unrecognized non-empty value throws instead of silently disabling search, so
 * a renamed or mis-cased provider id is not a run where the agent quietly never searches.
 */
export function parsePiSearchProvider(value: unknown): PiSearchProvider | 'none' {
  if (value === undefined || value === null) return 'none'
  const raw = typeof value === 'string' ? value.trim() : String(value)
  if (!raw || raw === 'none') return 'none'
  if (Object.hasOwn(PI_SEARCH_PROVIDERS, raw)) return raw as PiSearchProvider
  throw new Error(
    `Invalid Pi search provider: ${raw}. Use one of none, ${Object.keys(PI_SEARCH_PROVIDERS).join(', ')}.`
  )
}

/**
 * Resolves the search key from the block's Search API Key field, which is the only source.
 *
 * Deliberately no workspace BYOK fallback, and never a Sim-hosted key. Unlike the model key, the
 * Search API Key field is shown on every deployment — its visibility depends only on whether a
 * provider is selected — so there is no configuration where the field is unavailable and a fallback
 * would be needed. Reading a stored workspace key here would instead mean a member who cannot
 * otherwise see that credential (the BYOK API only ever returns it masked, and only admins may
 * manage it) could route it into the Create PR sandbox, where the agent holds bash and can read the
 * environment. Requiring the key on the block keeps that exposure something the block's author
 * opted into with a key they already hold.
 *
 * Trimmed, with a blank treated as absent: `executeTool` only skips hosted-key injection for a key
 * with `trim().length > 0`, so a whitespace-only value would otherwise fall through to a rotating
 * Sim-owned key on hosted deployments.
 */
export function resolvePiSearchKey(params: {
  provider: PiSearchProvider
  apiKey?: string
}): string {
  const { label } = PI_SEARCH_PROVIDERS[params.provider]

  const fieldKey = params.apiKey?.trim()
  if (fieldKey) return fieldKey

  throw new Error(
    `${label} search requires your own ${label} API key. Enter it in the block's Search API Key field.`
  )
}

/** Run cost, zeroed for BYOK keys and models Sim does not bill. */
export function computePiCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  isBYOK: boolean
) {
  return calculateBillableModelCost(model, inputTokens, outputTokens, { isBYOK })
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
