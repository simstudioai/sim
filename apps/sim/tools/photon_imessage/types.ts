import type { ToolResponse } from '@/tools/types'

/** Params shared by every Photon operation. */
export interface PhotonCredentialParams {
  projectId: string
  projectSecret: string
}

/** Chat addressing shared by conversation-scoped operations. */
export interface PhotonChatTargetParams {
  /** Phone number, Apple ID email, or a chat GUID from a trigger. */
  to: string
}

export interface PhotonSentOutput {
  messageId: string | null
  chatId: string
  timestamp: string | null
}

export interface PhotonSentResult extends ToolResponse {
  output: PhotonSentOutput
}

export interface PhotonImessageSendMessageParams
  extends PhotonCredentialParams,
    PhotonChatTargetParams {
  text: string
  effectName?: string
  replyToMessageId?: string
}

export interface PhotonImessageSendMediaParams
  extends PhotonCredentialParams,
    PhotonChatTargetParams {
  file?: unknown
  fileContent?: string
  filename?: string
  contentType?: string
  caption?: string
}

export interface PhotonImessageSendVoiceParams
  extends PhotonCredentialParams,
    PhotonChatTargetParams {
  file?: unknown
  fileContent?: string
  filename?: string
  contentType?: string
}

export interface PhotonImessageReactParams extends PhotonCredentialParams, PhotonChatTargetParams {
  messageId: string
  emoji: string
}

export interface PhotonImessageEditParams extends PhotonCredentialParams, PhotonChatTargetParams {
  messageId: string
  text: string
}

export interface PhotonImessageUnsendParams extends PhotonCredentialParams, PhotonChatTargetParams {
  messageId: string
}

export interface PhotonImessageCreatePollParams
  extends PhotonCredentialParams,
    PhotonChatTargetParams {
  title: string
  options: string[]
}

export interface PhotonImessageTypingParams extends PhotonCredentialParams, PhotonChatTargetParams {
  state: 'start' | 'stop'
}

export interface PhotonImessageMarkReadParams
  extends PhotonCredentialParams,
    PhotonChatTargetParams {
  messageId: string
}

export interface PhotonImessageRenameChatParams extends PhotonCredentialParams {
  chatId: string
  displayName: string
}

export interface PhotonImessageGroupAvatarParams extends PhotonCredentialParams {
  chatId: string
  file?: unknown
  fileContent?: string
  filename?: string
  contentType?: string
  clear?: boolean
}

export interface PhotonImessageParticipantParams extends PhotonCredentialParams {
  chatId: string
  handle: string
}

export interface PhotonImessageLeaveChatParams extends PhotonCredentialParams {
  chatId: string
}

export interface PhotonImessageCreateGroupParams extends PhotonCredentialParams {
  handles: string[]
  initialText?: string
}

export interface PhotonImessageGetMessageParams extends PhotonCredentialParams {
  chatId: string
  messageId: string
}

export interface PhotonImessageGroupInfoParams extends PhotonCredentialParams {
  chatId: string
}

export interface PhotonImessageDownloadAttachmentParams extends PhotonCredentialParams {
  attachmentId: string
}

export interface PhotonImessageShareContactCardParams
  extends PhotonCredentialParams,
    PhotonChatTargetParams {}

export interface PhotonImessageChatBackgroundParams
  extends PhotonCredentialParams,
    PhotonChatTargetParams {
  file?: unknown
  fileContent?: string
  filename?: string
  contentType?: string
  clear?: boolean
}

export interface PhotonChatIdResult extends ToolResponse {
  output: { chatId: string }
}

export interface PhotonMessageRefResult extends ToolResponse {
  output: { chatId: string; messageId: string }
}

export interface PhotonTypingResult extends ToolResponse {
  output: { chatId: string; state: string }
}

export interface PhotonRenameResult extends ToolResponse {
  output: { chatId: string; displayName: string }
}

export interface PhotonAvatarResult extends ToolResponse {
  output: { chatId: string; cleared: boolean }
}

export interface PhotonParticipantResult extends ToolResponse {
  output: { chatId: string; handle: string }
}

export interface PhotonMessageDetailsResult extends ToolResponse {
  output: {
    messageId: string
    chatId: string
    text: string | null
    contentType: string
    senderId: string | null
    timestamp: string | null
    attachments: Array<{ id: string | null; name: string | null; mimeType: string | null }>
  }
}

export interface PhotonGroupInfoResult extends ToolResponse {
  output: {
    chatId: string
    displayName: string | null
    members: string[]
  }
}

export interface PhotonDownloadAttachmentResult extends ToolResponse {
  output: {
    attachmentId: string
    fileName: string
    mimeType: string
    sizeBytes: number
    file: { name: string; mimeType: string; data: string }
  }
}
