import type { OrganizationRole } from '@/lib/api/contracts/primitives'
import type { KnowledgeAccessAvailability } from '@/lib/knowledge/access/availability'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import { canCreateOrganizationWorkspace } from '@/lib/workspaces/policy'

export interface OrganizationChatAccess {
  mothershipAvailable: boolean
  canBuild: boolean
  searchAccess: KnowledgeAccessAvailability
}

/** Projects the same current chat policy for server rendering and authenticated refreshes. */
export function projectOrganizationChatAccess({
  role,
  config,
  searchAccess,
}: {
  role: OrganizationRole
  config: PermissionGroupConfig | null
  searchAccess: KnowledgeAccessAvailability
}): OrganizationChatAccess {
  const mothershipAvailable = !capabilityDeniedBy('copilot.use', config)
  return {
    mothershipAvailable,
    canBuild: mothershipAvailable && canCreateOrganizationWorkspace(role, config),
    searchAccess,
  }
}
