import {
  createModelGate,
  type IsModelUsable,
  type ModelFacts,
  type ModelGateConfig,
  resolveAgentDefault,
} from '@/lib/permission-groups/model-gate'
import {
  findProviderFromModel,
  getModelSunsetStatus,
  isAutoModel,
  isCustomModelId,
  isKnownModelId,
} from '@/providers/models'

export type { IsModelUsable, ModelGateConfig }

/** The model facts as the provider registry states them. */
export const REGISTRY_MODEL_FACTS: ModelFacts = {
  findProvider: (model) => findProviderFromModel(model),
  isKnown: (model) => isKnownModelId(model),
  isCustom: (model) => isCustomModelId(model),
  isAuto: (model) => isAutoModel(model),
  sunsetStatus: (model) => getModelSunsetStatus(model),
}

/** See {@link createModelGate}, answered from the provider registry. */
export function createModelAccessGate(config: ModelGateConfig | null | undefined): IsModelUsable {
  return createModelGate(config, REGISTRY_MODEL_FACTS.findProvider)
}

/** See {@link resolveAgentDefault}, answered from the provider registry. */
export function resolveAgentDefaultModel(
  config: Parameters<typeof resolveAgentDefault>[0],
  options?: Parameters<typeof resolveAgentDefault>[1]
): string | null {
  return resolveAgentDefault(config, options, REGISTRY_MODEL_FACTS)
}
