import { canReadMemberIntegrations } from '@/lib/credential-groups/member-integrations-access'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

/**
 * Which Integrations page an organization serves its viewer. `member`: the organization's
 * member-scoped accounts, Search sources, Generic Secrets and per-account tool permissions, where
 * Enterprise member access and connected accounts are on and the viewer may connect. `workspace`:
 * every other organization, personal ones included, manages the viewer's workspace credentials and
 * skills one workspace at a time, as legacy's workspace Integrations page did. Only `member` serves
 * the member-scoped pages beneath Integrations.
 */
export function integrationsMode(organization: PlatformOrganization): 'member' | 'workspace' {
  return canReadMemberIntegrations(organization) ? 'member' : 'workspace'
}
