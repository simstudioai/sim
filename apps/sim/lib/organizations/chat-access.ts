import { isChatEnabled } from '@/lib/core/config/env-flags'
import type { KnowledgeAccessAvailability } from '@/lib/knowledge/access/availability'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'

export interface OrganizationChatAccess {
  /**
   * Whether the viewer may use chat in the organization: the deployment serves chat and their
   * permission group does not withhold `copilot.use`. Role plays no part; creating a workspace from
   * a chat is judged by the workspace creation policy when it happens.
   */
  mothershipAvailable: boolean
  searchAccess: KnowledgeAccessAvailability
}

/** Projects the same current chat policy for server rendering and authenticated refreshes. */
export function projectOrganizationChatAccess({
  config,
  searchAccess,
}: {
  config: PermissionGroupConfig | null
  searchAccess: KnowledgeAccessAvailability
}): OrganizationChatAccess {
  return {
    mothershipAvailable: isChatEnabled && !capabilityDeniedBy('copilot.use', config),
    searchAccess,
  }
}
