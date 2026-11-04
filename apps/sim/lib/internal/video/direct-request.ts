import { isRecordLike } from '@sim/utils/object'
import type { VideoGenerationInput } from '@/lib/internal/video/client'
import { getDirectVideoModel } from '@/lib/media/direct-video-catalog'

/** Validates provider-specific choices before creating a paid video generation job. */
export function buildDirectVideoRequest(input: VideoGenerationInput) {
  const model = getDirectVideoModel(input.provider, input.model, Boolean(input.visualReference))
  if (!model) {
    if (input.provider === 'veo')
      throw new Error('Google Veo has retired from the Gemini API. Select Gemini Omni 1.1 Flash.')
    throw new Error(`Unknown ${input.provider} video model: ${input.model}`)
  }
  const spec = model.settings
  if (!spec)
    throw new Error(
      `${model.label} ${input.visualReference ? 'does not accept a reference image' : 'requires a reference image'}`
    )
  const maxLength = spec.maxPromptLength ?? 2000
  if (input.prompt.length < 3 || input.prompt.length > maxLength)
    throw new Error(`Prompt must be between 3 and ${maxLength} characters for ${model.label}`)
  let aspectRatio = input.aspectRatio
  let resolution = input.resolution
  if (
    model.protocol === 'runway' &&
    aspectRatio &&
    ['16:9', '9:16', '1:1'].includes(aspectRatio) &&
    !spec.aspectRatios?.includes(aspectRatio)
  ) {
    const legacy: Record<string, string> = {
      '16:9': '1280:720',
      '9:16': '720:1280',
      '1:1': '960:960',
    }
    aspectRatio = legacy[aspectRatio]
    // Older workflows stored a resolution even though Runway only sent a pixel ratio.
    resolution = undefined
  }
  if (
    model.protocol === 'minimax-v1' &&
    !resolution &&
    input.endpoint === 'pro' &&
    spec.resolutions?.includes('1080P') &&
    (input.duration ?? 6) === 6
  )
    resolution = '1080P'
  for (const [key, value, allowed] of [
    ['duration', input.duration, spec.durations],
    ['aspectRatio', aspectRatio, spec.aspectRatios],
    ['resolution', resolution, spec.resolutions],
  ] as const) {
    if (value === undefined || value === '') continue
    if (!allowed?.some((item) => item === value))
      throw new Error(`Invalid ${key} for ${model.label}: ${value}`)
  }
  if (input.generateAudio !== undefined && !spec.audio)
    throw new Error(`${model.label} does not support an audio toggle`)
  if (input.promptOptimizer !== undefined && !spec.promptOptimizer)
    throw new Error(`${model.label} does not support prompt optimization settings`)
  if (model.protocol === 'minimax-v1' && resolution === '1080P' && (input.duration ?? 6) !== 6)
    throw new Error('MiniMax 1080P requires a 6 second duration')
  if (input.cameraControl && model.protocol !== 'luma-legacy')
    throw new Error(
      `${model.label} does not support camera controls; describe camera motion in the prompt`
    )

  const concepts = input.cameraControl
    ? typeof input.cameraControl === 'string'
      ? [{ key: input.cameraControl }]
      : input.cameraControl
    : undefined
  if (
    concepts !== undefined &&
    (!Array.isArray(concepts) ||
      concepts.some(
        (item) => !isRecordLike(item) || typeof item.key !== 'string' || !item.key.trim()
      ))
  ) {
    throw new Error('Camera controls must be an array of concept keys')
  }

  const settings: Record<string, string | number | boolean> = { ...spec.defaults }
  if (input.duration !== undefined) settings.duration = input.duration
  if (resolution) settings.resolution = resolution
  let url: string
  let body: Record<string, unknown>
  switch (model.protocol) {
    case 'runway':
      if (aspectRatio) settings.ratio = aspectRatio
      if (input.generateAudio !== undefined) settings.audio = input.generateAudio
      url = `https://api.dev.runwayml.com/v1/${input.visualReference ? 'image_to_video' : 'text_to_video'}`
      body = { model: model.id, promptText: input.prompt, ...settings }
      break
    case 'gemini':
      url = 'https://generativelanguage.googleapis.com/v1beta/interactions'
      body = {
        model: model.id,
        input: input.prompt,
        background: true,
        response_format: {
          type: 'video',
          delivery: 'uri',
          ...(aspectRatio && { aspect_ratio: aspectRatio }),
          ...(resolution && { resolution }),
        },
      }
      break
    case 'luma':
    case 'luma-legacy': {
      const ratio = aspectRatio || settings.aspect_ratio
      const video = { duration: `${settings.duration}s`, resolution: settings.resolution }
      url =
        model.protocol === 'luma'
          ? 'https://agents.lumalabs.ai/v1/generations'
          : 'https://api.lumalabs.ai/dream-machine/v1/generations/video'
      body = {
        model: model.id,
        prompt: input.prompt,
        aspect_ratio: ratio,
        ...(model.protocol === 'luma' ? { type: 'video', video } : { ...video, loop: false }),
        ...(concepts && { concepts }),
      }
      break
    }
    case 'minimax-v2':
      if (aspectRatio) settings.ratio = aspectRatio
      url = 'https://api.minimax.io/v2/video_generation'
      body = { model: model.id, content: [{ type: 'text', text: input.prompt }], ...settings }
      break
    case 'minimax-v1':
      url = 'https://api.minimax.io/v1/video_generation'
      body = {
        model:
          model.id === 'hailuo-02'
            ? 'MiniMax-Hailuo-02'
            : model.id === 'hailuo-2.3'
              ? 'MiniMax-Hailuo-2.3'
              : model.id,
        prompt: input.prompt,
        ...settings,
        prompt_optimizer: input.promptOptimizer !== false,
      }
      break
  }
  return { model, url, body }
}
