import { z } from 'zod'
import { genericToolResponseSchema } from '@/lib/api/contracts/tools/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

/**
 * Photon reaches iMessage over gRPC through the `@spectrum-ts/imessage` SDK, so every operation
 * runs in an internal route rather than as a plain HTTP request from the tool layer.
 */

const credentialsSchema = z.object({
  projectId: z.string().min(1, 'Photon project ID is required'),
  projectSecret: z.string().min(1, 'Photon project secret is required'),
})

/**
 * One target field for conversation-scoped operations: a phone number or Apple ID email (starts
 * or reuses a DM), or a chat GUID from a trigger (`;-;`/`;+;` marks it unmistakably) — the only
 * way to reach a group. The route auto-detects which form it got.
 */
const chatTargetShape = {
  to: z.string().min(1, 'Provide a phone number, email, or chat ID'),
}

/** Uploaded media arrives as an executor file reference or legacy base64 content. */
const fileInputShape = {
  file: FileInputSchema.optional().nullable(),
  fileContent: z.string().optional().nullable(),
  filename: z.string().min(1).max(1024).optional().nullable(),
  contentType: z.string().min(1).max(255).optional().nullable(),
}

const contract = <TBody extends z.ZodType>(path: string, body: TBody) =>
  defineRouteContract({
    method: 'POST',
    path,
    body,
    response: { mode: 'json', schema: genericToolResponseSchema },
  })

export const photonImessageSendBodySchema = credentialsSchema.extend({
  ...chatTargetShape,
  text: z.string().min(1, 'Message text is required'),
  effectName: z.string().min(1).optional().nullable(),
  replyToMessageId: z.string().min(1).optional().nullable(),
})

export const photonImessageSendMediaBodySchema = credentialsSchema.extend({
  ...chatTargetShape,
  ...fileInputShape,
  caption: z.string().optional().nullable(),
})

export const photonImessageSendVoiceBodySchema = credentialsSchema.extend({
  ...chatTargetShape,
  ...fileInputShape,
})

export const photonImessageReactBodySchema = credentialsSchema.extend({
  ...chatTargetShape,
  messageId: z.string().min(1, 'Message ID is required'),
  emoji: z.string().min(1, 'Emoji is required'),
})

export const photonImessageEditBodySchema = credentialsSchema.extend({
  ...chatTargetShape,
  messageId: z.string().min(1, 'Message ID is required'),
  text: z.string().min(1, 'Replacement text is required'),
})

export const photonImessageUnsendBodySchema = credentialsSchema.extend({
  ...chatTargetShape,
  messageId: z.string().min(1, 'Message ID is required'),
})

export const photonImessageCreatePollBodySchema = credentialsSchema.extend({
  ...chatTargetShape,
  title: z.string().min(1, 'Poll question is required').max(300),
  options: z
    .array(z.string().min(1))
    .min(2, 'A poll needs at least 2 options')
    .max(10, 'iMessage polls support at most 10 options'),
})

export const photonImessageTypingBodySchema = credentialsSchema.extend({
  ...chatTargetShape,
  state: z.enum(['start', 'stop']),
})

export const photonImessageMarkReadBodySchema = credentialsSchema.extend({
  ...chatTargetShape,
  messageId: z.string().min(1, 'Message ID is required'),
})

export const photonImessageRenameChatBodySchema = credentialsSchema.extend({
  chatId: z.string().min(1, 'Chat ID is required'),
  displayName: z.string().min(1, 'New chat name is required'),
})

export const photonImessageGroupAvatarBodySchema = credentialsSchema
  .extend({
    chatId: z.string().min(1, 'Chat ID is required'),
    ...fileInputShape,
    clear: z.boolean().optional().nullable(),
  })
  .refine((value) => Boolean(value.clear) || Boolean(value.file) || Boolean(value.fileContent), {
    message: 'Provide an image file, or set clear to remove the current group photo',
    path: ['file'],
  })

export const photonImessageParticipantBodySchema = credentialsSchema.extend({
  chatId: z.string().min(1, 'Chat ID is required'),
  handle: z.string().min(1, 'Participant phone number or email is required'),
})

export const photonImessageLeaveChatBodySchema = credentialsSchema.extend({
  chatId: z.string().min(1, 'Chat ID is required'),
})

