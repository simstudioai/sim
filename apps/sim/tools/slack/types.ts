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

export interface SlackUpdateMessageParams extends SlackBaseParams {
  channel: string
  timestamp: string
  text: string
}

export interface SlackDeleteMessageParams extends SlackBaseParams {
  channel: string
  timestamp: string
}

export interface SlackAddReactionParams extends SlackBaseParams {
  channel: string
  timestamp: string
  name: string
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
      files?: Array<{
        id: string
        name: string
        mimetype: string
        size: number
        url_private?: string
      }>
    }>
  }
}

export interface SlackDownloadResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: Buffer | string // Buffer for direct use, string for base64-encoded data
      size: number
    }
  }
}

export interface SlackUpdateMessageResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      channel: string
      timestamp: string
      text: string
    }
  }
}

export interface SlackDeleteMessageResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      channel: string
      timestamp: string
    }
  }
}

export interface SlackAddReactionResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      channel: string
      timestamp: string
      reaction: string
    }
  }
}

export type SlackResponse =
  | SlackCanvasResponse
  | SlackMessageReaderResponse
  | SlackMessageResponse
  | SlackDownloadResponse
  | SlackUpdateMessageResponse
  | SlackDeleteMessageResponse
  | SlackAddReactionResponse
