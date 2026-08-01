import { PI_MODEL_IDS_BY_PROVIDER } from '@/providers/pi-model-catalog.generated'
import {
  PI_PROVIDER_CONFIGS,
  type PiProviderConfig,
  type PiSupportedProvider,
} from '@/providers/pi-provider-configs'
import type { BYOKProviderId } from '@/tools/types'

/**
 * Shared provider and model bridge for the Pi model picker, executor, host SDK,
 * and E2B CLI.
 */
export const PI_SUPPORTED_PROVIDER_IDS: readonly PiSupportedProvider[] = PI_PROVIDER_CONFIGS.map(
  ({ id }) => id
)

const PI_PROVIDER_CONFIG_BY_ID = new Map<string, PiProviderConfig>(
  PI_PROVIDER_CONFIGS.map((config) => [config.id, config])
)

const PI_MODEL_IDS_BY_PROVIDER_ID = new Map<PiSupportedProvider, ReadonlySet<string>>(
  PI_PROVIDER_CONFIGS.map(({ id }) => [id, new Set(PI_MODEL_IDS_BY_PROVIDER[id])])
)

/** Whether Sim can run the provider through Pi's single-key flow. */
export function isPiSupportedProvider(providerId: string): providerId is PiSupportedProvider {
  return PI_PROVIDER_CONFIG_BY_ID.has(providerId)
}

/**
 * Whether a Pi block mode hands the model API key into the sandbox and
 * therefore always requires the user's own key. Create PR ('cloud') and Update
 * PR ('cloud_branch') run the model client inside the sandbox, so Sim never
 * supplies a hosted key for them: the block always shows the API Key field,
 * copilot validation never strips it, and execution requires BYOK. Review Code
 * and Local Dev keep the model client in Sim and follow the normal hosted-key
 * rules. All three enforcement sites (block condition, edit-workflow
 * validation, key resolution) consume this predicate so they cannot drift.
 */
export function isPiByokOnlyMode(mode: unknown): boolean {
  return mode === 'cloud' || mode === 'cloud_branch'
}

/** Returns Pi's provider ID for a supported Sim provider. */
export function getPiProviderId(providerId: PiSupportedProvider): PiProviderConfig['piProviderId'] {
  const config = PI_PROVIDER_CONFIG_BY_ID.get(providerId)
  if (!config) throw new Error(`Pi provider configuration is missing for "${providerId}"`)
  return config.piProviderId
}

/** Returns the environment variable consumed by Pi's CLI for a supported provider. */
export function getPiProviderApiKeyEnvVar(
  providerId: PiSupportedProvider
): PiProviderConfig['apiKeyEnvVar'] {
  const config = PI_PROVIDER_CONFIG_BY_ID.get(providerId)
  if (!config) throw new Error(`Pi provider configuration is missing for "${providerId}"`)
  return config.apiKeyEnvVar
}

/** Returns the stored workspace-key provider supported by this Pi provider. */
export function getPiWorkspaceBYOKProviderId(
  providerId: PiSupportedProvider
): BYOKProviderId | undefined {
  return PI_PROVIDER_CONFIG_BY_ID.get(providerId)?.workspaceBYOKProviderId
}

/**
 * Resolves a Sim model ID to the exact provider-relative ID in Pi's pinned
 * catalog. Sim prefixes model IDs for providers whose native IDs overlap; Pi
 * sometimes keeps that prefix (NVIDIA) and sometimes does not (Groq), so exact
 * IDs are checked before removing the Sim provider prefix.
 */
export function resolvePiModelId(providerId: string, modelId: string): string | undefined {
  if (!isPiSupportedProvider(providerId)) return undefined
  const modelIds = PI_MODEL_IDS_BY_PROVIDER_ID.get(providerId)
  if (modelIds?.has(modelId)) return modelId

  const providerPrefix = `${providerId}/`
  if (!modelId.startsWith(providerPrefix)) return undefined

  const providerRelativeId = modelId.slice(providerPrefix.length)
  return modelIds?.has(providerRelativeId) ? providerRelativeId : undefined
}

/** Whether the provider/model pair exists in Pi's pinned catalog. */
export function isPiSupportedModel(providerId: string, modelId: string): boolean {
  return resolvePiModelId(providerId, modelId) !== undefined
}
