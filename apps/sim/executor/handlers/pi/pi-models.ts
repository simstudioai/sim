/**
 * Server-side bridge between Sim model IDs and Pi's installed catalog. It stays
 * outside `providers/pi-providers` because that provider-only module is also
 * imported by the block UI and must not pull Pi's server package into the
 * browser bundle.
 */

import { getModels } from '@earendil-works/pi-ai/base'
import { isPiSupportedProvider, PI_SUPPORTED_PROVIDER_IDS } from '@/providers/pi-providers'

const PI_SUPPORTED_MODEL_IDS = new Map(
  PI_SUPPORTED_PROVIDER_IDS.map((providerId) => [
    providerId,
    new Set(getModels(providerId).map((model) => model.id)),
  ])
)

/** Returns the exact provider-relative ID declared by Pi for a Sim catalog model. */
export function resolvePiModelId(providerId: string, modelId: string): string | undefined {
  if (!isPiSupportedProvider(providerId)) return undefined
  const modelIds = PI_SUPPORTED_MODEL_IDS.get(providerId)
  if (modelIds?.has(modelId)) return modelId

  const providerPrefix = `${providerId}/`
  if (modelId.startsWith(providerPrefix)) {
    const providerRelativeId = modelId.slice(providerPrefix.length)
    if (modelIds?.has(providerRelativeId)) return providerRelativeId
  }

  return undefined
}
