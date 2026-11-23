import models from '@/lib/media/fal-video-models.json'

/** Request settings one fal endpoint accepts. */
export interface FalVideoSettings {
  durations?: readonly (number | string)[]
  aspectRatios?: readonly string[]
  resolutions?: readonly string[]
  audioField?: string
  promptOptimizer?: boolean
  maxPromptLength?: number
  requestDefaults?: Readonly<Record<string, string>>
  maxDurationByResolution?: Readonly<Record<string, number>>
}

interface FalVideoModel extends FalVideoSettings {
  label: string
  /** Existing workflows store these model IDs instead of the fal endpoint. */
  legacyId?: string
  /** The same model's image-to-video endpoint, used when a start frame is attached. */
  image?: FalVideoSettings & { endpoint: string; imageField: string }
}

const catalog: Record<string, FalVideoModel> = models

/**
 * Prompt-to-video endpoints from fal's active text-to-video catalog and documented unlisted models.
 * A model must accept a prompt without media or a custom adapter and return a downloadable video.
 * `image` names the model's image-to-video sibling, which takes the same prompt plus a start frame.
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

/**
 * Resolves the endpoint and settings a request uses: the text-to-video endpoint for a prompt,
 * or the image-to-video sibling when a start frame is attached. Undefined when the model has no
 * endpoint for that input.
 */
export function getFalVideoVariant(
  id: unknown,
  withImage: boolean
): (FalVideoSettings & { endpoint: string; imageField?: string }) | undefined {
  const model = getFalVideoModel(id)
  if (!model) return undefined
  if (withImage) return model.image
  const { label, legacyId, image, modelId, ...settings } = model
  return settings
}
