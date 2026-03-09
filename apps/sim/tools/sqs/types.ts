import type { ToolResponse } from '@/tools/types'

export interface SqsConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export interface SqsSendMessageParams extends SqsConnectionConfig {
  queueUrl: string
  data: Record<string, unknown>
  messageGroupId?: string | null
  messageDeduplicationId?: string | null
}

export interface SqsBaseResponse extends ToolResponse {
  output: { message: string; id?: string }
  error?: string
}

export interface SqsSendMessageResponse extends SqsBaseResponse {}
export interface SqsResponse extends SqsBaseResponse {}
