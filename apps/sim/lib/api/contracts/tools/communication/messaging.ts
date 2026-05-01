import { z } from 'zod'
import { defineCommunicationToolContract } from '@/lib/api/contracts/tools/communication/shared'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

export const smsSendBodySchema = z.object({
  to: z.string().min(1, 'To phone number is required'),
  body: z.string().min(1, 'SMS body is required'),
})

export const telegramSendDocumentBodySchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
  files: RawFileInputArraySchema.optional().nullable(),
  caption: z.string().optional().nullable(),
})

export const twilioGetRecordingBodySchema = z.object({
  accountSid: z.string().min(1, 'Account SID is required'),
  authToken: z.string().min(1, 'Auth token is required'),
  recordingSid: z.string().min(1, 'Recording SID is required'),
})

export const smsSendContract = defineCommunicationToolContract(
  '/api/tools/sms/send',
  smsSendBodySchema
)
export const telegramSendDocumentContract = defineCommunicationToolContract(
  '/api/tools/telegram/send-document',
  telegramSendDocumentBodySchema
)
export const twilioGetRecordingContract = defineCommunicationToolContract(
  '/api/tools/twilio/get-recording',
  twilioGetRecordingBodySchema
)

export type SmsSendBody = ContractBodyInput<typeof smsSendContract>
export type TelegramSendDocumentBody = ContractBodyInput<typeof telegramSendDocumentContract>
export type TwilioGetRecordingBody = ContractBodyInput<typeof twilioGetRecordingContract>

export type SmsSendResponse = ContractJsonResponse<typeof smsSendContract>
export type TelegramSendDocumentResponse = ContractJsonResponse<typeof telegramSendDocumentContract>
export type TwilioGetRecordingResponse = ContractJsonResponse<typeof twilioGetRecordingContract>
