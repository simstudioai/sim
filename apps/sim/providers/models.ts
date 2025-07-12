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
  OllamaIcon,
  OpenAIIcon,
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
}

/**
 * Comprehensive provider definitions, single source of truth
 */
export const PROVIDER_DEFINITIONS: Record<string, ProviderDefinition> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: "OpenAI's models",
    defaultModel: 'gpt-4o',
    modelPatterns: [/^gpt/, /^o1/],
    icon: OpenAIIcon,
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
          toolUsageControl: true,
        },
      },
      {
        id: 'o1',
        pricing: {
          input: 15.0,
          cachedInput: 7.5,
          output: 60,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          toolUsageControl: true,
        },
      },
      {
        id: 'o3',
        pricing: {
          input: 2,
          cachedInput: 0.5,
          output: 8,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          toolUsageControl: true,
        },
      },
      {
        id: 'o4-mini',
        pricing: {
          input: 1.1,
          cachedInput: 0.275,
          output: 4.4,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          toolUsageControl: true,
        },
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
          toolUsageControl: true,
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
          toolUsageControl: true,
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
          toolUsageControl: true,
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
          toolUsageControl: true,
        },
      },
      {
        id: 'azure/o3',
        pricing: {
          input: 10,
          cachedInput: 2.5,
          output: 40,
          updatedAt: '2025-06-15',
        },
        capabilities: {
          toolUsageControl: true,
        },
      },
      {
        id: 'azure/o4-mini',
        pricing: {
          input: 1.1,
          cachedInput: 0.275,
          output: 4.4,
          updatedAt: '2025-06-15',
        },
        capabilities: {
          toolUsageControl: true,
        },
      },
      {
        id: 'azure/gpt-4.1',
        pricing: {
          input: 2.0,
          cachedInput: 0.5,
          output: 8.0,
          updatedAt: '2025-06-15',
        },
        capabilities: {
          toolUsageControl: true,
        },
      },
      {
        id: 'azure/model-router',
        pricing: {
          input: 2.0,
          cachedInput: 0.5,
          output: 8.0,
          updatedAt: '2025-06-15',
        },
        capabilities: {
          toolUsageControl: true,
        },
      },
    ],
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    description: "Anthropic's Claude models",
    defaultModel: 'claude-sonnet-4-0',
    modelPatterns: [/^claude/],
    icon: AnthropicIcon,
    models: [
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
          toolUsageControl: true,
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
          toolUsageControl: true,
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
          toolUsageControl: true,
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
          toolUsageControl: true,
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
          toolUsageControl: true,
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
          toolUsageControl: true,
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
    models: [
      {
        id: 'deepseek-chat',
        pricing: {
          input: 0.75,
          cachedInput: 0.4,
          output: 1.0,
          updatedAt: '2025-03-21',
        },
        capabilities: {
          toolUsageControl: true,
        },
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
          toolUsageControl: true,
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
        capabilities: {
          toolUsageControl: true,
        },
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
    models: [
      {
        id: 'grok-4-latest',
        pricing: {
          input: 5.0,
          cachedInput: 2.5,
          output: 25.0,
          updatedAt: '2025-07-10',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          toolUsageControl: true,
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
          toolUsageControl: true,
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
          toolUsageControl: true,
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
    models: [
      {
        id: 'cerebras/llama-3.3-70b',
        pricing: {
          input: 0.94,
          cachedInput: 0.47,
          output: 0.94,
          updatedAt: '2025-03-21',
        },
        capabilities: {
          toolUsageControl: false,
        },
      },
    ],
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    description: "Groq's LLM models with high-performance inference",
    defaultModel: 'groq/meta-llama/llama-4-scout-17b-16e-instruct',
    modelPatterns: [/^groq/],
    icon: GroqIcon,
    models: [
      {
        id: 'groq/meta-llama/llama-4-scout-17b-16e-instruct',
        pricing: {
          input: 0.4,
          cachedInput: 0.2,
          output: 0.6,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          toolUsageControl: false,
        },
      },
      {
        id: 'groq/deepseek-r1-distill-llama-70b',
        pricing: {
          input: 0.75,
          cachedInput: 0.38,
          output: 0.99,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          toolUsageControl: false,
        },
      },
      {
        id: 'groq/qwen-qwq-32b',
        pricing: {
          input: 0.29,
          cachedInput: 0.29,
          output: 0.39,
          updatedAt: '2025-06-17',
        },
        capabilities: {
          toolUsageControl: false,
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

// Helper functions to extract information from the comprehensive definitions

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
      return model.capabilities
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
    if (provider.models.some((model) => model.capabilities.toolUsageControl)) {
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
