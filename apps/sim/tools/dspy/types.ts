import type { ToolResponse } from '@/tools/types'

/**
 * Parameters for running a DSPy prediction
 */
export interface DSPyPredictParams {
  baseUrl: string
  apiKey?: string
  endpoint?: string
  input: string
  inputField?: string
  context?: string
  additionalInputs?: Record<string, unknown>
}

/**
 * Response from a DSPy prediction
 */
export interface DSPyPredictResponse extends ToolResponse {
  output: {
    answer: string
    reasoning: string | null
    status: string
    rawOutput: Record<string, unknown>
  }
}

/**
 * Parameters for running a DSPy Chain of Thought prediction
 */
export interface DSPyChainOfThoughtParams {
  baseUrl: string
  apiKey?: string
  endpoint?: string
  question: string
  context?: string
}

/**
 * Response from a DSPy Chain of Thought prediction
 */
export interface DSPyChainOfThoughtResponse extends ToolResponse {
  output: {
    answer: string
    reasoning: string
    status: string
    rawOutput: Record<string, unknown>
  }
}

/**
 * Parameters for running a DSPy ReAct agent
 */
export interface DSPyReActParams {
  baseUrl: string
  apiKey?: string
  endpoint?: string
  task: string
  context?: string
  maxIterations?: number
}

/**
 * ReAct trajectory step structure (matches DSPy output format)
 */
export interface DSPyTrajectoryStep {
  thought: string
  toolName: string
  toolArgs: Record<string, unknown>
  observation: string | null
}

/**
 * Response from a DSPy ReAct agent
 */
export interface DSPyReActResponse extends ToolResponse {
  output: {
    answer: string
    reasoning: string | null
    trajectory: DSPyTrajectoryStep[]
    status: string
    rawOutput: Record<string, unknown>
  }
}
