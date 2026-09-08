/**
 * All auditable actions in the platform, grouped by resource type.
 */
export const AuditAction = {
  // Accounts
  ACCOUNT_DELETED: 'account.deleted',

  // API Keys
  API_KEY_CREATED: 'api_key.created',
  API_KEY_UPDATED: 'api_key.updated',
  API_KEY_REVOKED: 'api_key.revoked',
  PERSONAL_API_KEY_CREATED: 'personal_api_key.created',
  PERSONAL_API_KEY_REVOKED: 'personal_api_key.revoked',

  // OAuth apps (Sim as the authorization server)
  OAUTH_APP_REVOKED: 'oauth_app.revoked',

  // BYOK Keys
  BYOK_KEY_CREATED: 'byok_key.created',
  BYOK_KEY_UPDATED: 'byok_key.updated',
  BYOK_KEY_DELETED: 'byok_key.deleted',

  // Chat
  CHAT_DEPLOYED: 'chat.deployed',
  CHAT_UPDATED: 'chat.updated',
  CHAT_DELETED: 'chat.deleted',
  CHAT_PASSWORD_VIEWED: 'chat.password_viewed',

  // Custom Blocks (deploy-as-block)
  CUSTOM_BLOCK_PUBLISHED: 'custom_block.published',
  CUSTOM_BLOCK_UPDATED: 'custom_block.updated',
  CUSTOM_BLOCK_DELETED: 'custom_block.deleted',

  // Custom Tools
  CUSTOM_TOOL_CREATED: 'custom_tool.created',
  CUSTOM_TOOL_UPDATED: 'custom_tool.updated',
  CUSTOM_TOOL_DELETED: 'custom_tool.deleted',

  // Data Drains
  DATA_DRAIN_CREATED: 'data_drain.created',
  DATA_DRAIN_UPDATED: 'data_drain.updated',
  DATA_DRAIN_DELETED: 'data_drain.deleted',
  DATA_DRAIN_RAN: 'data_drain.ran',
  DATA_DRAIN_TESTED: 'data_drain.tested',

  // Billing
  CREDIT_PURCHASED: 'credit.purchased',
  CREDIT_ISSUED: 'credit.issued',
  INVOICE_PAYMENT_SUCCEEDED: 'invoice.payment_succeeded',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
  OVERAGE_BILLED: 'billing.overage_billed',
  CHARGE_DISPUTE_OPENED: 'charge.dispute_opened',
  CHARGE_DISPUTE_CLOSED: 'charge.dispute_closed',

  // Subscriptions
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  SUBSCRIPTION_REFUNDED: 'subscription.refunded',
  SUBSCRIPTION_TRANSFERRED: 'subscription.transferred',
  ENTERPRISE_SUBSCRIPTION_PROVISIONED: 'subscription.enterprise_provisioned',

  // Connector Documents
  CONNECTOR_DOCUMENT_RESTORED: 'connector_document.restored',
  CONNECTOR_DOCUMENT_EXCLUDED: 'connector_document.excluded',

  // Documents
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_UPDATED: 'document.updated',
  DOCUMENT_DELETED: 'document.deleted',

  // Environment
  ENVIRONMENT_UPDATED: 'environment.updated',
  ENVIRONMENT_DELETED: 'environment.deleted',

  /**
   * Secret provenance
   *
   * Recorded when a run proceeded on data whose secret provenance nobody wrote down. The value
   * crossing into a model could not be checked against the workspace's secrets, so a secret it
   * carries would not have been redacted. Deliberately an audit entry rather than a refusal:
   * blocking the run would strand the workspace on data it can no longer read, so the risk is
   * surfaced to the people who own the secrets instead.
   */
  SECRET_PROVENANCE_UNRECORDED: 'secret_provenance.unrecorded',

  // Files
  FILE_UPLOADED: 'file.uploaded',
  FILE_UPDATED: 'file.updated',
  FILE_DELETED: 'file.deleted',
  /**
   * Irreversible destruction of a file's row and stored bytes. Deliberately not
   * a reuse of {@link FILE_DELETED}, which records the recoverable archive step.
   */
  FILE_RESTORED: 'file.restored',
  FILE_MOVED: 'file.moved',
  FILE_SHARED: 'file.shared',
  FILE_SHARE_DISABLED: 'file.share_disabled',
  FILE_DOWNLOADED: 'file.downloaded',

  // Folders
  FOLDER_CREATED: 'folder.created',
  FOLDER_UPDATED: 'folder.updated',
  FOLDER_DELETED: 'folder.deleted',
  FOLDER_MOVED: 'folder.moved',
  FOLDER_DUPLICATED: 'folder.duplicated',
  FOLDER_RESTORED: 'folder.restored',

  // Invitations
  INVITATION_ACCEPTED: 'invitation.accepted',
  INVITATION_REJECTED: 'invitation.rejected',
  INVITATION_RESENT: 'invitation.resent',
  INVITATION_REVOKED: 'invitation.revoked',
  INVITATION_UPDATED: 'invitation.updated',

  // Knowledge Base Connectors
  CONNECTOR_CREATED: 'connector.created',
  CONNECTOR_UPDATED: 'connector.updated',
  CONNECTOR_DELETED: 'connector.deleted',
  CONNECTOR_SYNCED: 'connector.synced',

  // Knowledge Bases
  KNOWLEDGE_BASE_CREATED: 'knowledge_base.created',
  KNOWLEDGE_BASE_UPDATED: 'knowledge_base.updated',
  KNOWLEDGE_BASE_DELETED: 'knowledge_base.deleted',
  KNOWLEDGE_BASE_RESTORED: 'knowledge_base.restored',

  // MCP Servers
  MCP_SERVER_ADDED: 'mcp_server.added',
  MCP_SERVER_UPDATED: 'mcp_server.updated',
  MCP_SERVER_REMOVED: 'mcp_server.removed',

  // Members
  MEMBER_INVITED: 'member.invited',
  MEMBER_ADDED: 'member.added',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_ROLE_CHANGED: 'member.role_changed',

  // OAuth / Credentials
  OAUTH_DISCONNECTED: 'oauth.disconnected',
  CREDENTIAL_CREATED: 'credential.created',
  CREDENTIAL_UPDATED: 'credential.updated',
  CREDENTIAL_RENAMED: 'credential.renamed',
  CREDENTIAL_RECONNECTED: 'credential.reconnected',
  CREDENTIAL_DELETED: 'credential.deleted',
  CREDENTIAL_ACCESSED: 'credential.accessed',
  CREDENTIAL_MEMBER_ADDED: 'credential_member.added',
  CREDENTIAL_MEMBER_REMOVED: 'credential_member.removed',
  CREDENTIAL_MEMBER_ROLE_CHANGED: 'credential_member.role_changed',
  CREDENTIAL_GROUP_UPDATED: 'credential_group.updated',

  // Password
  PASSWORD_RESET_REQUESTED: 'password.reset_requested',
  PASSWORD_RESET: 'password.reset',

  // Organizations
  ORGANIZATION_CREATED: 'organization.created',
  ORGANIZATION_UPDATED: 'organization.updated',
  ORGANIZATION_DELETED: 'organization.deleted',
  ORGANIZATION_SESSION_POLICY_UPDATED: 'organization.session_policy.updated',
  ORGANIZATION_SESSIONS_REVOKED: 'organization.sessions.revoked',
  ORGANIZATION_DOMAIN_ADDED: 'organization.domain.added',
  ORGANIZATION_DOMAIN_VERIFIED: 'organization.domain.verified',
  ORGANIZATION_DOMAIN_REMOVED: 'organization.domain.removed',
  ORG_MEMBER_ADDED: 'org_member.added',
  ORG_MEMBER_REMOVED: 'org_member.removed',
  ORG_MEMBER_ROLE_CHANGED: 'org_member.role_changed',
  ORG_MEMBER_USAGE_LIMIT_CHANGED: 'org_member.usage_limit_changed',
  ORG_INVITATION_CREATED: 'org_invitation.created',
  ORG_INVITATION_UPDATED: 'org_invitation.updated',
  ORG_INVITATION_ACCEPTED: 'org_invitation.accepted',
  ORG_INVITATION_REJECTED: 'org_invitation.rejected',
  ORG_INVITATION_CANCELLED: 'org_invitation.cancelled',
  ORG_INVITATION_REVOKED: 'org_invitation.revoked',
  ORG_INVITATION_RESENT: 'org_invitation.resent',
  ORG_SEAT_PROVISIONED: 'org_seat.provisioned',
  ORG_SEAT_DEPROVISIONED: 'org_seat.deprovisioned',
  ORG_PLAN_CONVERTED: 'org_plan.converted',

  // Permission Groups
  PERMISSION_GROUP_CREATED: 'permission_group.created',
  PERMISSION_GROUP_UPDATED: 'permission_group.updated',
  PERMISSION_GROUP_DELETED: 'permission_group.deleted',
  PERMISSION_GROUP_MEMBER_ADDED: 'permission_group_member.added',
  PERMISSION_GROUP_MEMBER_REMOVED: 'permission_group_member.removed',

  // Sandboxes
  SANDBOX_CREATED: 'sandbox.created',
  SANDBOX_UPDATED: 'sandbox.updated',
  SANDBOX_DELETED: 'sandbox.deleted',

  // Skills
  SKILL_CREATED: 'skill.created',
  SKILL_UPDATED: 'skill.updated',
  SKILL_DELETED: 'skill.deleted',
  SKILL_MEMBER_ADDED: 'skill_member.added',
  SKILL_MEMBER_REMOVED: 'skill_member.removed',

  // Schedules
  SCHEDULE_CREATED: 'schedule.created',
  SCHEDULE_UPDATED: 'schedule.updated',
  SCHEDULE_DELETED: 'schedule.deleted',

  // Tables
  TABLE_CREATED: 'table.created',
  TABLE_UPDATED: 'table.updated',
  TABLE_DELETED: 'table.deleted',
  TABLE_RESTORED: 'table.restored',
  TABLE_EXPORTED: 'table.exported',

  // Webhooks
  WEBHOOK_CREATED: 'webhook.created',
  WEBHOOK_DELETED: 'webhook.deleted',

  // Workflows
  WORKFLOW_CREATED: 'workflow.created',
  WORKFLOW_UPDATED: 'workflow.updated',
  WORKFLOW_DELETED: 'workflow.deleted',
  WORKFLOW_RESTORED: 'workflow.restored',
  WORKFLOW_DEPLOYED: 'workflow.deployed',
  WORKFLOW_UNDEPLOYED: 'workflow.undeployed',
  WORKFLOW_DUPLICATED: 'workflow.duplicated',
  WORKFLOW_DEPLOYMENT_ACTIVATED: 'workflow.deployment_activated',
  WORKFLOW_DEPLOYMENT_REVERTED: 'workflow.deployment_reverted',
  WORKFLOW_LOCKED: 'workflow.locked',
  WORKFLOW_UNLOCKED: 'workflow.unlocked',
  WORKFLOW_FORK_SYNC_EXCLUDED: 'workflow.fork_sync_excluded',
  WORKFLOW_FORK_SYNC_INCLUDED: 'workflow.fork_sync_included',
  WORKFLOW_VARIABLES_UPDATED: 'workflow.variables_updated',
  WORKFLOW_PUBLIC_API_TOGGLED: 'workflow.public_api_toggled',
  WORKFLOW_EXPORTED: 'workflow.exported',

  // Workspaces
  WORKSPACE_CREATED: 'workspace.created',
  WORKSPACE_UPDATED: 'workspace.updated',
  WORKSPACE_DELETED: 'workspace.deleted',
  WORKSPACE_DUPLICATED: 'workspace.duplicated',
  WORKSPACE_FORKED: 'workspace.forked',
  WORKSPACE_FORK_PROMOTED: 'workspace.fork_promoted',
  WORKSPACE_FORK_ROLLED_BACK: 'workspace.fork_rolled_back',
  WORKSPACE_FORK_UNLINKED: 'workspace.fork_unlinked',
  WORKSPACE_EXPORTED: 'workspace.exported',
  // SCIM directory provisioning
  SCIM_CONNECTION_ENABLED: 'scim_connection.enabled',
  SCIM_CONNECTION_DISABLED: 'scim_connection.disabled',
  SCIM_CONNECTION_SETTINGS_UPDATED: 'scim_connection.settings_updated',
  SCIM_CREDENTIAL_ISSUED: 'scim_credential.issued',
  SCIM_CREDENTIAL_REVOKED: 'scim_credential.revoked',
  SCIM_USER_PROVISIONED: 'scim_user.provisioned',
  SCIM_USER_UPDATED: 'scim_user.updated',
  SCIM_USER_DEACTIVATED: 'scim_user.deactivated',
  SCIM_USER_REACTIVATED: 'scim_user.reactivated',
  SCIM_USER_DEPROVISIONED: 'scim_user.deprovisioned',
  SCIM_GROUP_CREATED: 'scim_group.created',
  SCIM_GROUP_UPDATED: 'scim_group.updated',
  SCIM_GROUP_MEMBERSHIP_CHANGED: 'scim_group.membership_changed',
  SCIM_GROUP_DELETED: 'scim_group.deleted',
  SCIM_GROUP_MAPPING_UPSERTED: 'scim_group_mapping.upserted',
  SCIM_GROUP_MAPPING_DELETED: 'scim_group_mapping.deleted',
} as const

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction]

