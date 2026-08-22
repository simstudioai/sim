import { z } from 'zod'
import { defineCommunicationToolContract } from '@/lib/api/contracts/tools/communication/shared'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { FileInputSchema, RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

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

export const linqUploadAttachmentBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  file: FileInputSchema.optional().nullable(),
  fileContent: z.string().optional().nullable(),
  filename: z.string().min(1).max(1024).optional().nullable(),
  contentType: z.string().min(1).max(255).optional().nullable(),
})

/**
 * Photon reaches iMessage over gRPC through the `@spectrum-ts/imessage` SDK, so the send runs in an
 * internal route rather than as a plain HTTP request from the tool. Exactly one of `to` (an address
 * that starts or reuses a DM) or `chatId` (an existing chat GUID) must be supplied; they are
 * alternate ways to name the target, not a basic/advanced pair.
 */
export const photonImessageSendBodySchema = z
  .object({
    projectId: z.string().min(1, 'Photon project ID is required'),
    projectSecret: z.string().min(1, 'Photon project secret is required'),
    to: z.string().min(1).optional().nullable(),
    chatId: z.string().min(1).optional().nullable(),
    text: z.string().min(1, 'Message text is required'),
  })
  .refine((value) => Boolean(value.to) !== Boolean(value.chatId), {
    message: 'Provide exactly one of "to" (phone number or email) or "chatId" (existing chat GUID)',
    path: ['to'],
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
export const linqUploadAttachmentContract = defineCommunicationToolContract(
  '/api/tools/linq/upload',
  linqUploadAttachmentBodySchema
)
export const photonImessageSendContract = defineCommunicationToolContract(
  '/api/tools/photon_imessage/send',
  photonImessageSendBodySchema
)

export type SmsSendBody = ContractBodyInput<typeof smsSendContract>
export type TelegramSendDocumentBody = ContractBodyInput<typeof telegramSendDocumentContract>
export type TwilioGetRecordingBody = ContractBodyInput<typeof twilioGetRecordingContract>
export type LinqUploadAttachmentBody = ContractBodyInput<typeof linqUploadAttachmentContract>
export type PhotonImessageSendBody = ContractBodyInput<typeof photonImessageSendContract>

export type SmsSendResponse = ContractJsonResponse<typeof smsSendContract>
export type TelegramSendDocumentResponse = ContractJsonResponse<typeof telegramSendDocumentContract>
export type TwilioGetRecordingResponse = ContractJsonResponse<typeof twilioGetRecordingContract>
export type LinqUploadAttachmentResponse = ContractJsonResponse<typeof linqUploadAttachmentContract>
export type PhotonImessageSendResponse = ContractJsonResponse<typeof photonImessageSendContract>
