import type { ToolResponse } from '../types'

export interface SlackMessageParams {
  apiKey: string
  channel: string
  text: string
}

export interface SlackMessageResponse extends ToolResponse {
  output: {
    ts: string
    channel: string
  }
}
