import { AuditAction, AuditResourceType } from '@sim/audit'
import type { PeopleSyncConfig } from '@/lib/api/contracts/people-sync'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { requirePeopleEnabled } from '@/lib/people/feature-flag'
import {
  configureDirectorySync,
  disconnectDirectorySync,
  getDirectorySync,
  requestDirectorySync,
} from '@/lib/people/sync/service'

interface OrganizationInput {
  organizationId: string
}

const admin = { minimumRole: 'admin', principalKinds: ['session'] } as const
function authorizePeople<I extends OrganizationInput>({ input }: OrganizationUseCaseContext<I>) {
  return requirePeopleEnabled(input.organizationId)
}

export const getPeopleSync = defineAuthorizedOrganizationUseCase({
  // permission-group-exempt: administrators manage directory sources independently of member-directory visibility.
  operation: defineOrganizationOperation({
    id: 'organization.people.sync.get',
    capability: 'none',
    ...admin,
  }),
  authorizeResource: authorizePeople,
  async execute({ input }: OrganizationUseCaseContext<OrganizationInput>) {
    return { sync: await getDirectorySync(input.organizationId) }
  },
})

export const configurePeopleSync = defineAuthorizedOrganizationUseCase({
  // permission-group-exempt: administrators manage directory sources independently of member-directory visibility.
  operation: defineOrganizationOperation({
    id: 'organization.people.sync.configure',
    capability: 'none',
    ...admin,
  }),
  authorizeResource: authorizePeople,
  async execute({
    input,
    context,
  }: OrganizationUseCaseContext<OrganizationInput & { config: PeopleSyncConfig }>) {
    return {
      sync: await configureDirectorySync(input.organizationId, input.config, context.userId),
    }
  },
  projectAudit: ({ input }) => ({
    action: AuditAction.ORG_PEOPLE_SYNC_CONFIGURED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    description: 'Configured people directory sync',
    metadata: { source: input.config.source },
  }),
})

export const runPeopleSync = defineAuthorizedOrganizationUseCase({
  // permission-group-exempt: administrators manage directory sources independently of member-directory visibility.
  operation: defineOrganizationOperation({
    id: 'organization.people.sync.run',
    capability: 'none',
    ...admin,
  }),
  authorizeResource: authorizePeople,
  async execute({ input }: OrganizationUseCaseContext<OrganizationInput>) {
    return { sync: await requestDirectorySync(input.organizationId) }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.ORG_PEOPLE_SYNC_REQUESTED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    description: 'Requested people directory sync',
    metadata: { source: result.sync.source },
  }),
})

export const disconnectPeopleSync = defineAuthorizedOrganizationUseCase({
  // permission-group-exempt: administrators manage directory sources independently of member-directory visibility.
  operation: defineOrganizationOperation({
    id: 'organization.people.sync.disconnect',
    capability: 'none',
    ...admin,
  }),
  authorizeResource: authorizePeople,
  async execute({ input }: OrganizationUseCaseContext<OrganizationInput>) {
    await disconnectDirectorySync(input.organizationId)
    return { sync: null }
  },
  projectAudit: ({ input }) => ({
    action: AuditAction.ORG_PEOPLE_SYNC_DISCONNECTED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    description: 'Disconnected people directory sync',
  }),
})
