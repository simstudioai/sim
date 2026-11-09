import { canReadMemberIntegrations } from '@/lib/credential-groups/member-integrations-access'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

/**
 * Whether the organization keeps member-scoped accounts the viewer may connect: Search sources,
 * their tool permissions and Generic Secrets. Every organization lists its workspaces' apps.
 */
export function hasMemberIntegrations(organization: PlatformOrganization) {
  return canReadMemberIntegrations(organization)
}
