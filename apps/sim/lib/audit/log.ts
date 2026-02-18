import { auditLog, db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { nanoid } from 'nanoid'

const logger = createLogger('AuditLog')

/**
 * All auditable actions in the platform, grouped by resource type.
 */
export const AuditAction = {
  // API Keys
  API_KEY_CREATED: 'api_key.created',
  API_KEY_UPDATED: 'api_key.updated',
  API_KEY_REVOKED: 'api_key.revoked',
  PERSONAL_API_KEY_CREATED: 'personal_api_key.created',
  PERSONAL_API_KEY_REVOKED: 'personal_api_key.revoked',

  // BYOK Keys
  BYOK_KEY_CREATED: 'byok_key.created',
  BYOK_KEY_DELETED: 'byok_key.deleted',

  // Chat
  CHAT_DEPLOYED: 'chat.deployed',
  CHAT_UPDATED: 'chat.updated',
  CHAT_DELETED: 'chat.deleted',

  // Credential Sets
  CREDENTIAL_SET_CREATED: 'credential_set.created',
  CREDENTIAL_SET_UPDATED: 'credential_set.updated',
  CREDENTIAL_SET_DELETED: 'credential_set.deleted',
  CREDENTIAL_SET_MEMBER_REMOVED: 'credential_set_member.removed',
  CREDENTIAL_SET_INVITATION_CREATED: 'credential_set_invitation.created',
  CREDENTIAL_SET_INVITATION_REVOKED: 'credential_set_invitation.revoked',

  // Documents
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_UPDATED: 'document.updated',
  DOCUMENT_DELETED: 'document.deleted',

  // Environment
  ENVIRONMENT_UPDATED: 'environment.updated',

  // Files
  FILE_UPLOADED: 'file.uploaded',
  FILE_DELETED: 'file.deleted',

  // Folders
  FOLDER_CREATED: 'folder.created',
  FOLDER_DELETED: 'folder.deleted',
  FOLDER_DUPLICATED: 'folder.duplicated',

  // Forms
  FORM_CREATED: 'form.created',
  FORM_UPDATED: 'form.updated',
  FORM_DELETED: 'form.deleted',

  // Invitations
  INVITATION_ACCEPTED: 'invitation.accepted',
  INVITATION_REVOKED: 'invitation.revoked',

  // Knowledge Bases
  KNOWLEDGE_BASE_CREATED: 'knowledge_base.created',
  KNOWLEDGE_BASE_UPDATED: 'knowledge_base.updated',
  KNOWLEDGE_BASE_DELETED: 'knowledge_base.deleted',

  // MCP Servers
  MCP_SERVER_ADDED: 'mcp_server.added',
  MCP_SERVER_UPDATED: 'mcp_server.updated',
  MCP_SERVER_REMOVED: 'mcp_server.removed',

  // Members
  MEMBER_INVITED: 'member.invited',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_ROLE_CHANGED: 'member.role_changed',

  // Notifications
  NOTIFICATION_CREATED: 'notification.created',
  NOTIFICATION_UPDATED: 'notification.updated',
  NOTIFICATION_DELETED: 'notification.deleted',

  // OAuth
  OAUTH_DISCONNECTED: 'oauth.disconnected',

  // Organizations
  ORGANIZATION_CREATED: 'organization.created',
  ORGANIZATION_UPDATED: 'organization.updated',
  ORG_MEMBER_ADDED: 'org_member.added',
  ORG_MEMBER_REMOVED: 'org_member.removed',
  ORG_MEMBER_ROLE_CHANGED: 'org_member.role_changed',
  ORG_INVITATION_CREATED: 'org_invitation.created',
  ORG_INVITATION_ACCEPTED: 'org_invitation.accepted',
  ORG_INVITATION_UPDATED: 'org_invitation.updated',
  ORG_INVITATION_REVOKED: 'org_invitation.revoked',

  // Permission Groups
  PERMISSION_GROUP_CREATED: 'permission_group.created',
  PERMISSION_GROUP_UPDATED: 'permission_group.updated',
  PERMISSION_GROUP_DELETED: 'permission_group.deleted',
  PERMISSION_GROUP_MEMBER_ADDED: 'permission_group_member.added',
  PERMISSION_GROUP_MEMBER_REMOVED: 'permission_group_member.removed',

  // Schedules
  SCHEDULE_UPDATED: 'schedule.updated',

  // Webhooks
  WEBHOOK_CREATED: 'webhook.created',
  WEBHOOK_DELETED: 'webhook.deleted',

  // Workflows
  WORKFLOW_CREATED: 'workflow.created',
  WORKFLOW_DELETED: 'workflow.deleted',
  WORKFLOW_DEPLOYED: 'workflow.deployed',
  WORKFLOW_UNDEPLOYED: 'workflow.undeployed',
  WORKFLOW_DUPLICATED: 'workflow.duplicated',
  WORKFLOW_DEPLOYMENT_REVERTED: 'workflow.deployment_reverted',
  WORKFLOW_VARIABLES_UPDATED: 'workflow.variables_updated',

  // Workspaces
  WORKSPACE_CREATED: 'workspace.created',
  WORKSPACE_DELETED: 'workspace.deleted',
  WORKSPACE_DUPLICATED: 'workspace.duplicated',
} as const

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction]

/**
 * All resource types that can appear in audit log entries.
 */
export const AuditResourceType = {
  API_KEY: 'api_key',
  BYOK_KEY: 'byok_key',
  CHAT: 'chat',
  CREDENTIAL_SET: 'credential_set',
  DOCUMENT: 'document',
  ENVIRONMENT: 'environment',
  FILE: 'file',
  FOLDER: 'folder',
  FORM: 'form',
  KNOWLEDGE_BASE: 'knowledge_base',
  MCP_SERVER: 'mcp_server',
  NOTIFICATION: 'notification',
  OAUTH: 'oauth',
  ORGANIZATION: 'organization',
  PERMISSION_GROUP: 'permission_group',
  SCHEDULE: 'schedule',
  WEBHOOK: 'webhook',
  WORKFLOW: 'workflow',
  WORKSPACE: 'workspace',
} as const

export type AuditResourceTypeValue = (typeof AuditResourceType)[keyof typeof AuditResourceType]

interface AuditLogParams {
  workspaceId: string
  actorId: string
  action: AuditActionType
  resourceType: AuditResourceTypeValue
  resourceId?: string
  actorName?: string
  actorEmail?: string
  resourceName?: string
  description?: string
  metadata?: Record<string, unknown>
  request?: Request
}

/**
 * Records an audit log entry. Fire-and-forget — never throws or blocks the caller.
 */
export function recordAudit(params: AuditLogParams): void {
  const ipAddress =
    params.request?.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    params.request?.headers.get('x-real-ip') ??
    undefined
  const userAgent = params.request?.headers.get('user-agent') ?? undefined

  db.insert(auditLog)
    .values({
      id: nanoid(),
      workspaceId: params.workspaceId,
      actorId: params.actorId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      actorName: params.actorName,
      actorEmail: params.actorEmail,
      resourceName: params.resourceName,
      description: params.description,
      metadata: params.metadata ?? {},
      ipAddress,
      userAgent,
    })
    .then(() => {
      logger.debug('Audit log recorded', {
        action: params.action,
        resourceType: params.resourceType,
      })
    })
    .catch((error) => {
      logger.error('Failed to record audit log', { error, action: params.action })
    })
}
