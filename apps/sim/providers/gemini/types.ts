import type { Content, ToolConfig } from '@google/genai'
import type { FunctionCallResponse, ModelPricing, TimeSegment } from '@/providers/types'

/**
 * Usage metadata from Gemini responses
 */
export interface GeminiUsage {
  promptTokenCount: number
  candidatesTokenCount: number
  totalTokenCount: number
}

/**
 * Parsed function call from Gemini response
 */
export interface ParsedFunctionCall {
  name: string
  args: Record<string, unknown>
}

/**
 * Accumulated state during tool execution loop
 */
export interface ExecutionState {
  contents: Content[]
  tokens: { input: number; output: number; total: number }
  cost: { input: number; output: number; total: number; pricing: ModelPricing }
  toolCalls: FunctionCallResponse[]
  toolResults: Record<string, unknown>[]
  iterationCount: number
  modelTime: number
  toolsTime: number
  timeSegments: TimeSegment[]
  usedForcedTools: string[]
  currentToolConfig: ToolConfig | undefined
}

/**
 * Result from forced tool usage check
 */
export interface ForcedToolResult {
  hasUsedForcedTool: boolean
  usedForcedTools: string[]
  nextToolConfig: ToolConfig | undefined
}

/**
 * Configuration for creating a Gemini client
 */
export interface GeminiClientConfig {
  /** For Google Gemini API */
  apiKey?: string
  /** For Vertex AI */
  vertexai?: boolean
  project?: string
  location?: string
  /** OAuth access token for Vertex AI */
  accessToken?: string
}

/**
 * Provider type for logging and model lookup
 */
export type GeminiProviderType = 'google' | 'vertex'
