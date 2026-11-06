/**
 * Pseudo-model id for the agent block's automatic model. Not a real catalog
 * entry: at execution time the resolver (lib/model-router) classifies the task
 * via mothership and swaps in a concrete model from the hosted Fireworks pool
 * before any provider/pricing lookup runs. Hosted Sim only.
 */
export const SIM_AUTO_MODEL_ID = 'sim-auto'

export function isAutoModel(model: string): boolean {
  return model.trim().toLowerCase() === SIM_AUTO_MODEL_ID
}

/** The parts of a provider definition that decide which provider a model id belongs to. */
interface ProviderModelMatcher {
  models: ReadonlyArray<{ id: string }>
  modelPatterns?: readonly RegExp[]
}

/**
 * The provider a model id belongs to. Explicit provider namespaces take precedence over names
 * discovered on a local server, then an exact catalog entry, then a family pattern. Free of the
 * provider registry, so a surface holding only its projection answers by the same rule.
 */
export function findProviderForModel(
  providers: ReadonlyArray<readonly [string, ProviderModelMatcher]>,
  namespacedProviders: ReadonlySet<string>,
  model: string
): string | null {
  const normalizedModel = model.toLowerCase()

  for (const [providerId, provider] of providers) {
    if (
      namespacedProviders.has(providerId) &&
      provider.modelPatterns?.some((pattern) => pattern.test(normalizedModel))
    ) {
      return providerId
    }
  }

  for (const [providerId, provider] of providers) {
    if (
      provider.models.some((providerModel) => providerModel.id.toLowerCase() === normalizedModel)
    ) {
      return providerId
    }
  }

  for (const [providerId, provider] of providers) {
    if (provider.modelPatterns?.some((pattern) => pattern.test(normalizedModel))) {
      return providerId
    }
  }

  return null
}

/** Whether a model id is in the static catalog, or names a model under a dynamic provider. */
export function isKnownModelIn(
  staticModelIds: ReadonlySet<string>,
  dynamicProviders: readonly string[],
  modelId: string
): boolean {
  if (!modelId || typeof modelId !== 'string') return false
  const trimmed = modelId.trim()
  if (!trimmed) return false

  if (staticModelIds.has(trimmed.toLowerCase())) return true

  const lowered = trimmed.toLowerCase()
  for (const provider of dynamicProviders) {
    if (lowered.startsWith(`${provider}/`) && lowered.slice(provider.length + 1).trim()) return true
  }

  return false
}

/** Recognized provider namespaces accept deployment and model IDs outside the static catalog. */
export function isCustomModelIn(
  findProvider: (model: string) => string | null,
  namespacedProviders: ReadonlySet<string>,
  modelId: string
): boolean {
  const separator = modelId.indexOf('/')
  if (separator < 1 || modelId.slice(separator + 1).trim().length === 0) return false

  const providerId = findProvider(modelId)
  return providerId !== null && namespacedProviders.has(providerId)
}
