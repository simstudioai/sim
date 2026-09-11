import type { Principal } from '@sim/auth/principal'
import { isRecordLike } from '@sim/utils/object'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export interface OrganizationLogoBinding {
  organizationId: string
  userId: string
  sessionId: string
}

interface OrganizationLogoSession {
  purpose: string
  workspaceId: string | null
  userId: string
  metadata: Record<string, unknown>
}

/** The upload's organization and credential are immutable server-authored scope. */
export function assertOrganizationLogoControlBinding(
  session: OrganizationLogoSession,
  principal: Principal
): OrganizationLogoBinding {
  const binding = session.metadata.organizationLogo
  if (
    session.purpose !== 'organization_logo' ||
    session.workspaceId !== null ||
    !isRecordLike(binding) ||
    typeof binding.organizationId !== 'string' ||
    !binding.organizationId ||
    binding.userId !== session.userId ||
    principal.kind !== 'session' ||
    principal.userId !== binding.userId ||
    principal.sessionId !== binding.sessionId
  ) {
    throw new OrchestrationError('not_found', 'Upload session not found')
  }
  return {
    organizationId: binding.organizationId,
    userId: principal.userId,
    sessionId: principal.sessionId,
  }
}
