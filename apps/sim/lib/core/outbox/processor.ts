import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { adminInvitationOperationOutboxHandlers } from '@/lib/admin/invitation-operation'
import { adminMemberOperationOutboxHandlers } from '@/lib/admin/member-operation'
import { enterpriseOwnerClaimOutboxHandlers } from '@/lib/billing/enterprise-owner-claim'
import { enterpriseIssuanceOutboxHandlers } from '@/lib/billing/enterprise-provisioning'
import { membershipBillingOutboxHandlers } from '@/lib/billing/organizations/membership-reconciliation'
import { billingOutboxHandlers } from '@/lib/billing/webhooks/outbox-handlers'
import {
  OUTBOX_PROCESSOR_MAX_RUNTIME_MS,
  OUTBOX_PROCESSOR_RECOVERY_CUTOFF_MS,
} from '@/lib/core/outbox/constants'
import { type ProcessOutboxResult, processOutboxEvents } from '@/lib/core/outbox/service'
import { DeadlineExceededError } from '@/lib/core/utils/deadline'
import { directGrantOutboxHandlers } from '@/lib/invitations/direct-grant'
import { slackSearchOutboxHandlers } from '@/lib/knowledge/application/slack-search/outbox'
import { getConnectorFailureDiagnostic } from '@/lib/knowledge/connectors/connector-error'
import { knowledgeDocumentProcessingOutboxHandlers } from '@/lib/knowledge/documents/processing-outbox-handler'
import { recoverKnowledgeDocumentProcessing } from '@/lib/knowledge/documents/processing-recovery'
import { organizationResourceCleanupOutboxHandlers } from '@/lib/organizations/resource-cleanup'
import { permissionAccessRequestOutboxHandlers } from '@/lib/permission-access-requests/notifications'
import { workspaceFileLiveDocOutboxHandlers } from '@/lib/uploads/contexts/workspace/workspace-file-live-doc-outbox'
import { workspaceFileStorageCleanupOutboxHandlers } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import { workflowDeploymentOutboxHandlers } from '@/lib/workflows/deployment-outbox'
import { invitationMigrationOutboxHandlers } from '@/lib/workspaces/admin-move'
import { workspaceOperationOutboxHandlers } from '@/lib/workspaces/operations/outbox'
import { forkContentOutboxHandlers } from '@/ee/workspace-forking/application/content-outbox'
import { reapStaleBackgroundWork } from '@/ee/workspace-forking/lib/background-work/store'

const logger = createLogger('OutboxProcessor')

const handlers = {
  ...slackSearchOutboxHandlers,
  ...adminInvitationOperationOutboxHandlers,
  ...adminMemberOperationOutboxHandlers,
  ...billingOutboxHandlers,
  ...membershipBillingOutboxHandlers,
  ...enterpriseIssuanceOutboxHandlers,
  ...enterpriseOwnerClaimOutboxHandlers,
  ...invitationMigrationOutboxHandlers,
  ...directGrantOutboxHandlers,
  ...knowledgeDocumentProcessingOutboxHandlers,
  ...organizationResourceCleanupOutboxHandlers,
  ...permissionAccessRequestOutboxHandlers,
  ...workspaceFileLiveDocOutboxHandlers,
  ...workspaceFileStorageCleanupOutboxHandlers,
  ...workflowDeploymentOutboxHandlers,
  ...workspaceOperationOutboxHandlers,
  ...forkContentOutboxHandlers,
} as const

export interface OutboxProcessorResult {
  result: ProcessOutboxResult
  recoveredDocuments: number
  reapedBackgroundWork: number
}

/** Processes one bounded batch and its recovery work in either the worker or self-hosted cron. */
export async function runOutboxProcessor(): Promise<OutboxProcessorResult> {
  const startedAt = Date.now()
  const result = await processOutboxEvents(handlers, {
    batchSize: 500,
    maxRuntimeMs: OUTBOX_PROCESSOR_MAX_RUNTIME_MS,
    minRemainingMs: 95_000,
  })

  let recoveredDocuments = 0
  try {
    if (Date.now() - startedAt < OUTBOX_PROCESSOR_RECOVERY_CUTOFF_MS) {
      recoveredDocuments = await recoverKnowledgeDocumentProcessing()
    }
  } catch (error) {
    logger.error('Stored document recovery failed', {
      error: getConnectorFailureDiagnostic(error) ?? {
        category: error instanceof DeadlineExceededError ? 'deadline' : 'internal',
        message:
          error instanceof DeadlineExceededError
            ? error.message
            : 'Unexpected stored-document recovery failure',
      },
    })
  }

  /** Reap independently so an expired fork lease cannot prevent outbox delivery. */
  let reapedBackgroundWork = 0
  try {
    reapedBackgroundWork = await reapStaleBackgroundWork(db)
  } catch (error) {
    logger.error('Background-work reap failed', { error: toError(error).message })
  }

  const output = { result, reapedBackgroundWork, recoveredDocuments }
  logger.info('Outbox processing completed', {
    ...result,
    reapedBackgroundWork,
    recoveredDocuments,
    durationMs: Date.now() - startedAt,
  })
  return output
}
