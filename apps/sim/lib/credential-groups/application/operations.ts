import { defineWorkspaceOperation } from '@/lib/core/application'

export const credentialGroupOperations = {
  listCredentials: defineWorkspaceOperation({
    id: 'credential_groups.credentials.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['executor'],
  }),
  listGroups: defineWorkspaceOperation({
    id: 'credential_groups.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['executor'],
  }),
  listPeople: defineWorkspaceOperation({
    id: 'credential_groups.people.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['executor'],
  }),
  sendInvite: defineWorkspaceOperation({
    id: 'credential_groups.invites.send',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['executor'],
  }),
  startSlackConfiguration: defineWorkspaceOperation({
    id: 'credential_groups.slack_configuration.start',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  completeSlackConfiguration: defineWorkspaceOperation({
    id: 'credential_groups.slack_configuration.complete',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
} as const
