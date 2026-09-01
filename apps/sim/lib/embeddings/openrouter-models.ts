const OPENROUTER_MODEL_PREFIX = 'openrouter/'

export const DEFAULT_OPENROUTER_EMBEDDING_MODEL = 'openrouter/openai/text-embedding-3-small'

const LEGACY_OPENAI_EMBEDDING_MODELS = new Set([
  'text-embedding-3-small',
  'text-embedding-3-large',
  'text-embedding-ada-002',
])

function assertUpstreamModelId(model: string): string {
  if (!/^[^/\s]+\/[^\s]+$/.test(model)) {
    throw new Error(`Invalid OpenRouter embedding model: ${model}`)
  }
  return model
}

/** Converts an OpenRouter upstream model id into Sim's provider-prefixed id. */
export function toOpenRouterEmbeddingModelId(upstreamModel: string): string {
  return `${OPENROUTER_MODEL_PREFIX}${assertUpstreamModelId(upstreamModel)}`
}

/** Converts Sim's model id into the provider-qualified id OpenRouter accepts. */
export function toOpenRouterWireEmbeddingModelId(model: string): string {
  if (model.startsWith(OPENROUTER_MODEL_PREFIX)) {
    return assertUpstreamModelId(model.slice(OPENROUTER_MODEL_PREFIX.length))
  }
  if (LEGACY_OPENAI_EMBEDDING_MODELS.has(model)) {
    return `openai/${model}`
  }
  throw new Error(`Invalid OpenRouter embedding model: ${model}`)
}

/** Normalizes persisted OpenAI-only values to the dynamic OpenRouter id format. */
export function normalizeOpenRouterEmbeddingModelId(model: string): string {
  if (model.startsWith(OPENROUTER_MODEL_PREFIX)) {
    toOpenRouterWireEmbeddingModelId(model)
    return model
  }
  if (LEGACY_OPENAI_EMBEDDING_MODELS.has(model)) {
    return `${OPENROUTER_MODEL_PREFIX}openai/${model}`
  }
  throw new Error(`Invalid OpenRouter embedding model: ${model}`)
}
