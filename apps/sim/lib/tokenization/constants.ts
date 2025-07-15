/**
 * Configuration constants for tokenization functionality
 */

import type { ProviderTokenizationConfig } from '@/lib/tokenization/types'

export const TOKENIZATION_CONFIG = {
  providers: {
    openai: {
      avgCharsPerToken: 4,
      confidence: 'high',
      supportedMethods: ['heuristic', 'fallback'],
    },
    'azure-openai': {
      avgCharsPerToken: 4,
      confidence: 'high',
      supportedMethods: ['heuristic', 'fallback'],
    },
    anthropic: {
      avgCharsPerToken: 4.5,
      confidence: 'high',
      supportedMethods: ['heuristic', 'fallback'],
    },
    google: {
      avgCharsPerToken: 5,
      confidence: 'medium',
      supportedMethods: ['heuristic', 'fallback'],
    },
    deepseek: {
      avgCharsPerToken: 4,
      confidence: 'medium',
      supportedMethods: ['heuristic', 'fallback'],
    },
    xai: {
      avgCharsPerToken: 4,
      confidence: 'medium',
      supportedMethods: ['heuristic', 'fallback'],
    },
    cerebras: {
      avgCharsPerToken: 4,
      confidence: 'medium',
      supportedMethods: ['heuristic', 'fallback'],
    },
    groq: {
      avgCharsPerToken: 4,
      confidence: 'medium',
      supportedMethods: ['heuristic', 'fallback'],
    },
    ollama: {
      avgCharsPerToken: 4,
      confidence: 'low',
      supportedMethods: ['fallback'],
    },
  } satisfies Record<string, ProviderTokenizationConfig>,

  fallback: {
    avgCharsPerToken: 4,
    confidence: 'low',
    supportedMethods: ['fallback'],
  } satisfies ProviderTokenizationConfig,

  defaults: {
    model: 'gpt-4o',
    provider: 'openai',
  },
} as const

export const LLM_BLOCK_TYPES = ['agent', 'router', 'evaluator'] as const

export const MIN_TEXT_LENGTH_FOR_ESTIMATION = 1
export const MAX_PREVIEW_LENGTH = 100
