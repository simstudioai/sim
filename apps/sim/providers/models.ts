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
  BedrockIcon,
  CerebrasIcon,
  DeepseekIcon,
  GeminiIcon,
  GroqIcon,
  MistralIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
  VertexIcon,
  VllmIcon,
  xAIIcon,
} from '@/components/icons'
import type { ModelPricing } from '@/providers/types'

export interface ModelCapabilities {
  temperature?: {
    min: number
    max: number
  }
  toolUsageControl?: boolean
  computerUse?: boolean
  nativeStructuredOutputs?: boolean
  /** Maximum supported output tokens for this model */
  maxOutputTokens?: number
  reasoningEffort?: {
    values: string[]
  }
  verbosity?: {
    values: string[]
  }
  thinking?: {
    levels: string[]
    default?: string
  }
}

export interface ModelDefinition {
  id: string
  pricing: ModelPricing
  capabilities: ModelCapabilities
  contextWindow?: number
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
  contextInformationAvailable?: boolean
}

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
    contextInformationAvailable: false,
    models: [],
  },
  vllm: {
    id: 'vllm',
    name: 'vLLM',
    icon: VllmIcon,
    description: 'Self-hosted vLLM with an OpenAI-compatible API',
    defaultModel: 'vllm/generic',
    modelPatterns: [/^vllm\//],
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
    modelPatterns: [/^gpt/, /^o\d/, /^text-embedding/],
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
        contextWindow: 128000,
      },
      {
        id: 'gpt-5.2',
        pricing: {
          input: 1.75,
          cachedInput: 0.175,
          output: 14.0,
          updatedAt: '2025-12-11',
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
        },
        contextWindow: 400000,
      },
      {
        id: 'gpt-5.1',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
          updatedAt: '2025-11-14',
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
        },
        contextWindow: 400000,
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
        contextWindow: 400000,
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
        contextWindow: 400000,
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
        contextWindow: 400000,
      },
      {
        id: 'gpt-5-chat-latest',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
          updatedAt: '2025-08-07',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 128000,
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
          reasoningEffort: {
            values: ['low', 'medium', 'high'],
          },
        },
        contextWindow: 200000,
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
          reasoningEffort: {
            values: ['low', 'medium', 'high'],
          },
        },
        contextWindow: 200000,
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
          reasoningEffort: {
            values: ['low', 'medium', 'high'],
          },
        },
        contextWindow: 200000,
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
        contextWindow: 1000000,
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
        contextWindow: 1000000,
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
        contextWindow: 1000000,
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
        id: 'claude-opus-4-6',
        pricing: {
          input: 5.0,
          cachedInput: 0.5,
          output: 25.0,
          updatedAt: '2026-02-05',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          nativeStructuredOutputs: true,
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'max'],
            default: 'high',
          },
        },
        contextWindow: 200000,
      },
      {
        id: 'claude-opus-4-5',
        pricing: {
          input: 5.0,
          cachedInput: 0.5,
          output: 25.0,
          updatedAt: '2025-11-24',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          nativeStructuredOutputs: true,
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
            default: 'high',
          },
        },
        contextWindow: 200000,
      },
      {
        id: 'claude-opus-4-1',
        pricing: {
          input: 15.0,
          cachedInput: 1.5,
          output: 75.0,
          updatedAt: '2026-02-05',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          nativeStructuredOutputs: true,
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
            default: 'high',
          },
        },
        contextWindow: 200000,
      },
      {
        id: 'claude-opus-4-0',
        pricing: {
          input: 15.0,
          cachedInput: 1.5,
          output: 75.0,
          updatedAt: '2026-02-05',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
            default: 'high',
          },
        },
        contextWindow: 200000,
      },
      {
        id: 'claude-sonnet-4-5',
        pricing: {
          input: 3.0,
          cachedInput: 0.3,
          output: 15.0,
          updatedAt: '2026-02-05',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          nativeStructuredOutputs: true,
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
            default: 'high',
          },
        },
        contextWindow: 200000,
      },
      {
        id: 'claude-sonnet-4-0',
        pricing: {
          input: 3.0,
          cachedInput: 0.3,
          output: 15.0,
          updatedAt: '2026-02-05',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
            default: 'high',
          },
        },
        contextWindow: 200000,
      },
      {
        id: 'claude-haiku-4-5',
        pricing: {
          input: 1.0,
          cachedInput: 0.1,
          output: 5.0,
          updatedAt: '2026-02-05',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          nativeStructuredOutputs: true,
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
            default: 'high',
          },
        },
        contextWindow: 200000,
      },
      {
        id: 'claude-3-haiku-20240307',
        pricing: {
          input: 0.25,
          cachedInput: 0.03,
          output: 1.25,
          updatedAt: '2026-02-05',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 4096,
        },
        contextWindow: 200000,
      },
      {
        id: 'claude-3-7-sonnet-latest',
        pricing: {
          input: 3.0,
          cachedInput: 0.3,
          output: 15.0,
          updatedAt: '2026-02-05',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          computerUse: true,
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
            default: 'high',
          },
        },
        contextWindow: 200000,
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
        contextWindow: 128000,
      },
      {
        id: 'azure/gpt-5.2',
        pricing: {
          input: 1.75,
          cachedInput: 0.175,
          output: 14.0,
          updatedAt: '2025-12-11',
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
        },
        contextWindow: 400000,
      },
      {
        id: 'azure/gpt-5.1',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
          updatedAt: '2025-11-14',
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
        },
        contextWindow: 400000,
      },
      {
        id: 'azure/gpt-5.1-codex',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
          updatedAt: '2025-11-14',
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
        },
        contextWindow: 400000,
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
        contextWindow: 400000,
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
        contextWindow: 400000,
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
        contextWindow: 400000,
      },
      {
        id: 'azure/gpt-5-chat-latest',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
          updatedAt: '2025-08-07',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 128000,
      },
      {
        id: 'azure/o3',
        pricing: {
          input: 2,
          cachedInput: 0.5,
          output: 8,
          updatedAt: '2026-02-06',
        },
        capabilities: {
          reasoningEffort: {
            values: ['low', 'medium', 'high'],
          },
        },
        contextWindow: 200000,
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
          reasoningEffort: {
            values: ['low', 'medium', 'high'],
          },
        },
        contextWindow: 200000,
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
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 1000000,
      },
      {
        id: 'azure/gpt-4.1-mini',
        pricing: {
          input: 0.4,
          cachedInput: 0.1,
          output: 1.6,
          updatedAt: '2025-06-15',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 1000000,
      },
      {
        id: 'azure/gpt-4.1-nano',
        pricing: {
          input: 0.1,
          cachedInput: 0.025,
          output: 0.4,
          updatedAt: '2025-06-15',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 1000000,
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
        contextWindow: 200000,
      },
    ],
  },
  'azure-anthropic': {
    id: 'azure-anthropic',
    name: 'Azure Anthropic',
    description: 'Anthropic Claude models via Azure AI Foundry',
    defaultModel: 'azure-anthropic/claude-sonnet-4-5',
    modelPatterns: [/^azure-anthropic\//],
    icon: AzureIcon,
    capabilities: {
      toolUsageControl: true,
    },
    models: [
      {
        id: 'azure-anthropic/claude-opus-4-6',
        pricing: {
          input: 5.0,
          cachedInput: 0.5,
          output: 25.0,
          updatedAt: '2026-02-05',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          nativeStructuredOutputs: true,
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'max'],
            default: 'high',
          },
        },
        contextWindow: 200000,
      },
      {
        id: 'azure-anthropic/claude-opus-4-5',
        pricing: {
          input: 5.0,
          cachedInput: 0.5,
          output: 25.0,
          updatedAt: '2026-02-05',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          nativeStructuredOutputs: true,
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
            default: 'high',
          },
        },
        contextWindow: 200000,
      },
      {
        id: 'azure-anthropic/claude-sonnet-4-5',
        pricing: {
          input: 3.0,
          cachedInput: 0.3,
          output: 15.0,
          updatedAt: '2026-02-05',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          nativeStructuredOutputs: true,
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
            default: 'high',
          },
        },
        contextWindow: 200000,
      },
      {
        id: 'azure-anthropic/claude-opus-4-1',
        pricing: {
          input: 15.0,
          cachedInput: 1.5,
          output: 75.0,
          updatedAt: '2026-02-05',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          nativeStructuredOutputs: true,
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
            default: 'high',
          },
        },
        contextWindow: 200000,
      },
      {
        id: 'azure-anthropic/claude-haiku-4-5',
        pricing: {
          input: 1.0,
          cachedInput: 0.1,
          output: 5.0,
          updatedAt: '2026-02-05',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          nativeStructuredOutputs: true,
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
            default: 'high',
          },
        },
        contextWindow: 200000,
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
        id: 'gemini-3-pro-preview',
        pricing: {
          input: 2.0,
          cachedInput: 0.2,
          output: 12.0,
          updatedAt: '2025-12-17',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['low', 'high'],
            default: 'high',
          },
        },
        contextWindow: 1000000,
      },
      {
        id: 'gemini-3-flash-preview',
        pricing: {
          input: 0.5,
          cachedInput: 0.05,
          output: 3.0,
          updatedAt: '2025-12-17',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['minimal', 'low', 'medium', 'high'],
            default: 'high',
          },
        },
        contextWindow: 1000000,
      },
      {
        id: 'gemini-2.5-pro',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 1048576,
      },
      {
        id: 'gemini-2.5-flash',
        pricing: {
          input: 0.3,
          cachedInput: 0.03,
          output: 2.5,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 1048576,
      },
      {
        id: 'gemini-2.5-flash-lite',
        pricing: {
          input: 0.1,
          cachedInput: 0.01,
          output: 0.4,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 1048576,
      },
      {
        id: 'gemini-2.0-flash',
        pricing: {
          input: 0.1,
          output: 0.4,
          updatedAt: '2025-12-17',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 1000000,
      },
      {
        id: 'gemini-2.0-flash-lite',
        pricing: {
          input: 0.075,
          output: 0.3,
          updatedAt: '2025-12-17',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 1000000,
      },
    ],
  },
  vertex: {
    id: 'vertex',
    name: 'Vertex AI',
    description: "Google's Vertex AI platform for Gemini models",
    defaultModel: 'vertex/gemini-2.5-pro',
    modelPatterns: [/^vertex\//],
    icon: VertexIcon,
    capabilities: {
      toolUsageControl: true,
    },
    models: [
      {
        id: 'vertex/gemini-3-pro-preview',
        pricing: {
          input: 2.0,
          cachedInput: 0.2,
          output: 12.0,
          updatedAt: '2025-12-17',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['low', 'high'],
            default: 'high',
          },
        },
        contextWindow: 1000000,
      },
      {
        id: 'vertex/gemini-3-flash-preview',
        pricing: {
          input: 0.5,
          cachedInput: 0.05,
          output: 3.0,
          updatedAt: '2025-12-17',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['minimal', 'low', 'medium', 'high'],
            default: 'high',
          },
        },
        contextWindow: 1000000,
      },
      {
        id: 'vertex/gemini-2.5-pro',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 1048576,
      },
      {
        id: 'vertex/gemini-2.5-flash',
        pricing: {
          input: 0.3,
          cachedInput: 0.03,
          output: 2.5,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 1048576,
      },
      {
        id: 'vertex/gemini-2.5-flash-lite',
        pricing: {
          input: 0.1,
          cachedInput: 0.01,
          output: 0.4,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 1048576,
      },
      {
        id: 'vertex/gemini-2.0-flash',
        pricing: {
          input: 0.1,
          output: 0.4,
          updatedAt: '2025-12-17',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 1000000,
      },
      {
        id: 'vertex/gemini-2.0-flash-lite',
        pricing: {
          input: 0.075,
          output: 0.3,
          updatedAt: '2025-12-17',
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
        contextWindow: 1000000,
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
        contextWindow: 128000,
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
        contextWindow: 128000,
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
        contextWindow: 128000,
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
          cachedInput: 0.75,
          output: 15.0,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 256000,
      },
      {
        id: 'grok-4-0709',
        pricing: {
          input: 3.0,
          cachedInput: 0.75,
          output: 15.0,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 256000,
      },
      {
        id: 'grok-4-1-fast-reasoning',
        pricing: {
          input: 0.2,
          cachedInput: 0.05,
          output: 0.5,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 2000000,
      },
      {
        id: 'grok-4-1-fast-non-reasoning',
        pricing: {
          input: 0.2,
          cachedInput: 0.05,
          output: 0.5,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 2000000,
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
        contextWindow: 2000000,
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
        contextWindow: 2000000,
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
        contextWindow: 256000,
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
        contextWindow: 131072,
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
        contextWindow: 131072,
      },
    ],
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    description: 'Cerebras Cloud LLMs',
    defaultModel: 'cerebras/gpt-oss-120b',
    modelPatterns: [/^cerebras/],
    icon: CerebrasIcon,
    capabilities: {
      toolUsageControl: true,
    },
    models: [
      {
        id: 'cerebras/gpt-oss-120b',
        pricing: {
          input: 0.35,
          output: 0.75,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 131000,
      },
      {
        id: 'cerebras/llama3.1-8b',
        pricing: {
          input: 0.1,
          output: 0.1,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 32000,
      },
      {
        id: 'cerebras/llama-3.3-70b',
        pricing: {
          input: 0.85,
          output: 1.2,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 128000,
      },
      {
        id: 'cerebras/qwen-3-32b',
        pricing: {
          input: 0.4,
          output: 0.8,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 131000,
      },
      {
        id: 'cerebras/qwen-3-235b-a22b-instruct-2507',
        pricing: {
          input: 0.6,
          output: 1.2,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 131000,
      },
      {
        id: 'cerebras/zai-glm-4.7',
        pricing: {
          input: 2.25,
          output: 2.75,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 131000,
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
      toolUsageControl: true,
    },
    models: [
      {
        id: 'groq/openai/gpt-oss-120b',
        pricing: {
          input: 0.15,
          output: 0.6,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 131072,
      },
      {
        id: 'groq/openai/gpt-oss-20b',
        pricing: {
          input: 0.075,
          output: 0.3,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 131072,
      },
      {
        id: 'groq/openai/gpt-oss-safeguard-20b',
        pricing: {
          input: 0.075,
          output: 0.3,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 131072,
      },
      {
        id: 'groq/qwen/qwen3-32b',
        pricing: {
          input: 0.29,
          output: 0.59,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 131072,
      },
      {
        id: 'groq/llama-3.1-8b-instant',
        pricing: {
          input: 0.05,
          output: 0.08,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 131072,
      },
      {
        id: 'groq/llama-3.3-70b-versatile',
        pricing: {
          input: 0.59,
          output: 0.79,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 131072,
      },
      {
        id: 'groq/meta-llama/llama-4-scout-17b-16e-instruct',
        pricing: {
          input: 0.11,
          output: 0.34,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 131072,
      },
      {
        id: 'groq/meta-llama/llama-4-maverick-17b-128e-instruct',
        pricing: {
          input: 0.2,
          output: 0.6,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 131072,
      },
      {
        id: 'groq/gemma2-9b-it',
        pricing: {
          input: 0.04,
          output: 0.04,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 8192,
      },
      {
        id: 'groq/deepseek-r1-distill-llama-70b',
        pricing: {
          input: 0.59,
          output: 0.79,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 128000,
      },
      {
        id: 'groq/deepseek-r1-distill-qwen-32b',
        pricing: {
          input: 0.69,
          output: 0.69,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 128000,
      },
      {
        id: 'groq/moonshotai/kimi-k2-instruct-0905',
        pricing: {
          input: 1.0,
          output: 3.0,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 262144,
      },
      {
        id: 'groq/meta-llama/llama-guard-4-12b',
        pricing: {
          input: 0.2,
          output: 0.2,
          updatedAt: '2026-01-27',
        },
        capabilities: {},
        contextWindow: 131072,
      },
    ],
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    description: "Mistral AI's language models",
    defaultModel: 'mistral-large-latest',
    modelPatterns: [
      /^mistral/,
      /^magistral/,
      /^open-mistral/,
      /^codestral/,
      /^ministral/,
      /^devstral/,
    ],
    icon: MistralIcon,
    capabilities: {
      toolUsageControl: true,
    },
    models: [
      {
        id: 'mistral-large-latest',
        pricing: {
          input: 0.5,
          output: 1.5,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 256000,
      },
      {
        id: 'mistral-large-2512',
        pricing: {
          input: 0.5,
          output: 1.5,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 256000,
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
        contextWindow: 128000,
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
        contextWindow: 128000,
      },
      {
        id: 'magistral-medium-2509',
        pricing: {
          input: 2.0,
          output: 5.0,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'magistral-small-latest',
        pricing: {
          input: 0.5,
          output: 1.5,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'magistral-small-2509',
        pricing: {
          input: 0.5,
          output: 1.5,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'mistral-medium-latest',
        pricing: {
          input: 0.4,
          output: 2.0,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
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
        contextWindow: 128000,
      },
      {
        id: 'mistral-medium-2505',
        pricing: {
          input: 0.4,
          output: 2.0,
          updatedAt: '2025-05-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'mistral-small-latest',
        pricing: {
          input: 0.1,
          output: 0.3,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'mistral-small-2506',
        pricing: {
          input: 0.1,
          output: 0.3,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
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
        contextWindow: 128000,
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
        contextWindow: 256000,
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
        contextWindow: 256000,
      },
      {
        id: 'devstral-small-latest',
        pricing: {
          input: 0.1,
          output: 0.3,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'devstral-small-2507',
        pricing: {
          input: 0.1,
          output: 0.3,
          updatedAt: '2025-07-10',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'devstral-medium-2507',
        pricing: {
          input: 0.5,
          output: 1.5,
          updatedAt: '2025-07-10',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'ministral-14b-latest',
        pricing: {
          input: 0.2,
          output: 0.2,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 256000,
      },
      {
        id: 'ministral-14b-2512',
        pricing: {
          input: 0.2,
          output: 0.2,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 256000,
      },
      {
        id: 'ministral-8b-latest',
        pricing: {
          input: 0.15,
          output: 0.15,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 256000,
      },
      {
        id: 'ministral-8b-2512',
        pricing: {
          input: 0.15,
          output: 0.15,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 256000,
      },
      {
        id: 'ministral-8b-2410',
        pricing: {
          input: 0.1,
          output: 0.1,
          updatedAt: '2025-10-09',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'ministral-3b-latest',
        pricing: {
          input: 0.1,
          output: 0.1,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 256000,
      },
      {
        id: 'ministral-3b-2512',
        pricing: {
          input: 0.1,
          output: 0.1,
          updatedAt: '2025-12-02',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 256000,
      },
      {
        id: 'ministral-3b-2410',
        pricing: {
          input: 0.04,
          output: 0.04,
          updatedAt: '2025-10-09',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
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
    capabilities: {
      toolUsageControl: false, // Ollama does not support tool_choice parameter
    },
    contextInformationAvailable: false,
    models: [], // Populated dynamically
  },
  bedrock: {
    id: 'bedrock',
    name: 'AWS Bedrock',
    description: 'AWS Bedrock foundation models',
    defaultModel: 'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0',
    modelPatterns: [/^bedrock\//],
    icon: BedrockIcon,
    capabilities: {
      temperature: { min: 0, max: 1 },
      toolUsageControl: true,
    },
    models: [
      {
        id: 'bedrock/anthropic.claude-opus-4-5-20251101-v1:0',
        pricing: {
          input: 5.0,
          output: 25.0,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          nativeStructuredOutputs: true,
        },
        contextWindow: 200000,
      },
      {
        id: 'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0',
        pricing: {
          input: 3.0,
          output: 15.0,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          nativeStructuredOutputs: true,
        },
        contextWindow: 200000,
      },
      {
        id: 'bedrock/anthropic.claude-haiku-4-5-20251001-v1:0',
        pricing: {
          input: 1.0,
          output: 5.0,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          nativeStructuredOutputs: true,
        },
        contextWindow: 200000,
      },
      {
        id: 'bedrock/anthropic.claude-opus-4-1-20250805-v1:0',
        pricing: {
          input: 15.0,
          output: 75.0,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          nativeStructuredOutputs: true,
        },
        contextWindow: 200000,
      },
      {
        id: 'bedrock/amazon.nova-2-pro-v1:0',
        pricing: {
          input: 1.0,
          output: 4.0,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 1000000,
      },
      {
        id: 'bedrock/amazon.nova-2-lite-v1:0',
        pricing: {
          input: 0.08,
          output: 0.32,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 1000000,
      },
      {
        id: 'bedrock/amazon.nova-premier-v1:0',
        pricing: {
          input: 2.5,
          output: 10.0,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 1000000,
      },
      {
        id: 'bedrock/amazon.nova-pro-v1:0',
        pricing: {
          input: 0.8,
          output: 3.2,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 300000,
      },
      {
        id: 'bedrock/amazon.nova-lite-v1:0',
        pricing: {
          input: 0.06,
          output: 0.24,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 300000,
      },
      {
        id: 'bedrock/amazon.nova-micro-v1:0',
        pricing: {
          input: 0.035,
          output: 0.14,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/meta.llama4-maverick-17b-instruct-v1:0',
        pricing: {
          input: 0.24,
          output: 0.97,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 1000000,
      },
      {
        id: 'bedrock/meta.llama4-scout-17b-instruct-v1:0',
        pricing: {
          input: 0.18,
          output: 0.72,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 3500000,
      },
      {
        id: 'bedrock/meta.llama3-3-70b-instruct-v1:0',
        pricing: {
          input: 0.72,
          output: 0.72,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/meta.llama3-2-90b-instruct-v1:0',
        pricing: {
          input: 2.0,
          output: 2.0,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/meta.llama3-2-11b-instruct-v1:0',
        pricing: {
          input: 0.16,
          output: 0.16,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/meta.llama3-2-3b-instruct-v1:0',
        pricing: {
          input: 0.15,
          output: 0.15,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/meta.llama3-2-1b-instruct-v1:0',
        pricing: {
          input: 0.1,
          output: 0.1,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/meta.llama3-1-405b-instruct-v1:0',
        pricing: {
          input: 5.32,
          output: 16.0,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/meta.llama3-1-70b-instruct-v1:0',
        pricing: {
          input: 2.65,
          output: 3.5,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/meta.llama3-1-8b-instruct-v1:0',
        pricing: {
          input: 0.3,
          output: 0.6,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/mistral.mistral-large-3-675b-instruct',
        pricing: {
          input: 2.0,
          output: 6.0,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/mistral.mistral-large-2411-v1:0',
        pricing: {
          input: 2.0,
          output: 6.0,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/mistral.mistral-large-2407-v1:0',
        pricing: {
          input: 4.0,
          output: 12.0,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/mistral.pixtral-large-2502-v1:0',
        pricing: {
          input: 2.0,
          output: 6.0,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/mistral.magistral-small-2509',
        pricing: {
          input: 0.5,
          output: 1.5,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/mistral.ministral-3-14b-instruct',
        pricing: {
          input: 0.2,
          output: 0.2,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/mistral.ministral-3-8b-instruct',
        pricing: {
          input: 0.1,
          output: 0.1,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/mistral.ministral-3-3b-instruct',
        pricing: {
          input: 0.04,
          output: 0.04,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/mistral.mixtral-8x7b-instruct-v0:1',
        pricing: {
          input: 0.45,
          output: 0.7,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 32000,
      },
      {
        id: 'bedrock/amazon.titan-text-premier-v1:0',
        pricing: {
          input: 0.5,
          output: 1.5,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 32000,
      },
      {
        id: 'bedrock/cohere.command-r-plus-v1:0',
        pricing: {
          input: 3.0,
          output: 15.0,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
      {
        id: 'bedrock/cohere.command-r-v1:0',
        pricing: {
          input: 0.5,
          output: 1.5,
          updatedAt: '2026-01-07',
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
        },
        contextWindow: 128000,
      },
    ],
  },
}

export function getProviderModels(providerId: string): string[] {
  return PROVIDER_DEFINITIONS[providerId]?.models.map((m) => m.id) || []
}

export function getProviderDefaultModel(providerId: string): string {
  return PROVIDER_DEFINITIONS[providerId]?.defaultModel || ''
}

export function getModelPricing(modelId: string): ModelPricing | null {
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((m) => m.id.toLowerCase() === modelId.toLowerCase())
    if (model) {
      return model.pricing
    }
  }
  return null
}

export function getModelCapabilities(modelId: string): ModelCapabilities | null {
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((m) => m.id.toLowerCase() === modelId.toLowerCase())
    if (model) {
      const capabilities: ModelCapabilities = { ...provider.capabilities, ...model.capabilities }
      return capabilities
    }
  }

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

export function getProvidersWithToolUsageControl(): string[] {
  const providers: string[] = []
  for (const [providerId, provider] of Object.entries(PROVIDER_DEFINITIONS)) {
    if (provider.capabilities?.toolUsageControl) {
      providers.push(providerId)
    }
  }
  return providers
}

export function getHostedModels(): string[] {
  return [
    ...getProviderModels('openai'),
    ...getProviderModels('anthropic'),
    ...getProviderModels('google'),
  ]
}

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

export function supportsTemperature(modelId: string): boolean {
  const capabilities = getModelCapabilities(modelId)
  return !!capabilities?.temperature
}

export function getMaxTemperature(modelId: string): number | undefined {
  const capabilities = getModelCapabilities(modelId)
  return capabilities?.temperature?.max
}

export function supportsToolUsageControl(providerId: string): boolean {
  return getProvidersWithToolUsageControl().includes(providerId)
}

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

export function updateVLLMModels(models: string[]): void {
  PROVIDER_DEFINITIONS.vllm.models = models.map((modelId) => ({
    id: modelId,
    pricing: {
      input: 0,
      output: 0,
      updatedAt: new Date().toISOString().split('T')[0],
    },
    capabilities: {},
  }))
}

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

export function getEmbeddingModelPricing(modelId: string): ModelPricing | null {
  return EMBEDDING_MODEL_PRICING[modelId] || null
}

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
 * Get the reasoning effort values for a specific model
 * Returns the valid options for that model, or null if the model doesn't support reasoning effort
 */
export function getReasoningEffortValuesForModel(modelId: string): string[] | null {
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((m) => m.id.toLowerCase() === modelId.toLowerCase())
    if (model?.capabilities.reasoningEffort) {
      return model.capabilities.reasoningEffort.values
    }
  }
  return null
}

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

/**
 * Get the verbosity values for a specific model
 * Returns the valid options for that model, or null if the model doesn't support verbosity
 */
export function getVerbosityValuesForModel(modelId: string): string[] | null {
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((m) => m.id.toLowerCase() === modelId.toLowerCase())
    if (model?.capabilities.verbosity) {
      return model.capabilities.verbosity.values
    }
  }
  return null
}

/**
 * Check if a model supports native structured outputs.
 * Handles model IDs with date suffixes (e.g., claude-sonnet-4-5-20250514).
 */
export function supportsNativeStructuredOutputs(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()

  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.nativeStructuredOutputs) {
        const baseModelId = model.id.toLowerCase()
        // Check exact match or date-suffixed version (e.g., claude-sonnet-4-5-20250514)
        if (normalizedModelId === baseModelId || normalizedModelId.startsWith(`${baseModelId}-`)) {
          return true
        }
      }
    }
  }
  return false
}

/**
 * Check if a model supports thinking/reasoning features.
 * Returns the thinking capability config if supported, null otherwise.
 */
export function getThinkingCapability(
  modelId: string
): { levels: string[]; default?: string } | null {
  const normalizedModelId = modelId.toLowerCase()

  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.thinking) {
        const baseModelId = model.id.toLowerCase()
        if (normalizedModelId === baseModelId || normalizedModelId.startsWith(`${baseModelId}-`)) {
          return model.capabilities.thinking
        }
      }
    }
  }
  return null
}

/**
 * Get all models that support thinking capability
 */
export function getModelsWithThinking(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.thinking) {
        models.push(model.id)
      }
    }
  }
  return models
}

/**
 * Get the thinking levels for a specific model
 * Returns the valid levels for that model, or null if the model doesn't support thinking
 */
export function getThinkingLevelsForModel(modelId: string): string[] | null {
  const capability = getThinkingCapability(modelId)
  return capability?.levels ?? null
}

/**
 * Get the max output tokens for a specific model.
 *
 * @param modelId - The model ID
 */
export function getMaxOutputTokensForModel(modelId: string): number {
  const normalizedModelId = modelId.toLowerCase()
  const STANDARD_MAX_OUTPUT_TOKENS = 4096

  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      const baseModelId = model.id.toLowerCase()
      if (normalizedModelId === baseModelId || normalizedModelId.startsWith(`${baseModelId}-`)) {
        return model.capabilities.maxOutputTokens || STANDARD_MAX_OUTPUT_TOKENS
      }
    }
  }

  return STANDARD_MAX_OUTPUT_TOKENS
}
