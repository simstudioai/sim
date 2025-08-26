import { AGENT_MODE_SYSTEM_PROMPT } from '@/lib/copilot/prompts'
import { createLogger } from '@/lib/logs/console/logger'
import { getProviderDefaultModel } from '@/providers/models'
import type { ProviderId } from '@/providers/types'

const logger = createLogger('CopilotConfig')

/**
 * Valid provider IDs for validation
 */
const VALID_PROVIDER_IDS: readonly ProviderId[] = [
  'openai',
  'azure-openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'cerebras',
  'groq',
  'ollama',
] as const

/**
 * Configuration validation constraints
 */
const VALIDATION_CONSTRAINTS = {
  temperature: { min: 0, max: 2 },
  maxTokens: { min: 1, max: 100000 },
  maxSources: { min: 1, max: 20 },
  similarityThreshold: { min: 0, max: 1 },
  maxConversationHistory: { min: 1, max: 50 },
} as const

/**
 * Copilot model types
 */
export type CopilotModelType = 'chat' | 'rag' | 'title'

/**
 * Configuration validation result
 */
export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

/**
 * Copilot configuration interface
 */
export interface CopilotConfig {
  // Chat LLM configuration
  chat: {
    defaultProvider: ProviderId
    defaultModel: string
    temperature: number
    maxTokens: number
    systemPrompt: string
  }
  // RAG (documentation search) LLM configuration
  rag: {
    defaultProvider: ProviderId
    defaultModel: string
    temperature: number
    maxTokens: number
    embeddingModel: string
    maxSources: number
    similarityThreshold: number
  }
  // General configuration
  general: {
    streamingEnabled: boolean
    maxConversationHistory: number
    titleGenerationModel: string
  }
}

function validateProviderId(value: string | undefined): ProviderId | null {
  if (!value) return null
  return VALID_PROVIDER_IDS.includes(value as ProviderId) ? (value as ProviderId) : null
}

function parseFloatEnv(value: string | undefined, name: string): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  if (Number.isNaN(parsed)) {
    logger.warn(`Invalid ${name}: ${value}. Expected a valid number.`)
    return null
  }
  return parsed
}

function parseIntEnv(value: string | undefined, name: string): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    logger.warn(`Invalid ${name}: ${value}. Expected a valid integer.`)
    return null
  }
  return parsed
}

function parseBooleanEnv(value: string | undefined): boolean | null {
  if (!value) return null
  return value.toLowerCase() === 'true'
}

export const DEFAULT_COPILOT_CONFIG: CopilotConfig = {
  chat: {
    defaultProvider: 'anthropic',
    defaultModel: 'claude-3-7-sonnet-latest',
    temperature: 0.1,
    maxTokens: 8192,
    systemPrompt: AGENT_MODE_SYSTEM_PROMPT,
  },
  rag: {
    defaultProvider: 'anthropic',
    defaultModel: 'claude-3-7-sonnet-latest',
    temperature: 0.1,
    maxTokens: 2000,
    embeddingModel: 'text-embedding-3-small',
    maxSources: 10,
    similarityThreshold: 0.3,
  },
  general: {
    streamingEnabled: true,
    maxConversationHistory: 10,
    titleGenerationModel: 'claude-3-haiku-20240307',
  },
}

function applyEnvironmentOverrides(config: CopilotConfig): void {
  const chatProvider = validateProviderId(process.env.COPILOT_CHAT_PROVIDER)
  if (chatProvider) {
    config.chat.defaultProvider = chatProvider
  } else if (process.env.COPILOT_CHAT_PROVIDER) {
    logger.warn(
      `Invalid COPILOT_CHAT_PROVIDER: ${process.env.COPILOT_CHAT_PROVIDER}. Valid providers: ${VALID_PROVIDER_IDS.join(', ')}`
    )
  }

  if (process.env.COPILOT_CHAT_MODEL) {
    config.chat.defaultModel = process.env.COPILOT_CHAT_MODEL
  }

  const chatTemperature = parseFloatEnv(
    process.env.COPILOT_CHAT_TEMPERATURE,
    'COPILOT_CHAT_TEMPERATURE'
  )
  if (chatTemperature !== null) {
    config.chat.temperature = chatTemperature
  }

  const chatMaxTokens = parseIntEnv(process.env.COPILOT_CHAT_MAX_TOKENS, 'COPILOT_CHAT_MAX_TOKENS')
  if (chatMaxTokens !== null) {
    config.chat.maxTokens = chatMaxTokens
  }

  const ragProvider = validateProviderId(process.env.COPILOT_RAG_PROVIDER)
  if (ragProvider) {
    config.rag.defaultProvider = ragProvider
  } else if (process.env.COPILOT_RAG_PROVIDER) {
    logger.warn(
      `Invalid COPILOT_RAG_PROVIDER: ${process.env.COPILOT_RAG_PROVIDER}. Valid providers: ${VALID_PROVIDER_IDS.join(', ')}`
    )
  }

  if (process.env.COPILOT_RAG_MODEL) {
    config.rag.defaultModel = process.env.COPILOT_RAG_MODEL
  }

  const ragTemperature = parseFloatEnv(
    process.env.COPILOT_RAG_TEMPERATURE,
    'COPILOT_RAG_TEMPERATURE'
  )
  if (ragTemperature !== null) {
    config.rag.temperature = ragTemperature
  }

  const ragMaxTokens = parseIntEnv(process.env.COPILOT_RAG_MAX_TOKENS, 'COPILOT_RAG_MAX_TOKENS')
  if (ragMaxTokens !== null) {
    config.rag.maxTokens = ragMaxTokens
  }

  const ragMaxSources = parseIntEnv(process.env.COPILOT_RAG_MAX_SOURCES, 'COPILOT_RAG_MAX_SOURCES')
  if (ragMaxSources !== null) {
    config.rag.maxSources = ragMaxSources
  }

  const ragSimilarityThreshold = parseFloatEnv(
    process.env.COPILOT_RAG_SIMILARITY_THRESHOLD,
    'COPILOT_RAG_SIMILARITY_THRESHOLD'
  )
  if (ragSimilarityThreshold !== null) {
    config.rag.similarityThreshold = ragSimilarityThreshold
  }

  const streamingEnabled = parseBooleanEnv(process.env.COPILOT_STREAMING_ENABLED)
  if (streamingEnabled !== null) {
    config.general.streamingEnabled = streamingEnabled
  }

  const maxConversationHistory = parseIntEnv(
    process.env.COPILOT_MAX_CONVERSATION_HISTORY,
    'COPILOT_MAX_CONVERSATION_HISTORY'
  )
  if (maxConversationHistory !== null) {
    config.general.maxConversationHistory = maxConversationHistory
  }

  if (process.env.COPILOT_TITLE_GENERATION_MODEL) {
    config.general.titleGenerationModel = process.env.COPILOT_TITLE_GENERATION_MODEL
  }
}

