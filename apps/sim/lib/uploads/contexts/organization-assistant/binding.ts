import type { Principal } from '@sim/auth/principal'
import { isRecordLike } from '@sim/utils/object'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * Who an attachment's uploader reads it through: the organization it was uploaded in, or the
 * personal workspace its chats moved into when that organization retired. Exactly one is set.
 */
type OrganizationAttachmentHolder =
  | { organizationId: string; workspaceId: null }
  | { organizationId: null; workspaceId: string }

export type OrganizationAttachmentBinding = OrganizationAttachmentHolder & {
  requestMode: 'agent' | 'assistant' | 'plan'
  userId: string
  sessionId: string
}

interface OrganizationAttachmentSession {
  purpose: string
  workspaceId: string | null
  userId: string
  metadata: Record<string, unknown>
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
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
    binding.userId !== session.userId ||
    typeof binding.sessionId !== 'string' ||
    !binding.sessionId
  ) {
    throw new OrchestrationError('not_found', 'Attachment not found')
  }
  const { organizationId, workspaceId } = binding
  let holder: OrganizationAttachmentHolder
  if (nonEmptyString(organizationId) && workspaceId === undefined) {
    holder = { organizationId, workspaceId: null }
  } else if (nonEmptyString(workspaceId) && organizationId === undefined) {
    holder = { organizationId: null, workspaceId }
  } else {
    throw new OrchestrationError('not_found', 'Attachment not found')
  }
  return {
    ...holder,
    requestMode:
      binding.requestMode === 'plan'
        ? 'plan'
        : binding.requestMode === 'agent'
          ? 'agent'
          : 'assistant',
    userId: session.userId,
    sessionId: binding.sessionId,
  }
}

/**
 * A byte-transfer token cannot replace the session that initiated the upload, and only an upload
 * its organization still holds can be in progress: one moved to a workspace had completed.
 */
export function assertOrganizationAttachmentControlBinding(
  session: OrganizationAttachmentSession,
  principal: Principal
): OrganizationAttachmentBinding & { organizationId: string } {
  const binding = organizationAttachmentBinding(session)
  if (
    binding.organizationId === null ||
    principal.kind !== 'session' ||
    principal.userId !== binding.userId ||
    principal.sessionId !== binding.sessionId
  ) {
    throw new OrchestrationError('not_found', 'Upload session not found')
  }
  return { ...binding, organizationId: binding.organizationId }
}
