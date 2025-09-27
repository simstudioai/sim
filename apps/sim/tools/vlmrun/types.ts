export type VlmRunParams = {
  apiKey: string
  filePath: string
}

export type VlmRunResponse = {
  data: Record<string, any> | null
  success: boolean
  output: Record<string, any>
  error?: string
}

export interface ToolParamConfig {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required: boolean
  visibility: 'user-only' | 'user-or-llm' | 'llm-only'
  description: string
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
