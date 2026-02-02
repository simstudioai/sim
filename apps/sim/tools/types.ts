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
