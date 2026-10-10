import { ADMIN_INVITATION_OPERATION_EVENT_TYPE } from '@/lib/admin/invitation-operation-event'
import { ADMIN_MEMBER_OPERATION_EVENT_TYPE } from '@/lib/admin/member-operation-event'
import {
  ENTERPRISE_INVITE_PEOPLE_EVENT_TYPE,
  ENTERPRISE_MEMBER_RECONCILIATION_EVENT_TYPE,
  ENTERPRISE_METADATA_SYNC_EVENT_TYPE,
  ENTERPRISE_PROVISION_EVENT_TYPE,
  ENTERPRISE_WORKSPACE_MOVE_EVENT_TYPE,
} from '@/lib/billing/enterprise-outbox-events'
import {
  ENTERPRISE_OWNER_ACTIVATION_EVENT_TYPE,
  ENTERPRISE_OWNER_CLAIM_EVENT_TYPE,
} from '@/lib/billing/enterprise-owner-claim-events'
import { MEMBER_BILLING_RECONCILIATION_EVENT_TYPE } from '@/lib/billing/organizations/membership-reconciliation-event'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-events'
import type { LazyOutboxHandlerGroup } from '@/lib/core/outbox/service'
import { DIRECT_GRANT_EMAIL_EVENT_TYPE } from '@/lib/invitations/direct-grant-event'
import { SLACK_SEARCH_TURN_EVENT } from '@/lib/knowledge/application/slack-search/turn-event'
import {
  KNOWLEDGE_CONNECTOR_CLEANUP_EVENT,
  KNOWLEDGE_CONNECTOR_DETACH_EVENT,
} from '@/lib/knowledge/connectors/outbox-events'
import {
  EMBEDDING_CHECKPOINT_CLEANUP_EVENT,
  OCR_CHECKPOINT_CLEANUP_OUTBOX_EVENT,
} from '@/lib/knowledge/documents/checkpoint-events'
import { KNOWLEDGE_DOCUMENT_CONTINUATION_OUTBOX_EVENT } from '@/lib/knowledge/documents/processing-continuation-event'
import {
  KNOWLEDGE_DOCUMENT_DEFERRED_RETRY_CHECK_EVENT,
  KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT,
} from '@/lib/knowledge/documents/processing-events'
import { KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT } from '@/lib/knowledge/documents/processing-recovery-event'
import { KNOWLEDGE_STORAGE_CLEANUP_EVENT } from '@/lib/knowledge/documents/storage-cleanup-event'
import { INBOX_CLEANUP_EVENT } from '@/lib/mothership/inbox/cleanup-event'
import { ORGANIZATION_RESOURCE_CLEANUP_EVENT } from '@/lib/organizations/resource-cleanup-event'
import {
  PROJECT_FILE_DOCUMENT_RETIRE_EVENT,
  PROJECT_FILE_PREFIX_CLEANUP_EVENT,
  PROJECT_STORAGE_RECONCILE_EVENT,
} from '@/lib/projects/files/outbox-events'
import {
  WORKSPACE_FILE_LIVE_DOC_OUTBOX_EVENT,
  WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT,
} from '@/lib/uploads/contexts/workspace/file-outbox-events'
import { WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS } from '@/lib/workflows/deployment-outbox-events'
import { MIGRATED_INVITATION_EMAIL_EVENT_TYPE } from '@/lib/workspaces/admin-move-event'
import {
  WORKSPACE_MCP_CHANGED_EVENT,
  WORKSPACE_OPERATION_OBSERVE_EVENT,
  WORKSPACE_WORKFLOWS_CHANGED_EVENT,
} from '@/lib/workspaces/operations/outbox-events'
import {
  PERMISSION_ACCESS_REQUEST_CREATED_EVENT,
  PERMISSION_ACCESS_REQUEST_DECIDED_EVENT,
  PERMISSION_ACCESS_REQUEST_NOTIFY_ADMIN_EVENT,
} from '@/ee/access-requests/lib/notification-events'
import { FORK_CONTENT_COPY_EVENT } from '@/ee/workspace-forking/application/content-outbox-event'

