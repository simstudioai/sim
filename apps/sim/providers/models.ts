/**
 * Comprehensive provider definitions - Single source of truth
 * This file contains all provider and model information including:
 * - Model lists
 * - Pricing information
 * - Model capabilities (temperature support, etc.)
 * - Provider configurations
 */

import type React from 'react'
import {
  AnthropicIcon,
  AzureIcon,
  CerebrasIcon,
  DeepseekIcon,
  GeminiIcon,
  GroqIcon,
  MistralIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
  xAIIcon,
} from '@/components/icons'

export interface ModelPricing {
  input: number // Per 1M tokens
  cachedInput?: number // Per 1M tokens (if supported)
  output: number // Per 1M tokens
  updatedAt: string
}

export interface ModelCapabilities {
  temperature?: {
    min: number
    max: number
  }
  toolUsageControl?: boolean
  computerUse?: boolean
  reasoningEffort?: {
    values: string[]
  }
  verbosity?: {
    values: string[]
  }
}

export interface ModelDefinition {
  id: string
  pricing: ModelPricing
  capabilities: ModelCapabilities
}

export interface ProviderDefinition {
  id: string
  name: string
  description: string
  models: ModelDefinition[]
  defaultModel: string
  modelPatterns?: RegExp[]
  icon?: React.ComponentType<{ className?: string }>
  capabilities?: ModelCapabilities
}

/**
 * Comprehensive provider definitions, single source of truth
 */
