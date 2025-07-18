import type { ToolResponse } from '../types'

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

export interface SlackMessageResponse extends ToolResponse {
  output: {
    ts: string
    channel: string
  }
}

export type SlackResponse = SlackMessageResponse
