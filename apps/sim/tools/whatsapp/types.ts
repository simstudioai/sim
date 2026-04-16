import type { ToolResponse } from '@/tools/types'

export interface WhatsAppSendMessageParams {
  phoneNumber: string
  message: string
  phoneNumberId: string
  accessToken: string
  previewUrl?: boolean
}

export interface WhatsAppMessageContact {
  input: string
  wa_id?: string | null
}

export interface WhatsAppResponse extends ToolResponse {
  output: {
    success: boolean
    messageId?: string
    messageStatus?: string
    messagingProduct?: string
    inputPhoneNumber?: string | null
    whatsappUserId?: string | null
    contacts?: WhatsAppMessageContact[]
    error?: string
  }
}
