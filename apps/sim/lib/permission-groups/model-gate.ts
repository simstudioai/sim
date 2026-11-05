import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'

/** Decides whether the caller's permission group allows a concrete model id. */
export type IsModelUsable = (model: string) => boolean

/** Shared allow-everything gate, so the unrestricted case allocates nothing. */
const ALLOW_ALL_MODELS: IsModelUsable = () => true

/** The slice of a permission group the model gate reads. */
export type ModelGateConfig = Pick<PermissionGroupConfig, 'deniedModels' | 'allowedModelProviders'>

/**
 * What the gate needs to know about models. The server and the legacy client answer from the
 * provider registry; a surface without that registry answers from its server catalog projection.
 */
export interface ModelFacts {
  findProvider: (model: string) => string | null
  isKnown: (model: string) => boolean
  isCustom: (model: string) => boolean
  isAuto: (model: string) => boolean
  sunsetStatus: (model: string) => 'legacy' | 'deprecated' | undefined
}

/**
 * The model gate for a resolved permission-group config: the `deniedModels`
 * denylist, then the `allowedModelProviders` allowlist.
 *
 * Only chat models resolve to a provider. A `model` field holding an embedding,
 * speech, image or video id is not a provider choice, so the provider allowlist
 * has nothing to say about it — judging it anyway would read every such id as
 * Ollama and reject it.
 */
export function createModelGate(
  config: ModelGateConfig | null | undefined,
  findProvider: ModelFacts['findProvider']
): IsModelUsable {
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
    const providerId = findProvider(model)
    if (!providerId) return true
    return (allowedProviders as readonly string[]).includes(providerId)
  }
}

/** Resolves a supported, available Agent default permitted by the group's model policy. */
export function resolveAgentDefault(
  config: (ModelGateConfig & Pick<PermissionGroupConfig, 'defaultAgentModel'>) | null | undefined,
  options: { allowAuto?: boolean; availableProviderIds?: readonly string[] } | undefined,
  facts: ModelFacts
): string | null {
  const model = config?.defaultAgentModel
  const provider = model ? facts.findProvider(model) : null
  return model &&
    (facts.isKnown(model) ||
      facts.isCustom(model) ||
      (options?.allowAuto && facts.isAuto(model))) &&
    facts.sunsetStatus(model) !== 'deprecated' &&
    (!provider ||
      !options?.availableProviderIds ||
      options.availableProviderIds.includes(provider)) &&
    createModelGate(config, facts.findProvider)(model)
    ? model
    : null
}
