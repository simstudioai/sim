import type { ImageGenerationInput, ImageProvider } from '@/lib/internal/image/schema'
import { assertNoCustomModelSettings, parseCustomModelId } from '@/lib/media/custom-model'
import { HIGGSFIELD_API_BASE } from '@/lib/media/higgsfield'
import {
  getImageModel,
  imageModelDefaults,
  imageModels,
  imageOptionFields,
} from '@/lib/media/image-catalog'

/** Sim limits image prompts independently of larger provider model allowances. */
const MAX_IMAGE_PROMPT_CHARACTERS = 4000

type ImageModel = NonNullable<ReturnType<typeof getImageModel>>

const IMAGE_PROVIDER_LABELS: Record<ImageProvider, string> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  falai: 'Fal.ai',
  higgsfield: 'Higgsfield',
}

/** OpenAI image models that older blocks still store; they keep failing as retired. */
const RETIRED_IMAGE_MODELS = new Set(['openai:dall-e-3', 'openai:gpt-image-1'])

/** Resolves a catalog model, or a model ID typed in place of one. */
function resolveImageModel(input: ImageGenerationInput): ImageModel {
  const provider = input.provider as ImageProvider
  const id = input.model || imageModelDefaults[provider]
  const model = getImageModel(provider, id)
  if (model) return model
  const retiredError = new Error(`Unknown or retired ${provider} image model: ${input.model}`)
  if (!input.model || RETIRED_IMAGE_MODELS.has(`${provider}:${input.model}`)) throw retiredError
  // Endpoint paths are left alone: Fal.ai and Higgsfield both name models by vendor path.
  const owner = input.model.includes('/')
    ? undefined
    : imageModels.find(
        (candidate) =>
          candidate.provider !== provider &&
          (candidate.id === input.model || candidate.aliases?.includes(input.model ?? ''))
      )
  if (owner) {
    const ownerLabel = IMAGE_PROVIDER_LABELS[owner.provider]
    throw new Error(`${input.model} is a ${ownerLabel} model. Select ${ownerLabel} as the provider`)
  }
  const customId = parseCustomModelId(input.model, IMAGE_PROVIDER_LABELS[provider])
  if (provider === 'falai') {
    if (!customId.includes('/')) throw retiredError
    if (input.useHostedCostTracking)
      throw new Error(
        `Custom Fal.ai endpoints need your own Fal.ai API key: ${customId} is not a listed model`
      )
  }
  assertNoCustomModelSettings(customId, {
    ...Object.fromEntries(imageOptionFields.map((key) => [key, input[key]])),
    seed: input.seed,
    enableSafetyChecker: input.enableSafetyChecker,
    enableWebSearch: input.enableWebSearch,
  })
  return {
    provider,
    id: customId,
    label: customId,
    endpoint: customId,
    requestDefaults: provider === 'openai' ? { n: 1 } : undefined,
  }
}

/** Builds only supported settings for the selected image model before a paid request is sent. */
export function buildImageGenerationRequest(input: ImageGenerationInput) {
  const model = resolveImageModel(input)
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
  } else if (model.provider === 'higgsfield') {
    endpoint = `${HIGGSFIELD_API_BASE}/${model.endpoint}`
    body = { prompt: input.prompt, ...settings }
  } else {
    endpoint = `https://queue.fal.run/${model.endpoint}`
    body = { prompt: input.prompt, ...settings }
  }
  return { model, endpoint, body }
}
