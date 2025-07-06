/**
 * Type definitions for tokenization functionality
 */

export interface TokenEstimate {
  /** Estimated number of tokens */
  count: number
  /** Confidence level of the estimation */
  confidence: 'high' | 'medium' | 'low'
  /** Provider used for estimation */
  provider: string
  /** Method used for estimation */
  method: 'precise' | 'heuristic' | 'fallback'
}

export interface TokenUsage {
  /** Number of prompt/input tokens */
  prompt: number
  /** Number of completion/output tokens */
  completion: number
  /** Total number of tokens */
  total: number
}

export interface CostBreakdown {
  /** Input cost in USD */
  input: number
  /** Output cost in USD */
  output: number
  /** Total cost in USD */
  total: number
}

export interface StreamingCostResult {
  /** Token usage breakdown */
  tokens: TokenUsage
  /** Cost breakdown */
  cost: CostBreakdown
  /** Model used for calculation */
  model: string
  /** Provider ID */
  provider: string
  /** Estimation method used */
  method: 'tokenization' | 'provider_response'
}

export interface TokenizationInput {
  /** Primary input text */
  inputText: string
  /** Generated output text */
  outputText: string
  /** Model identifier */
  model: string
  /** Optional system prompt */
  systemPrompt?: string
  /** Optional context */
  context?: string
  /** Optional message history */
  messages?: Array<{ role: string; content: string }>
}

export interface ProviderTokenizationConfig {
  /** Average characters per token for this provider */
  avgCharsPerToken: number
  /** Confidence level for this provider's estimation */
  confidence: TokenEstimate['confidence']
  /** Supported token estimation methods */
  supportedMethods: TokenEstimate['method'][]
}