export const PROVIDER_DEFINITIONS: Record<string, ProviderDefinition> = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified access to many models via OpenRouter',
    defaultModel: '',
    modelPatterns: [/^openrouter\//],
    icon: OpenRouterIcon,
    capabilities: {
      temperature: { min: 0, max: 2 },
      toolUsageControl: true,
    },
    models: [],
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: "OpenAI's models",
    defaultModel: 'gpt-4o',
    modelPatterns: [/^gpt/, /^o1/, /^text-embedding/],
    icon: OpenAIIcon,
    capabilities: {
      toolUsageControl: true,
    },
    models: [
      {
        id: 'gpt-4o',
        pricing: {
          input: 2.5,
          cachedInput: 1.25,
          output: 10.0,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
      },
      {
        id: 'gpt-5',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
          updatedAt: '2025-08-07',
        },
        capabilities: {
          reasoningEffort: {
            values: ['minimal', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'gpt-5-mini',
        pricing: {
          input: 0.25,
          cachedInput: 0.025,
          output: 2.0,
          updatedAt: '2025-08-07',
        },
        capabilities: {
          reasoningEffort: {
            values: ['minimal', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'gpt-5-nano',
        pricing: {
          input: 0.05,
          cachedInput: 0.005,
          output: 0.4,
          updatedAt: '2025-08-07',
        },
        capabilities: {
          reasoningEffort: {
            values: ['minimal', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'gpt-5-chat-latest',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
          updatedAt: '2025-08-07',
        },
        capabilities: {},
      },
      {
        id: 'o1',
        pricing: {
          input: 15.0,
          cachedInput: 7.5,
          output: 60,
          updatedAt: '2025-06-17',
        },
        capabilities: {},
      },
      {
        id: 'o3',
        pricing: {
          input: 2,
          cachedInput: 0.5,
          output: 8,
          updatedAt: '2025-06-17',
        },
        capabilities: {},
      },
      {
        id: 'o4-mini',
        pricing: {
          input: 1.1,
          cachedInput: 0.275,
          output: 4.4,
          updatedAt: '2025-06-17',
        },
        capabilities: {},
      },
      {
        id: 'gpt-4.1',
        pricing: {
          input: 2.0,
          cachedInput: 0.5,
          output: 8.0,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
      },
      {
        id: 'gpt-4.1-nano',
        pricing: {
          input: 0.1,
          cachedInput: 0.025,
          output: 0.4,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
      },
      {
        id: 'gpt-4.1-mini',
        pricing: {
          input: 0.4,
          cachedInput: 0.1,
          output: 1.6,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
      },
    ],
  },
  'azure-openai': {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    description: 'Microsoft Azure OpenAI Service models',
    defaultModel: 'azure/gpt-4o',
    modelPatterns: [/^azure\//],
    capabilities: {
      toolUsageControl: true,
    },
    icon: AzureIcon,
    models: [
      {
        id: 'azure/gpt-4o',
        pricing: {
          input: 2.5,
          cachedInput: 1.25,
          output: 10.0,
          updatedAt: '2025-06-15',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
      },
      {
        id: 'azure/gpt-5',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
          updatedAt: '2025-08-07',
        },
        capabilities: {
          reasoningEffort: {
            values: ['minimal', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'azure/gpt-5-mini',
        pricing: {
          input: 0.25,
          cachedInput: 0.025,
          output: 2.0,
          updatedAt: '2025-08-07',
        },
        capabilities: {
          reasoningEffort: {
            values: ['minimal', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'azure/gpt-5-nano',
        pricing: {
          input: 0.05,
          cachedInput: 0.005,
          output: 0.4,
          updatedAt: '2025-08-07',
        },
        capabilities: {
          reasoningEffort: {
            values: ['minimal', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'azure/gpt-5-chat-latest',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
          updatedAt: '2025-08-07',
        },
        capabilities: {},
      },
      {
        id: 'azure/o3',
        pricing: {
          input: 10,
          cachedInput: 2.5,
          output: 40,
          updatedAt: '2025-06-15',
        },
        capabilities: {},
      },
      {
        id: 'azure/o4-mini',
        pricing: {
          input: 1.1,
          cachedInput: 0.275,
          output: 4.4,
          updatedAt: '2025-06-15',
        },
        capabilities: {},
      },
      {
        id: 'azure/gpt-4.1',
        pricing: {
          input: 2.0,
          cachedInput: 0.5,
          output: 8.0,
          updatedAt: '2025-06-15',
        },
        capabilities: {},
      },
      {
        id: 'azure/model-router',
        pricing: {
          input: 2.0,
          cachedInput: 0.5,
          output: 8.0,
          updatedAt: '2025-06-15',
        },
        capabilities: {},
      },
    ],
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    description: "Anthropic's Claude models",
    defaultModel: 'claude-sonnet-4-5',
    modelPatterns: [/^claude/],
    icon: AnthropicIcon,
    capabilities: {
      toolUsageControl: true,
    },
    models: [
      {
        id: 'claude-haiku-4-5',
        pricing: {
          input: 1.0,
          cachedInput: 0.5,
          output: 5.0,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'claude-sonnet-4-5',
        pricing: {
          input: 3.0,
          cachedInput: 1.5,
          output: 15.0,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'claude-sonnet-4-0',
        pricing: {
          input: 3.0,
          cachedInput: 1.5,
          output: 15.0,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'claude-opus-4-1',
        pricing: {
          input: 15.0,
          cachedInput: 7.5,
          output: 75.0,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'claude-opus-4-0',
        pricing: {
          input: 15.0,
          cachedInput: 7.5,
          output: 75.0,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'claude-3-7-sonnet-latest',
        pricing: {
          input: 3.0,
          cachedInput: 1.5,
          output: 15.0,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          computerUse: true,
        },
      },
      {
        id: 'claude-3-5-sonnet-latest',
        pricing: {
          input: 3.0,
          cachedInput: 1.5,
          output: 15.0,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          computerUse: true,
        },
      },
    ],
  },
  google: {
    id: 'google',
    name: 'Google',
    description: "Google's Gemini models",
    defaultModel: 'gemini-2.5-pro',
    modelPatterns: [/^gemini/],
    capabilities: {
      toolUsageControl: true,
    },
    icon: GeminiIcon,
    models: [
      {
        id: 'gemini-2.5-pro',
        pricing: {
          input: 0.15,
          cachedInput: 0.075,
          output: 0.6,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
      },
      {
        id: 'gemini-2.5-flash',
        pricing: {
          input: 0.15,
          cachedInput: 0.075,
          output: 0.6,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
      },
    ],
  },
  deepseek: {
    id: 'deepseek',
    name: 'Deepseek',
    description: "Deepseek's chat models",
    defaultModel: 'deepseek-chat',
    modelPatterns: [],
    icon: DeepseekIcon,
    capabilities: {
      toolUsageControl: true,
    },
    models: [
      {
        id: 'deepseek-chat',
        pricing: {
          input: 0.75,
          cachedInput: 0.4,
          output: 1.0,
          updatedAt: '2025-03-21',
        },
        capabilities: {},
      },
      {
        id: 'deepseek-v3',
        pricing: {
          input: 0.75,
          cachedInput: 0.4,
          output: 1.0,
          updatedAt: '2025-03-21',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
      },
      {
        id: 'deepseek-r1',
        pricing: {
          input: 1.0,
          cachedInput: 0.5,
          output: 1.5,
          updatedAt: '2025-03-21',
        },
        capabilities: {},
      },
    ],
  },
  xai: {
    id: 'xai',
    name: 'xAI',
    description: "xAI's Grok models",
    defaultModel: 'grok-4-latest',
    modelPatterns: [/^grok/],
    icon: xAIIcon,
    capabilities: {
      toolUsageControl: true,
    },
    models: [
      {
        id: 'grok-4-latest',
        pricing: {
          input: 3.0,
          cachedInput: 1.5,
          output: 15.0,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'grok-4-fast-reasoning',
        pricing: {
          input: 0.2,
          cachedInput: 0.25,
          output: 0.5,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'grok-4-fast-non-reasoning',
        pricing: {
          input: 0.2,
          cachedInput: 0.25,
          output: 0.5,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'grok-code-fast-1',
        pricing: {
          input: 0.2,
          cachedInput: 0.25,
          output: 1.5,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'grok-3-latest',
        pricing: {
          input: 3.0,
          cachedInput: 1.5,
          output: 15.0,
          updatedAt: '2025-04-17',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'grok-3-fast-latest',
        pricing: {
          input: 5.0,
          cachedInput: 2.5,
          output: 25.0,
          updatedAt: '2025-04-17',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
    ],
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    description: 'Cerebras Cloud LLMs',
    defaultModel: 'cerebras/llama-3.3-70b',
    modelPatterns: [/^cerebras/],
    icon: CerebrasIcon,
    capabilities: {
      toolUsageControl: false,
    },
    models: [
      {
        id: 'cerebras/llama-3.1-8b',
        pricing: {
          input: 0.1,
          output: 0.1,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
      {
        id: 'cerebras/llama-3.1-70b',
        pricing: {
          input: 0.6,
          output: 0.6,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
      {
        id: 'cerebras/llama-3.3-70b',
        pricing: {
          input: 0.6,
          output: 0.6,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
      {
        id: 'cerebras/llama-4-scout-17b-16e-instruct',
        pricing: {
          input: 0.11,
          output: 0.34,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
    ],
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    description: "Groq's LLM models with high-performance inference",
    defaultModel: 'groq/llama-3.3-70b-versatile',
    modelPatterns: [/^groq/],
    icon: GroqIcon,
    capabilities: {
      toolUsageControl: false,
    },
    models: [
      {
        id: 'groq/openai/gpt-oss-120b',
        pricing: {
          input: 0.15,
          output: 0.75,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
      {
        id: 'groq/openai/gpt-oss-20b',
        pricing: {
          input: 0.01,
          output: 0.25,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
      {
        id: 'groq/llama-3.1-8b-instant',
        pricing: {
          input: 0.05,
          output: 0.08,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
      {
        id: 'groq/llama-3.3-70b-versatile',
        pricing: {
          input: 0.59,
          output: 0.79,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
      {
        id: 'groq/llama-4-scout-17b-instruct',
        pricing: {
          input: 0.11,
          output: 0.34,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
      {
        id: 'groq/llama-4-maverick-17b-instruct',
        pricing: {
          input: 0.5,
          output: 0.77,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
      {
        id: 'groq/meta-llama/llama-4-maverick-17b-128e-instruct',
        pricing: {
          input: 0.5,
          output: 0.77,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
      {
        id: 'groq/gemma2-9b-it',
        pricing: {
          input: 0.04,
          output: 0.04,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
      {
        id: 'groq/deepseek-r1-distill-llama-70b',
        pricing: {
          input: 0.59,
          output: 0.79,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
      {
        id: 'groq/moonshotai/kimi-k2-instruct',
        pricing: {
          input: 1.0,
          output: 3.0,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
      {
        id: 'groq/meta-llama/llama-guard-4-12b',
        pricing: {
          input: 0.2,
          output: 0.2,
          updatedAt: '2025-10-11',
        },
        capabilities: {},
      },
    ],
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    description: "Mistral AI's language models",
    defaultModel: 'mistral-large-latest',
    modelPatterns: [/^mistral/, /^magistral/, /^open-mistral/, /^codestral/, /^ministral/],
    icon: MistralIcon,
    capabilities: {
      toolUsageControl: true,
    },
    models: [
      {
        id: 'mistral-large-latest',
        pricing: {
          input: 2.0,
          output: 6.0,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'mistral-large-2411',
        pricing: {
          input: 2.0,
          output: 6.0,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'magistral-medium-latest',
        pricing: {
          input: 2.0,
          output: 5.0,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'magistral-medium-2509',
        pricing: {
          input: 2.0,
          output: 5.0,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'mistral-medium-latest',
        pricing: {
          input: 0.4,
          output: 2.0,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'mistral-medium-2508',
        pricing: {
          input: 0.4,
          output: 2.0,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'mistral-small-latest',
        pricing: {
          input: 0.2,
          output: 0.6,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'mistral-small-2506',
        pricing: {
          input: 0.2,
          output: 0.6,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'open-mistral-nemo',
        pricing: {
          input: 0.15,
          output: 0.15,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'codestral-latest',
        pricing: {
          input: 0.3,
          output: 0.9,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'codestral-2508',
        pricing: {
          input: 0.3,
          output: 0.9,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'ministral-8b-latest',
        pricing: {
          input: 0.1,
          output: 0.1,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'ministral-8b-2410',
        pricing: {
          input: 0.1,
          output: 0.1,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
      {
        id: 'ministral-3b-latest',
        pricing: {
          input: 0.04,
          output: 0.04,
          updatedAt: '2025-10-11',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
      },
    ],
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local LLM models via Ollama',
    defaultModel: '',
    modelPatterns: [],
    icon: OllamaIcon,
    models: [], // Populated dynamically
  },
}

/**
 * Get all models for a specific provider
 */
export function getProviderModels(providerId: string): string[] {
  return PROVIDER_DEFINITIONS[providerId]?.models.map((m) => m.id) || []
}

/**
 * Get the default model for a specific provider
 */
export function getProviderDefaultModel(providerId: string): string {
  return PROVIDER_DEFINITIONS[providerId]?.defaultModel || ''
}

/**
 * Get pricing information for a specific model
 */
export function getModelPricing(modelId: string): ModelPricing | null {
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((m) => m.id.toLowerCase() === modelId.toLowerCase())
    if (model) {
      return model.pricing
    }
  }
  return null
}

/**
 * Get capabilities for a specific model
 */
export function getModelCapabilities(modelId: string): ModelCapabilities | null {
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((m) => m.id.toLowerCase() === modelId.toLowerCase())
    if (model) {
      // Merge provider capabilities with model capabilities, model takes precedence
      const capabilities: ModelCapabilities = { ...provider.capabilities, ...model.capabilities }
      return capabilities
    }
  }

  // If no model found, check for provider-level capabilities for dynamically fetched models
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    if (provider.modelPatterns) {
      for (const pattern of provider.modelPatterns) {
        if (pattern.test(modelId.toLowerCase())) {
          return provider.capabilities || null
        }
      }
    }
  }

  return null
}

/**
 * Get all models that support temperature
 */
export function getModelsWithTemperatureSupport(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.temperature) {
        models.push(model.id)
      }
    }
  }
  return models
}

/**
 * Get all models with temperature range 0-1
 */
export function getModelsWithTempRange01(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.temperature?.max === 1) {
        models.push(model.id)
      }
    }
  }
  return models
}

/**
 * Get all models with temperature range 0-2
 */
export function getModelsWithTempRange02(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.temperature?.max === 2) {
        models.push(model.id)
      }
    }
  }
  return models
}

/**
 * Get all providers that support tool usage control
 */
export function getProvidersWithToolUsageControl(): string[] {
  const providers: string[] = []
  for (const [providerId, provider] of Object.entries(PROVIDER_DEFINITIONS)) {
    if (provider.capabilities?.toolUsageControl) {
      providers.push(providerId)
    }
  }
  return providers
}

/**
 * Get all models that are hosted (don't require user API keys)
 */
export function getHostedModels(): string[] {
  // Currently, OpenAI and Anthropic models are hosted
  return [...getProviderModels('openai'), ...getProviderModels('anthropic')]
}

/**
 * Get all computer use models
 */
export function getComputerUseModels(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.computerUse) {
        models.push(model.id)
      }
    }
  }
  return models
}

/**
 * Check if a model supports temperature
 */
export function supportsTemperature(modelId: string): boolean {
  const capabilities = getModelCapabilities(modelId)
  return !!capabilities?.temperature
}

/**
 * Get maximum temperature for a model
 */
export function getMaxTemperature(modelId: string): number | undefined {
  const capabilities = getModelCapabilities(modelId)
  return capabilities?.temperature?.max
}

/**
 * Check if a provider supports tool usage control
 */
export function supportsToolUsageControl(providerId: string): boolean {
  return getProvidersWithToolUsageControl().includes(providerId)
}

/**
 * Update Ollama models dynamically
 */
export function updateOllamaModels(models: string[]): void {
  PROVIDER_DEFINITIONS.ollama.models = models.map((modelId) => ({
    id: modelId,
    pricing: {
      input: 0,
      output: 0,
      updatedAt: new Date().toISOString().split('T')[0],
    },
    capabilities: {},
  }))
}

/**
 * Update OpenRouter models dynamically
 */
export function updateOpenRouterModels(models: string[]): void {
  PROVIDER_DEFINITIONS.openrouter.models = models.map((modelId) => ({
    id: modelId,
    pricing: {
      input: 0,
      output: 0,
      updatedAt: new Date().toISOString().split('T')[0],
    },
    capabilities: {},
  }))
}

/**
 * Embedding model pricing - separate from chat models
 */
export const EMBEDDING_MODEL_PRICING: Record<string, ModelPricing> = {
  'text-embedding-3-small': {
    input: 0.02, // $0.02 per 1M tokens
    output: 0.0,
    updatedAt: '2025-07-10',
  },
  'text-embedding-3-large': {
    input: 0.13, // $0.13 per 1M tokens
    output: 0.0,
    updatedAt: '2025-07-10',
  },
  'text-embedding-ada-002': {
    input: 0.1, // $0.1 per 1M tokens
    output: 0.0,
    updatedAt: '2025-07-10',
  },
}

/**
 * Get pricing for embedding models specifically
 */
export function getEmbeddingModelPricing(modelId: string): ModelPricing | null {
  return EMBEDDING_MODEL_PRICING[modelId] || null
}

/**
 * Get all models that support reasoning effort
 */
export function getModelsWithReasoningEffort(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.reasoningEffort) {
        models.push(model.id)
      }
    }
  }
  return models
}

/**
 * Get all models that support verbosity
 */
export function getModelsWithVerbosity(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.verbosity) {
        models.push(model.id)
      }
    }
  }
  return models
}
