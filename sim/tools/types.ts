import { OAuthService } from '@/lib/oauth'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

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

export interface ToolConfig<TParams = any, TResponse = any> {
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
      requiredForToolCall?: boolean
      optionalToolInput?: boolean
      default?: any
      description?: string
    }
  >

  // OAuth configuration for this tool (if it requires authentication)
  oauth?: OAuthConfig

  // Request configuration
  request: {
    url: string | ((params: TParams) => string)
    method?: string
    headers?: (params: TParams) => Record<string, string>
    body?: (params: TParams) => any
    isInternalRoute?: boolean // Whether this is an internal API route
  }

  // Direct execution in browser (optional) - bypasses HTTP request
  directExecution?: (params: TParams) => Promise<TResponse | undefined>

  // Post-processing (optional) - allows additional processing after the initial request
  postProcess?: (
    result: TResponse extends ToolResponse ? TResponse : ToolResponse,
    params: TParams,
    executeTool: (toolId: string, params: Record<string, any>) => Promise<ToolResponse>
  ) => Promise<TResponse extends ToolResponse ? TResponse : ToolResponse>

  // Response handling
  transformResponse?: (response: Response, params: TParams) => Promise<TResponse>
  transformError?: (error: any) => string | Promise<TResponse>

  // Test function
  test?: (params: TParams) => Promise<{ success: boolean; error?: string }>
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
