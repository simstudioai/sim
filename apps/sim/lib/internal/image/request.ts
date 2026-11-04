import type { ImageGenerationInput, ImageProvider } from '@/lib/internal/image/schema'
import { getImageModel, imageModelDefaults, imageOptionFields } from '@/lib/media/image-catalog'

/** Sim limits image prompts independently of larger provider model allowances. */
const MAX_IMAGE_PROMPT_CHARACTERS = 4000

/** Builds only supported settings for the selected image model before a paid request is sent. */
export function buildImageGenerationRequest(input: ImageGenerationInput) {
  const model = getImageModel(
    input.provider,
    input.model || imageModelDefaults[input.provider as ImageProvider]
  )
  if (!model) throw new Error(`Unknown or retired ${input.provider} image model: ${input.model}`)
  if (input.numImages !== undefined && input.numImages !== 1) {
    throw new Error('Image generation returns one image per tool execution; numImages must be 1')
  }
  const minLength = Math.max(3, model.minPromptLength ?? 3)
  const maxLength = Math.min(
    MAX_IMAGE_PROMPT_CHARACTERS,
    model.maxPromptLength ?? MAX_IMAGE_PROMPT_CHARACTERS
  )
  if (input.prompt.length < minLength || input.prompt.length > maxLength) {
    throw new Error(
      `Prompt must be between ${minLength} and ${maxLength} characters for ${model.label}`
    )
  }

  const settings: Record<string, string | number | boolean> = { ...model.requestDefaults }
  for (const key of imageOptionFields) {
    const value = input[key]
    if (value === undefined || value === '' || value === 'default') continue
    const option = model.options?.[key]
    if (!option) throw new Error(`${model.label} does not support ${key}`)
    const nativeValue = option.values.find((item) => String(item) === value)
    if (nativeValue === undefined) throw new Error(`Invalid ${key} for ${model.label}: ${value}`)
    settings[option.field] = nativeValue
  }
  if (input.background === 'transparent' && input.outputFormat === 'jpeg') {
    throw new Error('Transparent backgrounds require PNG or WebP output')
  }
  for (const key of ['enableSafetyChecker', 'enableWebSearch'] as const) {
    if (input[key] === undefined) continue
    const field = model.booleans?.[key]
    if (!field) throw new Error(`${model.label} does not support ${key}`)
    settings[field] = input[key]
  }
  if (input.seed !== undefined) {
    if (!model.seed) throw new Error(`${model.label} does not support seed`)
    settings.seed = input.seed
  }

  let endpoint: string
  let body: Record<string, unknown>
  if (model.provider === 'openai') {
    endpoint = 'https://api.openai.com/v1/images/generations'
    body = { model: model.id, prompt: input.prompt, ...settings }
  } else if (model.provider === 'gemini') {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`
    body = {
      contents: [{ parts: [{ text: input.prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: settings },
    }
  } else {
    endpoint = `https://queue.fal.run/${model.endpoint}`
    body = { prompt: input.prompt, ...settings }
  }
  return { model, endpoint, body }
}
