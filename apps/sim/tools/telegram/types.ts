import { ToolResponse } from '../types'

export interface TelegramMessageParams {
  botToken: string
  chatId: string
  text: string
}

export interface TelegramMessageResponse extends ToolResponse {
  output: {
    ok: boolean
    result: {
      message_id: number
      chat: {
        id: number
        type: string
        username: string
      }
      date: number
      text: string
    }
  }
}
