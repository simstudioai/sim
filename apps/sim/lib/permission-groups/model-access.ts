import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import { findProviderFromModel } from '@/providers/utils'

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
    if (denied.has(model.toLowerCase())) return false
    if (allowedProviders === null) return true
    const providerId = findProviderFromModel(model)
    if (!providerId) return true
    return allowedProviders.includes(providerId)
  }
}
