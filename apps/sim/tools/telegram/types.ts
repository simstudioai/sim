import type { UserFile } from '@/executor/types'
import type { ToolFileData, ToolResponse } from '@/tools/types'

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

interface TelegramAuthParams {
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
  files?: UserFile[]
  caption?: string
}

export interface TelegramDeleteMessageParams extends TelegramAuthParams {
  messageId: number
}

export interface TelegramEditMessageTextParams extends TelegramAuthParams {
  messageId: number
  text: string
}

export interface TelegramForwardMessageParams extends TelegramAuthParams {
  fromChatId: string
  messageId: number
}

export interface TelegramCopyMessageParams extends TelegramAuthParams {
  fromChatId: string
  messageId: number
  caption?: string
}

export interface TelegramSendLocationParams extends TelegramAuthParams {
  latitude: number
  longitude: number
}

export interface TelegramSendContactParams extends TelegramAuthParams {
  phoneNumber: string
  firstName: string
  lastName?: string
  vcard?: string
}

export interface TelegramSendPollParams extends TelegramAuthParams {
  question: string
  options: string[]
  isAnonymous?: boolean
  allowsMultipleAnswers?: boolean
}

export interface TelegramPinMessageParams extends TelegramAuthParams {
  messageId: number
  disableNotification?: boolean
}

export interface TelegramUnpinMessageParams extends TelegramAuthParams {
  messageId?: number
}

export interface TelegramSetMessageReactionParams extends TelegramAuthParams {
  messageId: number
  reaction?: string
  isBig?: boolean
}

export interface TelegramSendChatActionParams extends TelegramAuthParams {
  action: string
}

export type TelegramGetChatParams = TelegramAuthParams

export interface TelegramGetChatMemberParams extends TelegramAuthParams {
  userId: number
}

export interface TelegramChatFullInfo {
  id: number
  type: string
  title?: string
  username?: string
  first_name?: string
  last_name?: string
  description?: string
  bio?: string
  invite_link?: string
  linked_chat_id?: number
}

export interface TelegramUser {
  id: number
  is_bot: boolean
  first_name?: string
  last_name?: string
  username?: string
}

export interface TelegramChatMember {
  status: string
  user: TelegramUser
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
    files?: ToolFileData[]
  }
}

export interface TelegramCopyMessageResponse extends ToolResponse {
  output: {
    message: string
    data?: {
      message_id: number
    }
  }
}

export interface TelegramBooleanResponse extends ToolResponse {
  output: {
    message: string
    data?: {
      ok: boolean
      result: boolean
    }
  }
}

export interface TelegramGetChatResponse extends ToolResponse {
  output: {
    message: string
    data?: TelegramChatFullInfo
  }
}

export interface TelegramGetChatMemberResponse extends ToolResponse {
  output: {
    message: string
    data?: TelegramChatMember
  }
}

export type TelegramResponse =
  | TelegramSendMessageResponse
  | TelegramSendPhotoResponse
  | TelegramSendAudioResponse
  | TelegramSendMediaResponse
  | TelegramSendDocumentResponse
  | TelegramDeleteMessageResponse
  | TelegramCopyMessageResponse
  | TelegramBooleanResponse
  | TelegramGetChatResponse
  | TelegramGetChatMemberResponse

// Legacy type for backwards compatibility
interface TelegramMessageParams {
  botToken: string
  chatId: string
  text: string
}
