import {
  getCanonicalModelId,
  isAutoModel,
  modelRequiresExplicitCredentials,
  SIM_AUTO_MODEL_ID,
} from '@/providers/models'
import type { ProviderId } from '@/providers/types'

/** Stored in the Agent block's `model` field when Super User custom routing is active. */
export const CUSTOM_MODEL_ID = 'sim-custom'

export const CUSTOM_DIRECT_MODEL_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'fireworks',
  'xai',
] as const satisfies readonly ProviderId[]

export const CUSTOM_MODEL_PROVIDERS = [...CUSTOM_DIRECT_MODEL_PROVIDERS, 'sim'] as const

export type CustomModelProvider = (typeof CUSTOM_MODEL_PROVIDERS)[number]
export type CustomCredentialMode = 'auto' | 'explicit'

export interface CustomModelParameters {
  reasoningEffort?: string | null
  verbosity?: string | null
  thinkingLevel?: string | null
  temperature?: number | null
  maxTokens?: number | null
  promptCaching?: boolean | null
}

export interface CustomModelCredentials {
  mode: CustomCredentialMode
  apiKey?: string
}

export interface CustomModelConfig {
  provider: CustomModelProvider
  model: string
  parameters: CustomModelParameters
  credentials: CustomModelCredentials
  providerOptions: Record<string, unknown>
}

const PROVIDER_ALIASES: Record<string, CustomModelProvider> = {
  openai: 'openai',
  anthropic: 'anthropic',
  claude: 'anthropic',
  google: 'google',
  gemini: 'google',
  fireworks: 'fireworks',
  xai: 'xai',
  grok: 'xai',
  sim: 'sim',
  auto: 'sim',
  'sim-auto': 'sim',
}

const TOP_LEVEL_KEYS = new Set([
  'provider',
  'model',
  'parameters',
  'credentials',
  'providerOptions',
])
const PARAMETER_KEYS = new Set([
  'reasoningEffort',
  'verbosity',
  'thinkingLevel',
  'temperature',
  'maxTokens',
  'promptCaching',
])
const CREDENTIAL_KEYS = new Set(['mode', 'apiKey'])

/**
 * Keys owned by Sim's canonical request assembly. Allowing them in providerOptions
 * would make precedence ambiguous and could bypass tool/response-format controls.
 */
const RESERVED_PROVIDER_OPTION_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'model',
  'input',
  'messages',
  'system',
  'systemInstruction',
  'system_instruction',
  'tools',
  'toolChoice',
  'tool_choice',
  'parallel_tool_calls',
  'stream',
  'stream_options',
  'responseFormat',
  'response_format',
  'temperature',
  'maxTokens',
  'max_tokens',
  'max_completion_tokens',
  'max_output_tokens',
  'reasoningEffort',
  'reasoning_effort',
  'reasoning',
  'verbosity',
  'text',
  'thinking',
  'thinkingLevel',
  'thinkingConfig',
  'thinking_config',
  'generationConfig',
  'generation_config',
  'apiKey',
  'api_key',
])

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function assertOnlyKeys(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length > 0) {
    throw new Error(
      `${path} contains unsupported field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`
    )
  }
}

function optionalString(value: unknown, path: string): string | null | undefined {
  if (value === undefined || value === null) return value
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must be a non-empty string or null`)
  }
  return value.trim()
}

function optionalFiniteNumber(value: unknown, path: string): number | null | undefined {
  if (value === undefined || value === null) return value
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number or null`)
  }
  return value
}

function normalizeProvider(value: unknown): CustomModelProvider {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('customModelConfig.provider is required')
  }
  const provider = PROVIDER_ALIASES[value.trim().toLowerCase()]
  if (!provider) {
    throw new Error(
      `customModelConfig.provider must be one of: ${CUSTOM_MODEL_PROVIDERS.join(', ')}`
    )
  }
  return provider
}

function parseParameters(value: unknown): CustomModelParameters {
  if (value === undefined) return {}
  if (!isPlainRecord(value)) throw new Error('customModelConfig.parameters must be an object')
  assertOnlyKeys(value, PARAMETER_KEYS, 'customModelConfig.parameters')

  const temperature = optionalFiniteNumber(
    value.temperature,
    'customModelConfig.parameters.temperature'
  )
  const maxTokens = optionalFiniteNumber(value.maxTokens, 'customModelConfig.parameters.maxTokens')
  if (maxTokens != null && (!Number.isInteger(maxTokens) || maxTokens <= 0)) {
    throw new Error('customModelConfig.parameters.maxTokens must be a positive integer or null')
  }
  if (
    value.promptCaching !== undefined &&
    value.promptCaching !== null &&
    typeof value.promptCaching !== 'boolean'
  ) {
    throw new Error('customModelConfig.parameters.promptCaching must be a boolean or null')
  }

  return {
    reasoningEffort: optionalString(
      value.reasoningEffort,
      'customModelConfig.parameters.reasoningEffort'
    ),
    verbosity: optionalString(value.verbosity, 'customModelConfig.parameters.verbosity'),
    thinkingLevel: optionalString(
      value.thinkingLevel,
      'customModelConfig.parameters.thinkingLevel'
    ),
    temperature,
    maxTokens,
    promptCaching: value.promptCaching as boolean | null | undefined,
  }
}

