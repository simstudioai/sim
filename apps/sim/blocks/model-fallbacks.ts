import { MAX_FALLBACK_MODELS } from '@/lib/workflows/blocks/fallback-models'
import type { SubBlockConfig } from '@/blocks/types'

const DESCRIPTION = `Ordered models tried once each when the selected model's request fails; with Retry on fail, after its tries run out. Each row is { model, apiKey?, reasoningEffort?, thinkingLevel?, verbosity? }. API keys must be whole {{ENV_VAR}} references and apply only when the row asks for a key. Tuning must be supported by the row model. sim-auto is not allowed. Max ${MAX_FALLBACK_MODELS}.`

/** Shared advanced field for blocks that execute model requests. */
export function getModelFallbackSubBlock(): SubBlockConfig {
  return {
    id: 'fallbackModels',
    title: 'Fallback models',
    type: 'model-fallback-list',
    mode: 'advanced',
    description: DESCRIPTION,
  }
}

export const MODEL_FALLBACK_INPUTS = {
  fallbackModels: { type: 'json', description: DESCRIPTION },
} as const
