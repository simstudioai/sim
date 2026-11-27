import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

const session = { principalKinds: ['session'] } as const
/**
 * The People page, Search MCP clients finding a person under the scope that admits Search, and
 * the organization Assistant under its Search delegation, bound to the member's private chat.
 */
const directoryReaders = {
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'organization_delegated'],
  oauthScope: 'search:read',
  delegationAudience: 'sim:knowledge',
  delegatedServices: ['copilot'],
  contentDelivery: 'none',
} as const

/**
 * Members read the People page, subject to the member-directory capability the use cases check;
 * administrators record the profile facts behind it.
 */
export const peopleOperations = {
  // permission-group-exempt: the application enforces organization.member_directory for ordinary members.
  list: defineOrganizationOperation({
    id: 'organization.people.list',
    minimumRole: 'member',
    capability: 'none',
    ...directoryReaders,
  }),
  // permission-group-exempt: the application enforces organization.member_directory for ordinary members.
  listDepartments: defineOrganizationOperation({
    id: 'organization.people.departments.list',
    minimumRole: 'member',
    capability: 'none',
    ...session,
  }),
  // permission-group-exempt: the application enforces organization.member_directory for ordinary members.
  chart: defineOrganizationOperation({
    id: 'organization.people.chart',
    minimumRole: 'member',
    capability: 'none',
    ...session,
  }),
  // permission-group-exempt: the application enforces organization.member_directory for ordinary members.
  get: defineOrganizationOperation({
    id: 'organization.people.get',
    minimumRole: 'member',
    capability: 'none',
    ...directoryReaders,
  }),
  // permission-group-exempt: organization administrators maintain people data independently of member-directory visibility.
  update: defineOrganizationOperation({
    id: 'organization.people.update',
    minimumRole: 'admin',
    capability: 'none',
    ...session,
  }),
  // permission-group-exempt: organization administrators maintain people data independently of member-directory visibility.
  import: defineOrganizationOperation({
    id: 'organization.people.import',
    minimumRole: 'admin',
    capability: 'none',
    ...session,
  }),
} as const
