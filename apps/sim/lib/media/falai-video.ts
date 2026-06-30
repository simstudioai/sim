import { isRecordLike } from '@sim/utils/object'
import {
  downloadFalMedia,
  extractFalMediaUrl,
  getFalApiKey,
  getNumberProp,
  runFalQueue,
} from '@/lib/media/falai'
import { type FalAICostMetadata, getFalAICostMetadata } from '@/lib/tools/falai-pricing'

type DurationFormat = 'number' | 'seconds' | 'string'

interface FalVideoModelConfig {
  endpoint: string
  /** Image-to-video endpoint variant, when the model supports a start-frame image. */
  i2vEndpoint?: string
  durationFormat?: DurationFormat
  supportsAspectRatio?: boolean
  supportsResolution?: boolean
  supportsGenerateAudio?: boolean
  supportsNegativePrompt?: boolean
  supportsPromptOptimizer?: boolean
}

// Endpoints mirror app/api/tools/video/route.ts (FALAI_MODEL_CONFIGS), scoped to
// the latest-gen models the generate_video tool exposes.
const VIDEO_MODELS: Record<string, FalVideoModelConfig> = {
  'veo-3.1': {
    endpoint: 'fal-ai/veo3.1',
    i2vEndpoint: 'fal-ai/veo3.1/image-to-video',
    durationFormat: 'seconds',
    supportsAspectRatio: true,
    supportsResolution: true,
    supportsGenerateAudio: true,
    supportsNegativePrompt: true,
  },
  'veo-3.1-fast': {
    endpoint: 'fal-ai/veo3.1/fast',
    i2vEndpoint: 'fal-ai/veo3.1/fast/image-to-video',
    durationFormat: 'seconds',
    supportsAspectRatio: true,
    supportsResolution: true,
    supportsGenerateAudio: true,
    supportsNegativePrompt: true,
  },
  'veo-3.1-lite': {
    endpoint: 'fal-ai/veo3.1/lite',
    i2vEndpoint: 'fal-ai/veo3.1/lite/image-to-video',
    durationFormat: 'seconds',
    supportsAspectRatio: true,
    supportsResolution: true,
    supportsGenerateAudio: true,
    supportsNegativePrompt: true,
  },
  'seedance-2.0': {
    endpoint: 'bytedance/seedance-2.0/text-to-video',
    i2vEndpoint: 'bytedance/seedance-2.0/image-to-video',
    durationFormat: 'string',
    supportsAspectRatio: true,
    supportsResolution: true,
    supportsGenerateAudio: true,
  },
  'seedance-2.0-fast': {
    endpoint: 'bytedance/seedance-2.0/fast/text-to-video',
    i2vEndpoint: 'bytedance/seedance-2.0/fast/image-to-video',
    durationFormat: 'string',
    supportsAspectRatio: true,
    supportsResolution: true,
    supportsGenerateAudio: true,
  },
  'kling-v3-pro': {
    endpoint: 'fal-ai/kling-video/v3/pro/text-to-video',
    i2vEndpoint: 'fal-ai/kling-video/v3/pro/image-to-video',
    durationFormat: 'string',
    supportsAspectRatio: true,
    supportsGenerateAudio: true,
  },
  'minimax-hailuo-2.3-pro': {
    endpoint: 'fal-ai/minimax/hailuo-2.3/pro/text-to-video',
    supportsPromptOptimizer: true,
  },
  'wan-2.2-a14b-turbo': {
    endpoint: 'fal-ai/wan/v2.2-a14b/text-to-video/turbo',
    supportsAspectRatio: true,
    supportsResolution: true,
  },
  'ltx-2.3': {
    endpoint: 'fal-ai/ltx-2.3/text-to-video',
    durationFormat: 'number',
    supportsAspectRatio: true,
    supportsResolution: true,
    supportsGenerateAudio: true,
  },
}

// Default to Veo 3.1 Fast: the same Veo model family — good 1080p video with native
// 48kHz audio + lip-sync — at ~1/3 the cost of Standard (~$0.15/s vs ~$0.40/s). The
// gap is surface detail / 4K, not "good vs bad". The agent overrides to veo-3.1
// (Standard) only when the user explicitly asks for very high / premium quality.
export const DEFAULT_VIDEO_MODEL = 'veo-3.1-fast'

export interface GenerateFalVideoParams {
  prompt: string
  model?: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  generateAudio?: boolean
  /** Things to exclude from the generation, e.g. "no background music" (Veo models). */
  negativePrompt?: string
  promptOptimizer?: boolean
  /** Optional start-frame image as a data URI; when set, routes to the model's image-to-video endpoint. */
  imageDataUri?: string
}

export interface GeneratedVideo {
  buffer: Buffer
  contentType: string
  width?: number
  height?: number
  model: string
  endpoint: string
  jobId: string
  cost: FalAICostMetadata
}

function formatDuration(
  format: DurationFormat | undefined,
  duration?: number
): string | number | undefined {
  if (!format || duration === undefined) return undefined
  if (format === 'number') return duration
  if (format === 'seconds') return `${duration}s`
  return String(duration)
}

export async function generateFalVideo(params: GenerateFalVideoParams): Promise<GeneratedVideo> {
  const model = params.model || DEFAULT_VIDEO_MODEL
  const config = VIDEO_MODELS[model]
  if (!config) {
    throw new Error(
      `Unknown video model: ${model}. Supported: ${Object.keys(VIDEO_MODELS).join(', ')}`
    )
  }

  const apiKey = getFalApiKey()

  let endpoint = config.endpoint
  const input: Record<string, unknown> = { prompt: params.prompt }

  if (params.imageDataUri) {
    if (!config.i2vEndpoint) {
      throw new Error(
        `Image-to-video is not supported for model ${model}. Try veo-3.1, veo-3.1-fast, seedance-2.0, or kling-v3-pro.`
      )
    }
    endpoint = config.i2vEndpoint
    input.image_url = params.imageDataUri
  }

  const duration = formatDuration(config.durationFormat, params.duration)
  if (duration !== undefined) input.duration = duration
  if (config.supportsAspectRatio && params.aspectRatio) input.aspect_ratio = params.aspectRatio
  if (config.supportsResolution && params.resolution) input.resolution = params.resolution
  if (config.supportsGenerateAudio && params.generateAudio !== undefined) {
    input.generate_audio = params.generateAudio
  }
  if (config.supportsNegativePrompt && params.negativePrompt) {
    input.negative_prompt = params.negativePrompt
  }
  if (config.supportsPromptOptimizer && params.promptOptimizer !== undefined) {
    input.prompt_optimizer = params.promptOptimizer
  }

  const { requestId, data } = await runFalQueue(endpoint, input, apiKey)
  const url = extractFalMediaUrl(data, ['video', 'output'])
  if (!url) throw new Error('No video URL in Fal.ai response')

  const videoNode = isRecordLike(data.video) ? data.video : undefined
  const { buffer, contentType } = await downloadFalMedia(url)
  const cost = await getFalAICostMetadata({ apiKey, endpointId: endpoint, requestId })

  return {
    buffer,
    contentType: contentType.startsWith('video/') ? contentType : 'video/mp4',
    width: getNumberProp(videoNode, 'width'),
    height: getNumberProp(videoNode, 'height'),
    model,
    endpoint,
    jobId: requestId,
    cost,
  }
}
