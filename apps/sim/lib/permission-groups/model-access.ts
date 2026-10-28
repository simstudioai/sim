import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import {
  findProviderFromModel,
  getModelSunsetStatus,
  isAutoModel,
  isCustomModelId,
  isKnownModelId,
} from '@/providers/models'

/** Decides whether the caller's permission group allows a concrete model id. */
export type IsModelUsable = (model: string) => boolean

/** Shared allow-everything gate, so the unrestricted case allocates nothing. */
const ALLOW_ALL_MODELS: IsModelUsable = () => true

/** The slice of a permission group the model gate reads. */
export type ModelGateConfig = Pick<PermissionGroupConfig, 'deniedModels' | 'allowedModelProviders'>

/**
 * The model gate for a resolved permission-group config: the `deniedModels`
 * denylist, then the `allowedModelProviders` allowlist.
 *
 * Only chat models resolve to a provider. A `model` field holding an embedding,
 * speech, image or video id is not a provider choice, so the provider allowlist
 * has nothing to say about it — judging it anyway would read every such id as
 * Ollama and reject it.
 */
export function createModelAccessGate(config: ModelGateConfig | null | undefined): IsModelUsable {
  const deniedModels = config?.deniedModels
  const allowedProviders = config?.allowedModelProviders ?? null
  if (!deniedModels?.length && allowedProviders === null) return ALLOW_ALL_MODELS

  const denied = new Set(deniedModels?.map((model) => model.toLowerCase()))
  return (model: string) => {
    const normalizedModel = model.toLowerCase()
    if (denied.has(normalizedModel) || denied.has(normalizedModel.replace(/^ollama\//, ''))) {
      return false
    }
    if (allowedProviders === null) return true
    const providerId = findProviderFromModel(model)
    if (!providerId) return true
    return allowedProviders.includes(providerId)
  }
}

/** Resolves a supported, available Agent default permitted by the group's model policy. */
export function resolveAgentDefaultModel(
  config: (ModelGateConfig & Pick<PermissionGroupConfig, 'defaultAgentModel'>) | null | undefined,
  options?: { allowAuto?: boolean; availableProviderIds?: readonly string[] }
): string | null {
  const model = config?.defaultAgentModel
  const provider = model ? findProviderFromModel(model) : null
  return model &&
    (isKnownModelId(model) ||
      isCustomModelId(model) ||
      (options?.allowAuto && isAutoModel(model))) &&
    getModelSunsetStatus(model) !== 'deprecated' &&
    (!provider ||
      !options?.availableProviderIds ||
      options.availableProviderIds.includes(provider)) &&
    createModelAccessGate(config)(model)
    ? model
    : null
}