function parseCredentials(value: unknown): CustomModelCredentials {
  if (value === undefined) return { mode: 'auto' }
  if (!isPlainRecord(value)) throw new Error('customModelConfig.credentials must be an object')
  assertOnlyKeys(value, CREDENTIAL_KEYS, 'customModelConfig.credentials')

  const mode = value.mode ?? 'auto'
  if (mode !== 'auto' && mode !== 'explicit') {
    throw new Error('customModelConfig.credentials.mode must be "auto" or "explicit"')
  }
  const apiKey = optionalString(value.apiKey, 'customModelConfig.credentials.apiKey')
  if (mode === 'explicit' && !apiKey) {
    throw new Error(
      'customModelConfig.credentials.apiKey is required when credentials.mode is "explicit"'
    )
  }
  if (mode === 'auto' && apiKey) {
    throw new Error(
      'customModelConfig.credentials.apiKey may only be set when credentials.mode is "explicit"'
    )
  }
  return { mode, ...(apiKey ? { apiKey } : {}) }
}

function parseProviderOptions(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (!isPlainRecord(value)) throw new Error('customModelConfig.providerOptions must be an object')

  for (const key of Object.keys(value)) {
    if (RESERVED_PROVIDER_OPTION_KEYS.has(key)) {
      throw new Error(
        `customModelConfig.providerOptions.${key} is controlled by Sim; use the canonical custom-model fields or the existing Agent subblocks`
      )
    }
  }
  return { ...value }
}

/** Parse and normalize the Super User custom-model JSON contract. */
export function parseCustomModelConfig(value: unknown): CustomModelConfig {
  let parsed: unknown = value
  if (typeof value === 'string') {
    if (value.trim() === '') throw new Error('customModelConfig is required')
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('customModelConfig must be valid JSON')
    }
  }

  if (!isPlainRecord(parsed)) throw new Error('customModelConfig must be a JSON object')
  assertOnlyKeys(parsed, TOP_LEVEL_KEYS, 'customModelConfig')

  const model = optionalString(parsed.model, 'customModelConfig.model')
  if (!model) throw new Error('customModelConfig.model is required')

  const config: CustomModelConfig = {
    provider: normalizeProvider(parsed.provider),
    model,
    parameters: parseParameters(parsed.parameters),
    credentials: parseCredentials(parsed.credentials),
    providerOptions: parseProviderOptions(parsed.providerOptions),
  }

  if (config.provider === 'sim') {
    if (!isAutoModel(config.model)) {
      throw new Error(
        `customModelConfig.model must be "${SIM_AUTO_MODEL_ID}" when provider is "sim"`
      )
    }
    config.model = SIM_AUTO_MODEL_ID
    if (config.credentials.mode !== 'auto') {
      throw new Error('customModelConfig.credentials.mode must be "auto" for Sim Auto')
    }
    if (Object.keys(config.providerOptions).length > 0) {
      throw new Error(
        'customModelConfig.providerOptions must be empty for Sim Auto because the routed provider is dynamic'
      )
    }
  }

  if (config.provider === 'fireworks') {
    config.model = getCanonicalModelId(config.model)
    if (modelRequiresExplicitCredentials(config.model) && config.credentials.mode !== 'explicit') {
      throw new Error(
        `customModelConfig.credentials.mode must be "explicit" for on-demand Fireworks model ${config.model}`
      )
    }
  }

  validateCustomModelParameterSupport(config)
  return config
}

