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

export type SlackResponse = SlackCanvasResponse | SlackMessageReaderResponse | SlackMessageResponse