export const photonImessageCreateGroupBodySchema = credentialsSchema.extend({
  handles: z.array(z.string().min(1)).min(2, 'A group chat needs at least 2 other participants'),
  initialText: z.string().optional().nullable(),
})

export const photonImessageGetMessageBodySchema = credentialsSchema.extend({
  chatId: z.string().min(1, 'Chat ID is required'),
  messageId: z.string().min(1, 'Message ID is required'),
})

export const photonImessageGroupInfoBodySchema = credentialsSchema.extend({
  chatId: z.string().min(1, 'Chat ID is required'),
})

export const photonImessageDownloadAttachmentBodySchema = credentialsSchema.extend({
  attachmentId: z.string().min(1, 'Attachment ID is required'),
})

export const photonImessageShareContactCardBodySchema = credentialsSchema.extend({
  ...chatTargetShape,
})

export const photonImessageChatBackgroundBodySchema = credentialsSchema
  .extend({
    ...chatTargetShape,
    ...fileInputShape,
    clear: z.boolean().optional().nullable(),
  })
  .refine((value) => Boolean(value.clear) || Boolean(value.file) || Boolean(value.fileContent), {
    message: 'Provide an image file, or set clear to remove the current background',
    path: ['file'],
  })

export const photonImessageSendContract = contract(
  '/api/tools/photon_imessage/send',
  photonImessageSendBodySchema
)
export const photonImessageSendMediaContract = contract(
  '/api/tools/photon_imessage/send-media',
  photonImessageSendMediaBodySchema
)
export const photonImessageSendVoiceContract = contract(
  '/api/tools/photon_imessage/send-voice',
  photonImessageSendVoiceBodySchema
)
export const photonImessageReactContract = contract(
  '/api/tools/photon_imessage/react',
  photonImessageReactBodySchema
)
export const photonImessageEditContract = contract(
  '/api/tools/photon_imessage/edit',
  photonImessageEditBodySchema
)
export const photonImessageUnsendContract = contract(
  '/api/tools/photon_imessage/unsend',
  photonImessageUnsendBodySchema
)
export const photonImessageCreatePollContract = contract(
  '/api/tools/photon_imessage/create-poll',
  photonImessageCreatePollBodySchema
)
export const photonImessageTypingContract = contract(
  '/api/tools/photon_imessage/typing',
  photonImessageTypingBodySchema
)
export const photonImessageMarkReadContract = contract(
  '/api/tools/photon_imessage/mark-read',
  photonImessageMarkReadBodySchema
)
export const photonImessageRenameChatContract = contract(
  '/api/tools/photon_imessage/rename-chat',
  photonImessageRenameChatBodySchema
)
export const photonImessageGroupAvatarContract = contract(
  '/api/tools/photon_imessage/group-avatar',
  photonImessageGroupAvatarBodySchema
)
export const photonImessageAddParticipantContract = contract(
  '/api/tools/photon_imessage/add-participant',
  photonImessageParticipantBodySchema
)
export const photonImessageRemoveParticipantContract = contract(
  '/api/tools/photon_imessage/remove-participant',
  photonImessageParticipantBodySchema
)
export const photonImessageLeaveChatContract = contract(
  '/api/tools/photon_imessage/leave-chat',
  photonImessageLeaveChatBodySchema
)
export const photonImessageCreateGroupContract = contract(
  '/api/tools/photon_imessage/create-group',
  photonImessageCreateGroupBodySchema
)
export const photonImessageGetMessageContract = contract(
  '/api/tools/photon_imessage/get-message',
  photonImessageGetMessageBodySchema
)
export const photonImessageGroupInfoContract = contract(
  '/api/tools/photon_imessage/group-info',
  photonImessageGroupInfoBodySchema
)
export const photonImessageDownloadAttachmentContract = contract(
  '/api/tools/photon_imessage/download-attachment',
  photonImessageDownloadAttachmentBodySchema
)
export const photonImessageShareContactCardContract = contract(
  '/api/tools/photon_imessage/share-contact-card',
  photonImessageShareContactCardBodySchema
)
export const photonImessageChatBackgroundContract = contract(
  '/api/tools/photon_imessage/chat-background',
  photonImessageChatBackgroundBodySchema
)
