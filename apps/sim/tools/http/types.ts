import type { HttpMethod, TableRow, ToolResponse } from '@/tools/types'

export interface RequestParams {
  url: string
  method?: HttpMethod
  headers?: TableRow[] | Record<string, unknown> | string
  body?: unknown
  params?: TableRow[] | string
  pathParams?: Record<string, string>
  formData?: Record<string, string | Blob>
  proxyUrl?: string
  timeout?: number
  retries?: number
  retryDelayMs?: number
  retryMaxDelayMs?: number
  retryNonIdempotent?: boolean
  redirectPolicyVersion?: string
  sendCredentialsOnCrossOriginRedirect?: boolean
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
