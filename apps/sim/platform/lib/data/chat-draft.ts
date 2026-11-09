import type { FileAttachmentForApi } from '@/lib/mothership/chat/types'
import type { ComposerDraft } from '@/app/(product)/_components/composer/model'
import type { ChatContext } from '@/stores/panel'

/** Which of a draft's attachments go out as files, and which as resource context. */
export function draftToSend(draft: ComposerDraft): {
  files: FileAttachmentForApi[]
  contexts: ChatContext[]
} {
  const files: FileAttachmentForApi[] = []
  const contexts: ChatContext[] = []
  for (const attachment of draft.attachments) {
    if (attachment.context) contexts.push(attachment.context)
    else if (attachment.upload) files.push(attachment.upload)
  }
  return { files, contexts }
}
