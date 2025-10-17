import type { ToolResponse } from '@/tools/types'

export interface TelegramMessage {
  message_id: number
  from: {
    id: number
    is_bot: boolean
    first_name?: string
    username?: string
  }
  chat?: {
    id: number
    first_name?: string
    username?: string
    type?: string
  }
  date: number
  text?: string
}

export interface TelegramAudio extends TelegramMessage {
  voice: {
    duration: 2
    mime_type: string
    file_id: string
    file_unique_id: string
    file_size: number
  }
}

export interface TelegramPhoto extends TelegramMessage {
  photo?: {
    file_id: string
    file_unique_id: string
    file_size: number
    width: number
    height: number
  }
}

export interface TelegramMedia extends TelegramMessage {
  format?: {
    file_name: string
    mime_type: string
    duration: number
    width: number
    height: number
    thumbnail: {
      file_id: string
      file_unique_id: string
      file_size: number
      width: number
      height: number
    }
    thumb: {
      file_id: string
      file_unique_id: string
      file_size: number
      width: number
      height: number
    }
    file_id: string
    file_unique_id: string
    file_size: number
  }
  document?: {
    file_name: string
    mime_type: string
    thumbnail: {
      file_id: string
      file_unique_id: string
      file_size: number
      width: number
      height: number
    }
    thumb: {
      file_id: string
      file_unique_id: string
      file_size: number
      width: number
      height: number
    }
    file_id: string
    file_unique_id: string
    file_size: number
  }
}

export interface TelegramAuthParams {
  botToken: string
  chatId: string
}

export interface TelegramSendMessageParams extends TelegramAuthParams {
  text: string
}

export interface TelegramSendPhotoParams extends TelegramAuthParams {
  photo: string
  caption?: string
}

export interface TelegramSendVideoParams extends TelegramAuthParams {
  video: string
  caption?: string
}

export interface TelegramSendAudioParams extends TelegramAuthParams {
  audio: string
  caption?: string
}

export interface TelegramSendAnimationParams extends TelegramAuthParams {
  animation: string
  caption?: string
}

export interface TelegramSendDocumentParams extends TelegramAuthParams {
  files?: any
  caption?: string
}

export interface TelegramDeleteMessageParams extends TelegramAuthParams {
  messageId: number
}

export interface TelegramSendMessageResponse extends ToolResponse {
  output: {
    message: string
    data?: TelegramMessage
  }
}

export interface TelegramSendMediaResponse extends ToolResponse {
  output: {
    message: string
    data?: TelegramMedia
  }
}

export interface TelegramSendAudioResponse extends ToolResponse {
  output: {
    message: string
    data?: TelegramAudio
  }
}

export interface TelegramDeleteMessageResponse extends ToolResponse {
  output: {
    message: string
    data?: {
      ok: boolean
      deleted: boolean
    }
  }
}

export interface TelegramSendPhotoResponse extends ToolResponse {
  output: {
    message: string
    data?: TelegramPhoto
  }
}

export interface TelegramSendDocumentResponse extends ToolResponse {
  output: {
    message: string
    data?: TelegramMedia
  }
}

export type TelegramResponse =
  | TelegramSendMessageResponse
  | TelegramSendPhotoResponse
  | TelegramSendAudioResponse
  | TelegramSendMediaResponse
  | TelegramSendDocumentResponse
  | TelegramDeleteMessageResponse

// Legacy type for backwards compatibility
export interface TelegramMessageParams {
  botToken: string
  chatId: string
  text: string
}
