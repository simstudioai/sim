import type { ToolResponse } from '@/tools/types'

interface WhatsAppMessageContact {
  input: string
  wa_id?: string | null
}

interface WhatsAppSendOutput {
  success: boolean
  messageId?: string
  messageStatus?: string
  messagingProduct?: string
  inputPhoneNumber?: string | null
  whatsappUserId?: string | null
  contacts?: WhatsAppMessageContact[]
  error?: string
}

/** Shared response for every outbound `/messages` send operation. */
export interface WhatsAppSendResponse extends ToolResponse {
  output: WhatsAppSendOutput
}

/** Legacy alias kept for the text send_message tool and the block output type. */
export interface WhatsAppResponse extends ToolResponse {
  output: WhatsAppSendOutput
}

export interface WhatsAppSendMessageParams {
  phoneNumber: string
  message: string
  phoneNumberId: string
  accessToken: string
  previewUrl?: boolean
}

export interface WhatsAppSendTemplateParams {
  phoneNumber: string
  templateName: string
  languageCode: string
  components?: unknown
  phoneNumberId: string
  accessToken: string
}

export type WhatsAppMediaType = 'image' | 'document' | 'video' | 'audio'

export interface WhatsAppSendMediaParams {
  phoneNumber: string
  mediaType: WhatsAppMediaType
  mediaLink?: string
  mediaId?: string
  caption?: string
  filename?: string
  phoneNumberId: string
  accessToken: string
}

export interface WhatsAppSendInteractiveParams {
  phoneNumber: string
  bodyText: string
  headerText?: string
  footerText?: string
  buttons?: unknown
  listButtonText?: string
  sections?: unknown
  phoneNumberId: string
  accessToken: string
}

export interface WhatsAppSendReactionParams {
  phoneNumber: string
  messageId: string
  emoji?: string
  phoneNumberId: string
  accessToken: string
}

export interface WhatsAppMarkReadParams {
  messageId: string
  phoneNumberId: string
  accessToken: string
}

export interface WhatsAppMarkReadResponse extends ToolResponse {
  output: {
    success: boolean
    error?: string
  }
}