export function getCopilotConfig(): CopilotConfig {
  const config = structuredClone(DEFAULT_COPILOT_CONFIG)

  try {
    applyEnvironmentOverrides(config)

    logger.info('Copilot configuration loaded', {
      chatProvider: config.chat.defaultProvider,
      chatModel: config.chat.defaultModel,
      ragProvider: config.rag.defaultProvider,
      ragModel: config.rag.defaultModel,
      streamingEnabled: config.general.streamingEnabled,
    })
  } catch (error) {
    logger.warn('Error applying environment variable overrides, using defaults', { error })
  }

  return config
}

export function getCopilotModel(type: CopilotModelType): {
  provider: ProviderId
  model: string
} {
  const config = getCopilotConfig()

  switch (type) {
    case 'chat':
      return {
        provider: config.chat.defaultProvider,
        model: config.chat.defaultModel,
      }
    case 'rag':
      return {
        provider: config.rag.defaultProvider,
        model: config.rag.defaultModel,
      }
    case 'title':
      return {
        provider: config.chat.defaultProvider,
        model: config.general.titleGenerationModel,
      }
    default:
      throw new Error(`Unknown copilot model type: ${type}`)
  }
}

function validateNumericValue(
  value: number,
  constraint: { min: number; max: number },
  name: string
): string | null {
  if (value < constraint.min || value > constraint.max) {
    return `${name} must be between ${constraint.min} and ${constraint.max}`
  }
  return null
}

export function validateCopilotConfig(config: CopilotConfig): ValidationResult {
  const errors: string[] = []

  try {
    const chatDefaultModel = getProviderDefaultModel(config.chat.defaultProvider)
    if (!chatDefaultModel) {
      errors.push(`Chat provider '${config.chat.defaultProvider}' not found`)
    }
  } catch (error) {
    errors.push(`Invalid chat provider: ${config.chat.defaultProvider}`)
  }

  try {
    const ragDefaultModel = getProviderDefaultModel(config.rag.defaultProvider)
    if (!ragDefaultModel) {
      errors.push(`RAG provider '${config.rag.defaultProvider}' not found`)
    }
  } catch (error) {
    errors.push(`Invalid RAG provider: ${config.rag.defaultProvider}`)
  }

  const validationChecks = [
    {
      value: config.chat.temperature,
      constraint: VALIDATION_CONSTRAINTS.temperature,
      name: 'Chat temperature',
    },
    {
      value: config.rag.temperature,
      constraint: VALIDATION_CONSTRAINTS.temperature,
      name: 'RAG temperature',
    },
    {
      value: config.chat.maxTokens,
      constraint: VALIDATION_CONSTRAINTS.maxTokens,
      name: 'Chat maxTokens',
    },
    {
      value: config.rag.maxTokens,
      constraint: VALIDATION_CONSTRAINTS.maxTokens,
      name: 'RAG maxTokens',
    },
    {
      value: config.rag.maxSources,
      constraint: VALIDATION_CONSTRAINTS.maxSources,
      name: 'RAG maxSources',
    },
    {
      value: config.rag.similarityThreshold,
      constraint: VALIDATION_CONSTRAINTS.similarityThreshold,
      name: 'RAG similarityThreshold',
    },
    {
      value: config.general.maxConversationHistory,
      constraint: VALIDATION_CONSTRAINTS.maxConversationHistory,
      name: 'General maxConversationHistory',
    },
  ]

  for (const check of validationChecks) {
    const error = validateNumericValue(check.value, check.constraint, check.name)
    if (error) {
      errors.push(error)
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}
