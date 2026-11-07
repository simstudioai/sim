import { getErrorMessage } from '@sim/utils/errors'
import type { VideoGenerationInput } from '@/lib/internal/video/client'
import { assertNoCustomModelSettings, parseCustomModelId } from '@/lib/media/custom-model'
import { getFalVideoModel, getFalVideoVariant } from '@/lib/media/fal-video-catalog'

type FalAIDurationFormat = 'number' | 'seconds' | 'string'

interface FalAIModelConfig {
  endpoint: string
  /** Request field that carries the start frame on an image-to-video endpoint. */
  imageField?: string
  durationFormat?: FalAIDurationFormat
  durationOptions?: readonly number[]
  supportsAspectRatio?: boolean
  aspectRatioOptions?: readonly string[]
  supportsResolution?: boolean
  resolutionOptions?: readonly string[]
  supportsPromptOptimizer?: boolean
  audioField?: string
  requestDefaults?: Readonly<Record<string, string>>
  maxDurationByResolution?: Readonly<Record<string, number>>
  maxPromptLength?: number
  /** Typed endpoint path outside the catalog: sent with the prompt only. */
  custom?: boolean
}

const LEGACY_FALAI_MODELS: Record<string, FalAIModelConfig> = {
  'sora-2': {
    endpoint: 'fal-ai/sora-2/text-to-video',
    durationFormat: 'number',
    durationOptions: [4, 8, 12, 16, 20],
    supportsAspectRatio: true,
    aspectRatioOptions: ['16:9', '9:16'],
    supportsResolution: true,
    resolutionOptions: ['720p'],
  },
  'sora-2-pro': {
    endpoint: 'fal-ai/sora-2/text-to-video/pro',
    durationFormat: 'number',
    durationOptions: [4, 8, 12, 16, 20],
    supportsAspectRatio: true,
    aspectRatioOptions: ['16:9', '9:16'],
    supportsResolution: true,
    resolutionOptions: ['720p', '1080p', 'true_1080p'],
  },
  'kling-2.5-turbo-pro': {
    endpoint: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
    durationFormat: 'string',
    supportsAspectRatio: true,
    supportsResolution: true,
  },
  'kling-2.1-pro': {
    endpoint: 'fal-ai/kling-video/v2.1/master/text-to-video',
    durationFormat: 'string',
    supportsAspectRatio: true,
    supportsResolution: true,
  },
  'minimax-hailuo-02-pro': {
    endpoint: 'fal-ai/minimax/hailuo-02/pro/text-to-video',
    durationFormat: 'string',
    supportsAspectRatio: true,
    supportsResolution: true,
    supportsPromptOptimizer: true,
  },
  'minimax-hailuo-02-standard': {
    endpoint: 'fal-ai/minimax/hailuo-02/standard/text-to-video',
    durationFormat: 'string',
    supportsAspectRatio: true,
    supportsResolution: true,
    supportsPromptOptimizer: true,
  },
  'wan-2.1': {
    endpoint: 'fal-ai/wan-t2v',
  },
  'ltxv-0.9.8': {
    endpoint: 'fal-ai/ltxv-13b-098-distilled',
  },
}

/** A typed Fal endpoint path such as `fal-ai/some-model/text-to-video`, not a catalog model. */
export function isCustomFalVideoModel(id: string | undefined): boolean {
  return Boolean(
    id?.includes('/') && !getFalVideoModel(id) && !Object.hasOwn(LEGACY_FALAI_MODELS, id)
  )
}

/** Only catalog models with an image-to-video endpoint take a start frame. */
function getFalModelConfig(id: string, withImage: boolean): FalAIModelConfig | undefined {
  const model = getFalVideoVariant(id, withImage)
  if (!model) {
    if (withImage) return undefined
    if (Object.hasOwn(LEGACY_FALAI_MODELS, id)) return LEGACY_FALAI_MODELS[id]
    if (!isCustomFalVideoModel(id)) return undefined
    return { endpoint: parseCustomModelId(id, 'Fal.ai'), custom: true }
  }
  const sample = model.durations?.[0]
  return {
    endpoint: model.endpoint,
    imageField: model.imageField,
    durationFormat:
      sample === undefined
        ? undefined
        : typeof sample === 'number'
          ? 'number'
          : sample.endsWith('s')
            ? 'seconds'
            : 'string',
    durationOptions: model.durations?.map((duration) => Number.parseFloat(String(duration))),
    supportsAspectRatio: Boolean(model.aspectRatios),
    aspectRatioOptions: model.aspectRatios,
    supportsResolution: Boolean(model.resolutions),
    resolutionOptions: model.resolutions,
    supportsPromptOptimizer: model.promptOptimizer,
    audioField: model.audioField,
    requestDefaults: model.requestDefaults,
    maxDurationByResolution: model.maxDurationByResolution,
    maxPromptLength: model.maxPromptLength,
  }
}

