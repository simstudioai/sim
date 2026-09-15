import type { SessionPrincipal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { PersistedFileAttachment } from '@/lib/mothership/chat/persisted-message'
import { AssistantImage } from '@/lib/mothership/generated/assistant'
import {
  authorizeOrganizationChatAttachment,
  readOrganizationAssistantImage,
} from '@/lib/uploads/contexts/organization-assistant/application'
import {
  ASSISTANT_IMAGE_MAX_COUNT,
  ASSISTANT_IMAGE_MAX_TOTAL_BYTES,
} from '@/lib/uploads/shared/assistant-images'
import { createFileContent } from '@/lib/uploads/utils/file-utils'

export type AssistantImageContent = AssistantImage

interface PreparedAssistantImages {
  attachments: PersistedFileAttachment[]
  content: AssistantImageContent[]
}

/** Resolves private uploads before any attachment metadata or bytes enter a chat turn. */
export async function prepareAssistantImages({
  principal,
  organizationId,
  attachments,
  signal,
}: {
  principal: SessionPrincipal
  organizationId: string
  attachments: readonly { key: string }[]
  signal?: AbortSignal
}): Promise<PreparedAssistantImages> {
  if (attachments.length > ASSISTANT_IMAGE_MAX_COUNT) {
    throw new OrchestrationError(
      'validation',
      `Attach up to ${ASSISTANT_IMAGE_MAX_COUNT} images per message`
    )
  }

  const prepared: PreparedAssistantImages = { attachments: [], content: [] }
  let totalBytes = 0
  for (const attachment of attachments) {
    signal?.throwIfAborted()
    const image = await readOrganizationAssistantImage({
      principal,
      organizationId,
      key: attachment.key,
      signal,
    })
    totalBytes += image.buffer.length
    if (totalBytes > ASSISTANT_IMAGE_MAX_TOTAL_BYTES) {
      throw new OrchestrationError('payload_too_large', 'Attached images are too large')
    }
    const content = createFileContent(image.buffer, image.contentType)
    if (content?.type !== 'image') {
      throw new OrchestrationError('validation', 'Assistant attachments must be supported images')
    }
    prepared.attachments.push({
      id: image.id,
      key: image.key,
      filename: image.name,
      media_type: image.contentType,
      size: image.size,
    })
    prepared.content.push(AssistantImage.parse({ ...content, type: 'image', filename: image.name }))
  }
  return prepared
}

/** Validate org Agent uploads without turning arbitrary files into inline model images. */
export async function prepareOrganizationChatAttachments({
  principal,
  organizationId,
  attachments,
  signal,
  mode,
}: {
  principal: SessionPrincipal
  organizationId: string
  attachments: readonly { key: string }[]
  signal?: AbortSignal
  mode: 'agent' | 'assistant'
}): Promise<PreparedAssistantImages> {
  if (mode === 'assistant')
    return prepareAssistantImages({ principal, organizationId, attachments, signal })
  const prepared: PreparedAssistantImages = { attachments: [], content: [] }
  for (const attachment of attachments) {
    signal?.throwIfAborted()
    const { session } = await authorizeOrganizationChatAttachment({
      principal,
      organizationId,
      key: attachment.key,
      signal,
    })
    prepared.attachments.push({
      id: session.id,
      key: session.finalKey,
      filename: session.fileName,
      media_type: session.contentType,
      size: session.fileSize,
    })
  }
  return prepared
}
