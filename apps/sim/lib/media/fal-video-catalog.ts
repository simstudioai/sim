import models from '@/lib/media/fal-video-models.json'

interface FalVideoModel {
  label: string
  /** Existing workflows store these model IDs instead of the fal endpoint. */
  legacyId?: string
  durations?: readonly (number | string)[]
  aspectRatios?: readonly string[]
  resolutions?: readonly string[]
  audioField?: string
  promptOptimizer?: boolean
  maxPromptLength?: number
  requestDefaults?: Readonly<Record<string, string>>
  maxDurationByResolution?: Readonly<Record<string, number>>
}

const catalog: Record<string, FalVideoModel> = models

/**
 * Prompt-to-video endpoints from fal's active text-to-video catalog and documented unlisted models.
 * A model must accept a prompt without media or a custom adapter and return a downloadable video.
 * Validate catalog updates with `apps/sim/scripts/validate-fal-video-models.ts`.
 */
export const falVideoModels = Object.entries(catalog).map(([endpoint, spec]) => ({
  ...spec,
  endpoint,
  modelId: spec.legacyId ?? endpoint,
}))

const byId = new Map(falVideoModels.map((model) => [model.endpoint, model]))
for (const model of falVideoModels) {
  if (model.legacyId) byId.set(model.legacyId, model)
}

export function getFalVideoModel(id: unknown) {
  return typeof id === 'string' ? byId.get(id) : undefined
}