function formatFalAIDuration(
  format: FalAIDurationFormat | undefined,
  duration: number | undefined
): string | number | undefined {
  if (!format || duration === undefined) return undefined

  if (format === 'number') return duration
  if (format === 'seconds') return `${duration}s`
  return String(duration)
}

function formatAllowedValues(allowed: readonly (number | string)[]): string {
  return allowed.map(String).join(', ')
}

export function getFalAIValidationError(input: VideoGenerationInput): string | undefined {
  const { model, prompt, duration, aspectRatio, resolution } = input
  if (!model) return 'Model is required for Fal.ai provider'
  const withImage = Boolean(input.visualReference)
  let modelConfig: FalAIModelConfig | undefined
  let promptOnlyConfig: FalAIModelConfig | undefined
  try {
    modelConfig = getFalModelConfig(model, withImage)
    if (!modelConfig && withImage) promptOnlyConfig = getFalModelConfig(model, false)
  } catch (error) {
    return getErrorMessage(error)
  }
  if (!modelConfig) {
    return promptOnlyConfig
      ? `Fal.ai model ${model} does not accept a start frame image`
      : `Unknown Fal.ai model: ${model}`
  }
  if (modelConfig.custom) {
    if (input.useHostedCostTracking)
      return `Custom Fal.ai endpoints need your own Fal.ai API key: ${model} is not a listed model`
    try {
      assertNoCustomModelSettings(model, {
        duration,
        aspectRatio,
        resolution,
        promptOptimizer: input.promptOptimizer,
        generateAudio: input.generateAudio,
      })
    } catch (error) {
      return getErrorMessage(error)
    }
  }

  if (modelConfig.maxPromptLength && prompt.length > modelConfig.maxPromptLength) {
    return `Prompt must be at most ${modelConfig.maxPromptLength} characters for ${model}`
  }
  if (
    duration !== undefined &&
    modelConfig.durationOptions &&
    !modelConfig.durationOptions.includes(duration)
  ) {
    return `Invalid duration for Fal.ai model ${model}. Supported durations: ${formatAllowedValues(modelConfig.durationOptions)}`
  }

  if (aspectRatio) {
    if (!modelConfig.supportsAspectRatio) {
      return `Fal.ai model ${model} does not support aspect ratio`
    }

    if (modelConfig.aspectRatioOptions && !modelConfig.aspectRatioOptions.includes(aspectRatio)) {
      return `Invalid aspect ratio for Fal.ai model ${model}. Supported aspect ratios: ${formatAllowedValues(modelConfig.aspectRatioOptions)}`
    }
  }

  if (resolution) {
    if (!modelConfig.supportsResolution) {
      return `Fal.ai model ${model} does not support resolution`
    }

    if (modelConfig.resolutionOptions && !modelConfig.resolutionOptions.includes(resolution)) {
      return `Invalid resolution for Fal.ai model ${model}. Supported resolutions: ${formatAllowedValues(modelConfig.resolutionOptions)}`
    }
  }

  const maxDuration = resolution ? modelConfig.maxDurationByResolution?.[resolution] : undefined
  if (duration !== undefined && maxDuration !== undefined && duration > maxDuration) {
    return `Fal.ai model ${model} supports up to ${maxDuration} seconds at ${resolution}`
  }

  return undefined
}

/**
 * Builds the provider request without submitting or billing a generation. With a start frame the
 * request targets the model's image-to-video endpoint, and the caller sets `imageField` to the image.
 */
export function buildFalVideoRequest(input: VideoGenerationInput) {
  const { model, prompt, duration, aspectRatio, resolution, promptOptimizer, generateAudio } = input
  const modelConfig = model ? getFalModelConfig(model, Boolean(input.visualReference)) : undefined
  if (!modelConfig) {
    throw new Error(`Unknown Fal.ai model: ${model}`)
  }

  const requestBody: Record<string, unknown> = { ...modelConfig.requestDefaults, prompt }
  const formattedDuration = formatFalAIDuration(modelConfig.durationFormat, duration)

  if (formattedDuration !== undefined) {
    requestBody.duration = formattedDuration
  }

  if (modelConfig.supportsAspectRatio && aspectRatio) {
    requestBody.aspect_ratio = aspectRatio
  }

  if (modelConfig.supportsResolution && resolution) {
    requestBody.resolution = resolution
  }

  if (modelConfig.supportsPromptOptimizer && promptOptimizer !== undefined) {
    requestBody.prompt_optimizer = promptOptimizer
  }

  if (modelConfig.audioField && generateAudio !== undefined) {
    requestBody[modelConfig.audioField] = generateAudio
  }

  return { endpoint: modelConfig.endpoint, imageField: modelConfig.imageField, body: requestBody }
}