/**
 * All resource types that can appear in audit log entries.
 */
export const AuditResourceType = {
  ACCOUNT: 'account',
  API_KEY: 'api_key',
  BILLING: 'billing',
  BYOK_KEY: 'byok_key',
  CHAT: 'chat',
  CONNECTOR: 'connector',
  CREDENTIAL: 'credential',
  CREDENTIAL_GROUP: 'credential_group',
  CUSTOM_BLOCK: 'custom_block',
  CUSTOM_TOOL: 'custom_tool',
  DATA_DRAIN: 'data_drain',
  DOCUMENT: 'document',
  ENVIRONMENT: 'environment',
  FILE: 'file',
  FOLDER: 'folder',
  KNOWLEDGE_BASE: 'knowledge_base',
  MCP_SERVER: 'mcp_server',
  OAUTH: 'oauth',
  OAUTH_CLIENT: 'oauth_client',
  ORGANIZATION: 'organization',
  PASSWORD: 'password',
  PERMISSION_GROUP: 'permission_group',
  SANDBOX: 'sandbox',
  SCHEDULE: 'schedule',
  SCIM_CONNECTION: 'scim_connection',
  SCIM_GROUP: 'scim_group',
  /** Not a stored resource: the workspace's secrets, as the thing put at risk. */
  SECRET_PROVENANCE: 'secret_provenance',
  SKILL: 'skill',
  SUBSCRIPTION: 'subscription',
  TABLE: 'table',
  USER: 'user',
  WEBHOOK: 'webhook',
  WORKFLOW: 'workflow',
  WORKSPACE: 'workspace',
} as const

export type AuditResourceTypeValue = (typeof AuditResourceType)[keyof typeof AuditResourceType]