/**
 * Every handler module the outbox processor serves, with the event types its handler map
 * registers. A module is imported only when one of its event types is due, so a run never loads
 * the dependencies of handlers it will not call. Event types come from dependency-free modules,
 * so naming them here costs nothing.
 *
 * `handlers.test.ts` checks every group against its module. Each `load` destructures its import
 * so the unused-export audit can see which export it reads; `(await import(x)).y` marks every
 * export of the module as used.
 */
export const OUTBOX_HANDLER_GROUPS: readonly LazyOutboxHandlerGroup[] = [
  {
    events: [SLACK_SEARCH_TURN_EVENT],
    load: async () => {
      const { slackSearchOutboxHandlers } = await import(
        '@/lib/knowledge/application/slack-search/outbox'
      )
      return slackSearchOutboxHandlers
    },
  },
  {
    events: [ADMIN_INVITATION_OPERATION_EVENT_TYPE],
    load: async () => {
      const { adminInvitationOperationOutboxHandlers } = await import(
        '@/lib/admin/invitation-operation'
      )
      return adminInvitationOperationOutboxHandlers
    },
  },
  {
    events: [ADMIN_MEMBER_OPERATION_EVENT_TYPE],
    load: async () => {
      const { adminMemberOperationOutboxHandlers } = await import('@/lib/admin/member-operation')
      return adminMemberOperationOutboxHandlers
    },
  },
  {
    events: Object.values(OUTBOX_EVENT_TYPES),
    load: async () => {
      const { billingOutboxHandlers } = await import('@/lib/billing/webhooks/outbox-handlers')
      return billingOutboxHandlers
    },
  },
  {
    events: [MEMBER_BILLING_RECONCILIATION_EVENT_TYPE],
    load: async () => {
      const { membershipBillingOutboxHandlers } = await import(
        '@/lib/billing/organizations/membership-reconciliation'
      )
      return membershipBillingOutboxHandlers
    },
  },
  {
    events: [
      ENTERPRISE_PROVISION_EVENT_TYPE,
      ENTERPRISE_METADATA_SYNC_EVENT_TYPE,
      ENTERPRISE_WORKSPACE_MOVE_EVENT_TYPE,
      ENTERPRISE_INVITE_PEOPLE_EVENT_TYPE,
      ENTERPRISE_MEMBER_RECONCILIATION_EVENT_TYPE,
    ],
    load: async () => {
      const { enterpriseIssuanceOutboxHandlers } = await import(
        '@/lib/billing/enterprise-provisioning'
      )
      return enterpriseIssuanceOutboxHandlers
    },
  },
  {
    events: [ENTERPRISE_OWNER_CLAIM_EVENT_TYPE, ENTERPRISE_OWNER_ACTIVATION_EVENT_TYPE],
    load: async () => {
      const { enterpriseOwnerClaimOutboxHandlers } = await import(
        '@/lib/billing/enterprise-owner-claim'
      )
      return enterpriseOwnerClaimOutboxHandlers
    },
  },
  {
    events: [MIGRATED_INVITATION_EMAIL_EVENT_TYPE],
    load: async () => {
      const { invitationMigrationOutboxHandlers } = await import('@/lib/workspaces/admin-move')
      return invitationMigrationOutboxHandlers
    },
  },
  {
    events: [DIRECT_GRANT_EMAIL_EVENT_TYPE],
    load: async () => {
      const { directGrantOutboxHandlers } = await import('@/lib/invitations/direct-grant')
      return directGrantOutboxHandlers
    },
  },
  {
    events: [
      KNOWLEDGE_CONNECTOR_CLEANUP_EVENT,
      KNOWLEDGE_CONNECTOR_DETACH_EVENT,
      KNOWLEDGE_STORAGE_CLEANUP_EVENT,
      OCR_CHECKPOINT_CLEANUP_OUTBOX_EVENT,
      KNOWLEDGE_DOCUMENT_DEFERRED_RETRY_CHECK_EVENT,
      EMBEDDING_CHECKPOINT_CLEANUP_EVENT,
      KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT,
      KNOWLEDGE_DOCUMENT_CONTINUATION_OUTBOX_EVENT,
      KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT,
    ],
    load: async () => {
      const { knowledgeDocumentProcessingOutboxHandlers } = await import(
        '@/lib/knowledge/documents/processing-outbox-handler'
      )
      return knowledgeDocumentProcessingOutboxHandlers
    },
  },
  {
    events: [ORGANIZATION_RESOURCE_CLEANUP_EVENT],
    load: async () => {
      const { organizationResourceCleanupOutboxHandlers } = await import(
        '@/lib/organizations/resource-cleanup'
      )
      return organizationResourceCleanupOutboxHandlers
    },
  },
  {
    events: [INBOX_CLEANUP_EVENT],
    load: async () => {
      const { inboxCleanupOutboxHandlers } = await import('@/lib/mothership/inbox/cleanup-outbox')
      return inboxCleanupOutboxHandlers
    },
  },
  {
    events: [
      PERMISSION_ACCESS_REQUEST_CREATED_EVENT,
      PERMISSION_ACCESS_REQUEST_NOTIFY_ADMIN_EVENT,
      PERMISSION_ACCESS_REQUEST_DECIDED_EVENT,
    ],
    load: async () => {
      const { permissionAccessRequestOutboxHandlers } = await import(
        '@/ee/access-requests/lib/notifications'
      )
      return permissionAccessRequestOutboxHandlers
    },
  },
  {
    events: [WORKSPACE_FILE_LIVE_DOC_OUTBOX_EVENT],
    load: async () => {
      const { fileLiveDocOutboxHandlers } = await import('@/lib/uploads/server/live-doc-outbox')
      return fileLiveDocOutboxHandlers
    },
  },
  {
    events: [WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT],
    load: async () => {
      const { workspaceFileStorageCleanupOutboxHandlers } = await import(
        '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
      )
      return workspaceFileStorageCleanupOutboxHandlers
    },
  },
  {
    events: [PROJECT_FILE_PREFIX_CLEANUP_EVENT, PROJECT_STORAGE_RECONCILE_EVENT],
    load: async () => {
      const { projectFilePrefixCleanupOutboxHandlers } = await import(
        '@/lib/projects/files/prefix-cleanup'
      )
      return projectFilePrefixCleanupOutboxHandlers
    },
  },
  {
    events: [PROJECT_FILE_DOCUMENT_RETIRE_EVENT],
    load: async () => {
      const { projectFileDocumentOutboxHandlers } = await import(
        '@/lib/projects/files/application/document-lifecycle'
      )
      return projectFileDocumentOutboxHandlers
    },
  },
  {
    events: Object.values(WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS),
    load: async () => {
      const { workflowDeploymentOutboxHandlers } = await import('@/lib/workflows/deployment-outbox')
      return workflowDeploymentOutboxHandlers
    },
  },
  {
    events: [
      WORKSPACE_MCP_CHANGED_EVENT,
      WORKSPACE_OPERATION_OBSERVE_EVENT,
      WORKSPACE_WORKFLOWS_CHANGED_EVENT,
    ],
    load: async () => {
      const { workspaceOperationOutboxHandlers } = await import(
        '@/lib/workspaces/operations/outbox'
      )
      return workspaceOperationOutboxHandlers
    },
  },
  {
    events: [FORK_CONTENT_COPY_EVENT],
    load: async () => {
      const { forkContentOutboxHandlers } = await import(
        '@/ee/workspace-forking/application/content-outbox'
      )
      return forkContentOutboxHandlers
    },
  },
]
