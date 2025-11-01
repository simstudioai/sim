import type { ToolResponse } from '@/tools/types'

export interface SlackBaseParams {
  authMethod: 'oauth' | 'bot_token'
  accessToken: string
  botToken: string
}

export interface SlackMessageParams extends SlackBaseParams {
  channel: string
  text: string
  thread_ts?: string
  files?: any[]
}

export interface SlackCanvasParams extends SlackBaseParams {
  channel: string
  title: string
  content: string
  document_content?: object
}

export interface SlackMessageReaderParams extends SlackBaseParams {
  channel: string
  limit?: number
  oldest?: string
  latest?: string
}

export interface SlackDownloadParams extends SlackBaseParams {
  fileId: string
  fileName?: string
}

export interface SlackMessageResponse extends ToolResponse {
  output: {
    ts: string
    channel: string
  }
}

export interface SlackCanvasResponse extends ToolResponse {
  output: {
    canvas_id: string
    channel: string
    title: string
  }
}

export interface SlackMessageReaderResponse extends ToolResponse {
  output: {
    messages: Array<{
      ts: string
      text: string
      user: string
      type: string
      subtype?: string
    }>
  }
}

export interface SlackDownloadResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: Buffer
      size: number
    }
  }
}

export type SlackResponse =
  | SlackCanvasResponse
  | SlackMessageReaderResponse
  | SlackMessageResponse
  | SlackDownloadResponse
