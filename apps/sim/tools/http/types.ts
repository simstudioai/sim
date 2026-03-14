import type { HttpMethod, TableRow, ToolResponse } from '@/tools/types'

export interface RequestParams {
  url: string
  method?: HttpMethod
  headers?: TableRow[] | string
  body?: unknown
  params?: TableRow[] | string
  pathParams?: Record<string, string>
  formData?: Record<string, string | Blob>
  timeout?: number
  retries?: number
  retryDelayMs?: number
  retryMaxDelayMs?: number
  retryNonIdempotent?: boolean
}

export interface RequestResponse extends ToolResponse {
  output: {
    data: unknown
    status: number
    headers: Record<string, string>
  }
}

export interface WebhookRequestParams {
  url: string
  body?: unknown
  secret?: string
  headers?: Record<string, string>
}
