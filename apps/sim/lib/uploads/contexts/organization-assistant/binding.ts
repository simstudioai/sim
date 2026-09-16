import type { Principal } from '@sim/auth/principal'
import { isRecordLike } from '@sim/utils/object'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export interface OrganizationAttachmentBinding {
  organizationId: string
  userId: string
  sessionId: string
}

interface OrganizationAttachmentSession {
  purpose: string
  workspaceId: string | null
  userId: string
  metadata: Record<string, unknown>
}

/** Organization attachments remain private to their uploader across new login sessions. */
export function organizationAttachmentBinding(
  session: OrganizationAttachmentSession
): OrganizationAttachmentBinding {
  const binding = session.metadata.organizationAttachment
  if (
    session.purpose !== 'mothership_attachment' ||
    session.workspaceId !== null ||
    !isRecordLike(binding) ||
    typeof binding.organizationId !== 'string' ||
    !binding.organizationId ||
    binding.userId !== session.userId ||
    typeof binding.sessionId !== 'string' ||
    !binding.sessionId
  ) {
    throw new OrchestrationError('not_found', 'Attachment not found')
  }
  return {
    organizationId: binding.organizationId,
    userId: session.userId,
    sessionId: binding.sessionId,
  }
}

/** A byte-transfer token cannot replace the session that initiated the upload. */
export function assertOrganizationAttachmentControlBinding(
  session: OrganizationAttachmentSession,
  principal: Principal
): OrganizationAttachmentBinding {
  const binding = organizationAttachmentBinding(session)
  if (
    principal.kind !== 'session' ||
    principal.userId !== binding.userId ||
    principal.sessionId !== binding.sessionId
  ) {
    throw new OrchestrationError('not_found', 'Upload session not found')
  }
  return binding
}
