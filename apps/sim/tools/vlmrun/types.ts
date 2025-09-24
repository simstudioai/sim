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
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'
export interface ToolConfig<Params, Response> {
  id: string
  name: string
  description: string
  version: string
  provider?: string
  params: Record<string, ToolParamConfig>
  request: {  // 👈 MUST EXIST
    url: string | ((params: Params) => string)
    method: HttpMethod | ((params: Params) => HttpMethod)
    headers: (params: Params) => Record<string, string>
    body?: (params: Params) => Record<string, any>
  }
  execute: (params: Params) => Promise<Response>
}

