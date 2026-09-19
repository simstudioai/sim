import { type Principal, resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import type { WorkspaceFileVersionSource } from '@sim/db/schema'
import type { WorkspaceFileVersionWrite } from '@/lib/uploads/contexts/workspace/workspace-file-versions'

function versionSourceForPrincipal(principal: Principal): WorkspaceFileVersionSource {
  switch (principal.kind) {
    case 'session':
      return 'user'
    case 'personal_api_key':
    case 'oauth_access_token':
    case 'workspace_api_key':
      return 'api'
    case 'delegated':
      if (principal.serviceId === 'copilot') return 'copilot'
      if (principal.serviceId === 'executor') return 'workflow'
      if (principal.serviceId === 'realtime') return 'collab'
      return 'unknown'
    default:
      return 'unknown'
  }
}

/**
 * Records a content write under the acting user — the audit actor, never a billing owner — and
 * the surface that made it. Actorless callers such as workspace API keys record no author.
 */
export function resolveWorkspaceFileVersionWrite(
  principal: Principal,
  overrides: Partial<WorkspaceFileVersionWrite> = {}
): WorkspaceFileVersionWrite {
  return {
    source: versionSourceForPrincipal(principal),
    authorUserId: resolvePrincipalAuditAttribution(principal).actorId,
    ...overrides,
  }
}
