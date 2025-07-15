import type { OAuthService } from '@/lib/oauth/oauth'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

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
  additionalScopes?: string[] // Additional scopes required for the tool
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
    }
  >

  // OAuth configuration for this tool (if it requires authentication)
  oauth?: OAuthConfig

  // Request configuration
  request: {
    url: string | ((params: P) => string)
    method: string
    headers: (params: P) => Record<string, string>
    body?: (params: P) => Record<string, any>
    isInternalRoute?: boolean // Whether this is an internal API route
  }

  // Direct execution in browser (optional) - bypasses HTTP request
  directExecution?: (params: P) => Promise<R | undefined>

  // Post-processing (optional) - allows additional processing after the initial request
  postProcess?: (
    result: R extends ToolResponse ? R : ToolResponse,
    params: P,
    executeTool: (toolId: string, params: Record<string, any>) => Promise<ToolResponse>
  ) => Promise<R extends ToolResponse ? R : ToolResponse>

  // Response handling
  transformResponse?: (response: Response, params?: P) => Promise<R>
  transformError?: (error: any) => string | Promise<R>
}

export interface TableRow {
  id: string
  cells: {
    Key: string
    Value: any
  }
}

export interface OAuthTokenPayload {
  credentialId: string
  workflowId?: string
}
