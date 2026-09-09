import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { adminInvitationOperationOutboxHandlers } from '@/lib/admin/invitation-operation'
import { adminMemberOperationOutboxHandlers } from '@/lib/admin/member-operation'
import { verifyCronAuth } from '@/lib/auth/internal'
import { enterpriseOwnerClaimOutboxHandlers } from '@/lib/billing/enterprise-owner-claim'
import { enterpriseIssuanceOutboxHandlers } from '@/lib/billing/enterprise-provisioning'
import { membershipBillingOutboxHandlers } from '@/lib/billing/organizations/membership-reconciliation'
import { billingOutboxHandlers } from '@/lib/billing/webhooks/outbox-handlers'
import { processOutboxEvents } from '@/lib/core/outbox/service'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { directGrantOutboxHandlers } from '@/lib/invitations/direct-grant'
import { knowledgeDocumentProcessingOutboxHandlers } from '@/lib/knowledge/documents/processing-outbox-handler'
import { organizationResourceCleanupOutboxHandlers } from '@/lib/organizations/resource-cleanup'
import { workspaceFileLiveDocOutboxHandlers } from '@/lib/uploads/contexts/workspace/workspace-file-live-doc-outbox'
import { workspaceFileStorageCleanupOutboxHandlers } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import { workflowDeploymentOutboxHandlers } from '@/lib/workflows/deployment-outbox'
import { invitationMigrationOutboxHandlers } from '@/lib/workspaces/admin-move'
import { reapStaleBackgroundWork } from '@/ee/workspace-forking/lib/background-work/store'

const logger = createLogger('OutboxProcessorAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 800

const handlers = {
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
  ...workspaceFileLiveDocOutboxHandlers,
  ...workspaceFileStorageCleanupOutboxHandlers,
  ...workflowDeploymentOutboxHandlers,
} as const

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authError = verifyCronAuth(request, 'Outbox processor')
    if (authError) {
      return authError
    }

    const result = await processOutboxEvents(handlers, {
      batchSize: 20,
      maxRuntimeMs: 790_000,
      minRemainingMs: 95_000,
    })

    // Reap fork background-work rows stuck `processing` past their TTL (worker crash /
    // restart has no in-task hook). Independent of the outbox; a failure here must not
    // fail the outbox run, so it's guarded separately.
    let reapedBackgroundWork = 0
    try {
      reapedBackgroundWork = await reapStaleBackgroundWork(db)
    } catch (error) {
      logger.error('Background-work reap failed', { requestId, error: toError(error).message })
    }

    logger.info('Outbox processing completed', { requestId, ...result, reapedBackgroundWork })

    return NextResponse.json({
      success: true,
      requestId,
      result,
      reapedBackgroundWork,
    })
  } catch (error) {
    logger.error('Outbox processing failed', { requestId, error: toError(error).message })
    return NextResponse.json(
      { success: false, requestId, error: toError(error).message },
      { status: 500 }
    )
  }
})
