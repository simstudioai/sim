import type { ToolResponse } from '@/tools/types'

export interface ClayPopulateParams {
  webhookURL: string
  data: JSON
  authToken?: string
}

export interface ClayPopulateResponse extends ToolResponse {
  output: {
    data: any
    metadata: {
      status: number
      statusText: string
      headers: Record<string, string>
      timestamp: string
      contentType: string
    }
  }
}
