import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/**
 * Credential groups collect OAuth credentials from people outside the workspace
 * so a workflow can act as them — a distinct, entitlement-gated settings
 * section, not part of the Integrations tab.
 *
 * None of them declares a capability. `integrations.manage` names the
 * Integrations tab, where a member connects their own accounts, and
 * `credentials.personal` withholds exactly that; both describe a member acting
 * for themselves, which is the opposite of this section. Every operation here
 * already requires workspace `admin`, and the executor-delegated reads run
 * inside a workflow whose credential access is decided by the group's own
 * enrollment rows. Borrowing a key that names a different surface would make
 * hiding the Integrations tab silently disable an unrelated admin section.
 */
export const credentialGroupOperations = {
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  listSettings: defineWorkspaceOperation({
    id: 'credential_groups.settings.list',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
  // permission-group-exempt: workspace admin already decides this, and no group key names the credential-groups section
  create: defineWorkspaceOperation({
    id: 'credential_groups.create',
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
  delete: defineWorkspaceOperation({
    id: 'credential_groups.delete',
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
  listGroups: defineWorkspaceOperation({
    id: 'credential_groups.list',
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
