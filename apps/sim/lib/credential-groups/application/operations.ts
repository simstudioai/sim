import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/**
 * Workspace admins configure connected accounts. Copilot can read configuration
 * for the acting admin; enrollment details and setup remain session-only.
 * Workflow operations retain their enrolled-identity and resource-policy checks.
 */
export const credentialGroupOperations = {
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  workspaceSettings: defineWorkspaceOperation({
    id: 'credential_groups.workspace.read',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['copilot'],
  }),
  // permission-group-exempt: workspace account setup requires the same admin role as account settings
  ensureWorkspaceAccounts: defineWorkspaceOperation({
    id: 'credential_groups.workspace.ensure',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  readSettings: defineWorkspaceOperation({
    id: 'credential_groups.settings.read',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  update: defineWorkspaceOperation({
    id: 'credential_groups.update',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  readAccess: defineWorkspaceOperation({
    id: 'credential_groups.access.read',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  updateAccess: defineWorkspaceOperation({
    id: 'credential_groups.access.update',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  createMcpConnector: defineWorkspaceOperation({
    id: 'credential_groups.mcp_connectors.create',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  updateMcpConnector: defineWorkspaceOperation({
    id: 'credential_groups.mcp_connectors.update',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  deleteMcpConnector: defineWorkspaceOperation({
    id: 'credential_groups.mcp_connectors.delete',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  inviteBatch: defineWorkspaceOperation({
    id: 'credential_groups.invites.send_batch',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  resendEnrollment: defineWorkspaceOperation({
    id: 'credential_groups.enrollments.resend',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  deleteEnrollment: defineWorkspaceOperation({
    id: 'credential_groups.enrollments.delete',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: read by the executor to resolve an enrolled person's credential; the group's enrollment rows are the gate, and no group key names them
  listCredentials: defineWorkspaceOperation({
    id: 'credential_groups.credentials.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['delegated'],
    delegatedServices: ['executor'],
  }),
  // permission-group-exempt: read by the executor to resolve an enrolled person's MCP connection; use is enforced by the Credential Group policy
  listMcpConnections: defineWorkspaceOperation({
    id: 'credential_groups.mcp_connections.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['delegated'],
    delegatedServices: ['executor'],
  }),
  // permission-group-exempt: read by the executor to resolve an enrolled person's credential; the group's enrollment rows are the gate, and no group key names them
  listPeople: defineWorkspaceOperation({
    id: 'credential_groups.people.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['delegated'],
    delegatedServices: ['executor'],
  }),
  // permission-group-exempt: enrolls an outside person in a credential group, not a member in a workspace, so invitations.send does not name it
  sendInvite: defineWorkspaceOperation({
    id: 'credential_groups.invites.send',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['delegated'],
    delegatedServices: ['executor'],
  }),
  // permission-group-exempt: mints an enrollment link for an outside person, not a workspace invitation, so invitations.send does not name it
  createInviteLink: defineWorkspaceOperation({
    id: 'credential_groups.invites.link.create',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['delegated'],
    delegatedServices: ['executor'],
  }),
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  startSlackConfiguration: defineWorkspaceOperation({
    id: 'credential_groups.slack_configuration.start',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  completeSlackConfiguration: defineWorkspaceOperation({
    id: 'credential_groups.slack_configuration.complete',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
} as const