/** Fail clearly instead of silently dropping canonical parameters a provider cannot represent. */
export function validateCustomModelParameterSupport(config: CustomModelConfig): void {
  const { provider, parameters } = config
  const hasValue = (value: unknown) => value !== undefined && value !== null && value !== 'auto'

  // Sim Auto validates parameters against the concrete routed model through
  // the ordinary catalog capability policy after routing.
  if (provider === 'sim') return

  if (hasValue(parameters.verbosity) && provider !== 'openai') {
    throw new Error(`customModelConfig.parameters.verbosity is not supported for ${provider}`)
  }
  if (
    hasValue(parameters.thinkingLevel) &&
    parameters.thinkingLevel !== 'none' &&
    provider !== 'anthropic' &&
    provider !== 'google'
  ) {
    throw new Error(`customModelConfig.parameters.thinkingLevel is not supported for ${provider}`)
  }
  if (parameters.promptCaching === true && provider !== 'anthropic' && provider !== 'openai') {
    throw new Error(`customModelConfig.parameters.promptCaching is not supported for ${provider}`)
  }
}

export function isCustomModel(model: unknown): boolean {
  return typeof model === 'string' && model.trim().toLowerCase() === CUSTOM_MODEL_ID
}

/**
 * VFS-safe projection. Environment references remain useful to Mothership;
 * resolved/literal credentials never cross the Copilot boundary.
 */
export function redactCustomModelConfig(value: unknown): unknown {
  try {
    const config = parseCustomModelConfig(value)
    if (config.credentials.apiKey) {
      const isReference = /^\{\{[^{}]+\}\}$/.test(config.credentials.apiKey.trim())
      config.credentials.apiKey = isReference ? config.credentials.apiKey : '<redacted>'
    }
    return typeof value === 'string' ? JSON.stringify(config, null, 2) : config
  } catch {
    return '<invalid custom model config>'
  }
}

export const CUSTOM_MODEL_CONFIG_DEFAULT = JSON.stringify(
  {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    parameters: {
      reasoningEffort: 'medium',
      verbosity: 'medium',
      thinkingLevel: null,
      temperature: null,
      maxTokens: 32768,
      promptCaching: false,
    },
    credentials: {
      mode: 'explicit',
      apiKey: '{{OPENAI_API_KEY}}',
    },
    providerOptions: {},
  },
  null,
  2
)

export const CUSTOM_MODEL_CONFIG_EXAMPLES = [
  {
    provider: 'fireworks',
    model: 'fireworks/minimax-m2.7',
    parameters: {
      reasoningEffort: 'high',
      temperature: 0.6,
      maxTokens: 32768,
    },
    credentials: {
      mode: 'explicit',
      apiKey: '{{FIREWORKS_API_KEY}}',
    },
    providerOptions: {},
  },
  {
    provider: 'xai',
    model: 'grok-4.5',
    parameters: {
      reasoningEffort: 'high',
      temperature: 0.7,
      maxTokens: 32768,
    },
    credentials: { mode: 'auto' },
    providerOptions: {},
  },
] as const

const CUSTOM_MODEL_ID_EXAMPLES = [
  'fireworks/minimax-m2.7',
  'fireworks/qwen3.7-max',
  'fireworks/gpt-oss-120b',
  'fireworks/nemotron-3-ultra-nvfp4',
  'fireworks/nemotron-3-ultra-bf16',
  'fireworks/nemotron-3-super-120b-a12b-nvfp4',
  'fireworks/nemotron-3-super-120b-a12b-fp8',
  'fireworks/ling-3-flash',
  'grok-4.5',
] as const

export const CUSTOM_MODEL_CONFIG_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'model'],
  examples: CUSTOM_MODEL_CONFIG_EXAMPLES,
  properties: {
    provider: {
      type: 'string',
      enum: [...CUSTOM_MODEL_PROVIDERS],
      description:
        'Provider adapter. Use sim with model sim-auto for dynamic routing. Aliases gemini, claude, grok, and auto are normalized on execution.',
    },
    model: {
      type: 'string',
      minLength: 1,
      examples: CUSTOM_MODEL_ID_EXAMPLES,
      description:
        'Provider model ID. Known Fireworks aliases normalize to the exact accounts/fireworks/models resource; on-demand Fireworks entries require explicit credentials.',
    },
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reasoningEffort: { type: ['string', 'null'] },
        verbosity: { type: ['string', 'null'] },
        thinkingLevel: { type: ['string', 'null'] },
        temperature: { type: ['number', 'null'] },
        maxTokens: { type: ['integer', 'null'], minimum: 1 },
        promptCaching: { type: ['boolean', 'null'] },
      },
    },
    credentials: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { type: 'string', enum: ['auto', 'explicit'], default: 'auto' },
        apiKey: {
          type: 'string',
          description: 'Use an environment-variable reference such as {{OPENAI_API_KEY}}.',
        },
      },
    },
    providerOptions: {
      type: 'object',
      description:
        'Provider-specific top-level request options. Canonical model, message, tool, response-format, streaming, credential, and tuning fields are reserved.',
      additionalProperties: true,
    },
  },
}
