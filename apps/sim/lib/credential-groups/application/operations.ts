import { defineWorkspaceOperation } from '@/lib/core/application'

export const credentialGroupOperations = {
  listSettings: defineWorkspaceOperation({
    id: 'credential_groups.settings.list',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  create: defineWorkspaceOperation({
    id: 'credential_groups.create',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  readSettings: defineWorkspaceOperation({
    id: 'credential_groups.settings.read',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  update: defineWorkspaceOperation({
    id: 'credential_groups.update',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  delete: defineWorkspaceOperation({
    id: 'credential_groups.delete',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  inviteBatch: defineWorkspaceOperation({
    id: 'credential_groups.invites.send_batch',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  resendEnrollment: defineWorkspaceOperation({
    id: 'credential_groups.enrollments.resend',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  deleteEnrollment: defineWorkspaceOperation({
    id: 'credential_groups.enrollments.delete',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
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
