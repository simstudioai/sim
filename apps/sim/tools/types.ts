import type { OAuthService } from '@/lib/oauth'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'

export type OutputType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'file'
  | 'file[]'
  | 'array'
  | 'object'

export interface OutputProperty {
  type: OutputType
  description?: string
  optional?: boolean
  properties?: Record<string, OutputProperty>
  items?: {
    type: OutputType
    description?: string
    properties?: Record<string, OutputProperty>
  }
}

export type ParameterVisibility =
  | 'user-or-llm' // User can provide OR LLM must generate
  | 'user-only' // Only user can provide (required/optional determined by required field)
  | 'llm-only' // Only LLM provides (computed values)
  | 'hidden' // Not shown to user or LLM

export interface ToolResponse {
  success: boolean // Whether the tool execution was successful
  output: Record<string, any> // The structured output from the tool
  error?: string // Error message if success is false
  timing?: {
    startTime: string // ISO timestamp when the tool execution started
    endTime: string // ISO timestamp when the tool execution ended
    duration: number // Duration in milliseconds
  }
}

export interface OAuthConfig {
  required: boolean // Whether this tool requires OAuth authentication
  provider: OAuthService // The service that needs to be authorized
  requiredScopes?: string[] // Specific scopes this tool needs (for granular scope validation)
}

export interface ToolConfig<P = any, R = any> {
  // Basic tool identification
  id: string
  name: string
  description: string
  version: string

  // Parameter schema - what this tool accepts
  params: Record<
    string,
    {
      type: string
      required?: boolean
      visibility?: ParameterVisibility
      default?: any
      description?: string
      items?: {
        type: string
        description?: string
        properties?: Record<string, { type: string; description?: string }>
      }
    }
  >

  outputs?: Record<
    string,
    {
      type: OutputType
      description?: string
      optional?: boolean
      fileConfig?: {
        mimeType?: string
        extension?: string
      }
      items?: {
        type: OutputType
        description?: string
        properties?: Record<string, OutputProperty>
      }
      properties?: Record<string, OutputProperty>
    }
  >

  // OAuth configuration for this tool (if it requires authentication)
  oauth?: OAuthConfig

  // Error extractor to use for this tool's error responses
  // If specified, only this extractor will be used (deterministic)
  // If not specified, will try all extractors in order (fallback)
  errorExtractor?: string

  // Request configuration
  request: {
    url: string | ((params: P) => string)
    method: HttpMethod | ((params: P) => HttpMethod)
    headers: (params: P) => Record<string, string>
    body?: (params: P) => Record<string, any> | string | FormData | undefined
  }

  // Post-processing (optional) - allows additional processing after the initial request
  postProcess?: (
    result: R extends ToolResponse ? R : ToolResponse,
    params: P,
    executeTool: (toolId: string, params: Record<string, any>) => Promise<ToolResponse>
  ) => Promise<R extends ToolResponse ? R : ToolResponse>

  // Response handling
  transformResponse?: (response: Response, params?: P) => Promise<R>

  /**
   * Direct execution function for tools that don't need HTTP requests.
   * If provided, this will be called instead of making an HTTP request.
   */
  directExecution?: (params: P) => Promise<ToolResponse>

  /**
   * Optional dynamic schema enrichment for specific params.
   * Maps param IDs to their enrichment configuration.
   */
  schemaEnrichment?: Record<string, SchemaEnrichmentConfig>

  /**
   * Hosted API key configuration for this tool.
   * When configured, the tool can use Sim's hosted API keys if user doesn't provide their own.
   * Usage is billed according to the pricing config.
   */
  hosting?: ToolHostingConfig
}

export interface TableRow {
  id: string
  cells: {
    Key: string
    Value: any
  }
}

export interface OAuthTokenPayload {
  credentialId?: string
  credentialAccountUserId?: string
  providerId?: string
  workflowId?: string
}

/**
 * File data that tools can return for file-typed outputs
 */
export interface ToolFileData {
  name: string
  mimeType: string
  data?: Buffer | string // Buffer or base64 string
  url?: string // URL to download file from
  size?: number
}

/**
 * Configuration for dynamically enriching a parameter's schema at runtime.
 * Used when a parameter's schema depends on runtime values (e.g., KB tags, workflow inputs).
 */
export interface SchemaEnrichmentConfig {
  /** The param ID that this enrichment depends on (e.g., 'knowledgeBaseId', 'workflowId') */
  dependsOn: string
  /** Function to fetch and build dynamic schema based on the dependency value */
  enrichSchema: (dependencyValue: string) => Promise<{
    type: string
    properties?: Record<string, { type: string; description?: string }>
    description?: string
    required?: string[]
  } | null>
}

/**
 * Pricing models for hosted API key usage
 */
/** Flat fee per API call (e.g., Serper search) */
export interface PerRequestPricing {
  type: 'per_request'
  /** Cost per request in dollars */
  cost: number
}

/** Usage-based on input/output size (e.g., LLM tokens, TTS characters) */
export interface PerUnitPricing {
  type: 'per_unit'
  /** Cost per unit in dollars */
  costPerUnit: number
  /** Unit of measurement */
  unit: 'token' | 'character' | 'byte' | 'kb' | 'mb'
  /** Extract usage count from params (before execution) or response (after execution) */
  getUsage: (params: Record<string, unknown>, response?: Record<string, unknown>) => number
}

/** Based on result count (e.g., per search result, per email sent) */
export interface PerResultPricing {
  type: 'per_result'
  /** Cost per result in dollars */
  costPerResult: number
  /** Maximum results to bill for (cap) */
  maxResults?: number
  /** Extract result count from response */
  getResultCount: (response: Record<string, unknown>) => number
}

/** Billed by execution duration (e.g., browser sessions, video processing) */
export interface PerSecondPricing {
  type: 'per_second'
  /** Cost per second in dollars */
  costPerSecond: number
  /** Minimum billable seconds */
  minimumSeconds?: number
  /** Extract duration from response (in seconds) */
  getDuration: (response: Record<string, unknown>) => number
}

/** Union of all pricing models */
export type ToolHostingPricing = PerRequestPricing | PerUnitPricing | PerResultPricing | PerSecondPricing

/**
 * Configuration for hosted API key support
 * When configured, the tool can use Sim's hosted API keys if user doesn't provide their own
 */
export interface ToolHostingConfig {
  /** Environment variable names to check for hosted keys (supports rotation with multiple keys) */
  envKeys: string[]
  /** The parameter name that receives the API key */
  apiKeyParam: string
  /** BYOK provider ID for workspace key lookup (e.g., 'serper') */
  byokProviderId?: string
  /** Pricing when using hosted key */
  pricing: ToolHostingPricing
}
