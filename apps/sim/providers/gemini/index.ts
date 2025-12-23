/**
 * Shared Gemini execution core
 *
 * This module provides the shared execution logic for both Google Gemini API
 * and Vertex AI providers. The only difference between providers is how the
 * GoogleGenAI client is configured (API key vs OAuth).
 */

export { createGeminiClient } from './client'
export { executeGeminiRequest, type GeminiExecutionConfig } from './core'
export type {
  ExecutionState,
  ForcedToolResult,
  GeminiClientConfig,
  GeminiProviderType,
  GeminiUsage,
  ParsedFunctionCall,
} from './types'
