export interface CerebrasMessage {
  role: string
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
  tool_call_id?: string
}

export interface CerebrasChoice {
  message: CerebrasMessage
  index: number
  finish_reason: string
}

export interface CerebrasUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface CerebrasResponse {
  id: string
  object: string
  created: number
  model: string
  choices: CerebrasChoice[]
  usage: CerebrasUsage
}
