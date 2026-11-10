import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { webhook, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  assertWorkflowMutable,
  authorizeWorkflowByWorkspacePermission,
  WorkflowLockedError,
} from '@sim/platform-authz/workflow'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  deleteWebhookContract,
  getWebhookContract,
  updateWebhookContract,
} from '@/lib/api/contracts/webhooks'
import { parseRequest } from '@/lib/api/server'
import {
  createInternalResourceConcealmentPolicy,
  defineInternalJsonRoute,
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { InsufficientWorkspacePermissionsError } from '@/lib/core/application'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { cleanupExternalWebhook } from '@/lib/webhooks/provider-subscriptions'
import { internalWorkflowSessionOrExecutorAuth } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { setWorkflowTriggerEnabled } from '@/lib/workflows/application/triggers'

const logger = createLogger('WebhookAPI')

export const dynamic = 'force-dynamic'

// Get a specific webhook
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const parsed = await parseRequest(getWebhookContract, request, context)
      if (!parsed.success) return parsed.response
      const { id } = parsed.data.params

      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn('Unauthorized webhook access attempt')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      const webhooks = await db
        .select({
          webhook: webhook,
          workflow: {
            id: workflow.id,
            name: workflow.name,
            userId: workflow.userId,
            workspaceId: workflow.workspaceId,
          },
        })
        .from(webhook)
        .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
        .where(and(eq(webhook.id, id), isNull(webhook.archivedAt)))
        .limit(1)

      if (webhooks.length === 0) {
        logger.warn(`Webhook not found: ${id}`)
        return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
      }

      const webhookData = webhooks[0]

      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId: webhookData.workflow.id,
        userId,
        action: 'read',
      })
      const hasAccess = authorization.allowed

      if (!hasAccess) {
        logger.warn(`User ${userId} denied access to webhook: ${id}`)
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      logger.info(`Successfully retrieved webhook: ${id}`)
      return NextResponse.json({ webhook: webhooks[0] }, { status: 200 })
    } catch (error) {
      logger.error('Error fetching webhook', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * Pauses or resumes a webhook trigger through the same use case as
 * `PATCH /api/v2/workflows/{workflowId}/triggers/{blockId}`, which also owns the
 * `triggers.webhook` gate on re-enabling. The id must name the live
 * deployment's row: a candidate, retired, or older-version registration answers
 * 404 instead of being revived.
 * Admits a session or a workflow run's executor delegation; the executor is not
 * judged against the triggering member's permission group.
 */
export const PATCH = defineInternalJsonRoute({
  contract: updateWebhookContract,
  auth: internalWorkflowSessionOrExecutorAuth,
  operation: workflowOperations.setTriggerEnabled,
  rateLimit: internalRateLimits.none({
    reason: 'Webhook enablement retains its existing session admission policy.',
  }),
  errorPolicy: createInternalResourceConcealmentPolicy({
    notFoundMessage: 'Webhook not found',
    base: extendInternalErrorPolicy(internalOrchestrationErrorPolicy, (error) =>
      error instanceof InsufficientWorkspacePermissionsError
        ? internalErrorResponse(403, { error: 'Access denied' })
        : null
    ),
  }),
  mapInput: ({ params, body }) => ({
    target: { kind: 'row' as const, table: 'webhook' as const, id: params.id },
    enabled: body.isActive,
  }),
  useCase: setWorkflowTriggerEnabled,
  present: ({ record }) => {
    if (record.table !== 'webhook') throw new Error('Webhook update resolved a schedule row')
    const { row } = record
    return {
      webhook: {
        ...row,
        path: row.path ?? undefined,
        providerConfig: isRecordLike(row.providerConfig) ? row.providerConfig : undefined,
      },
    }
  },
})

// Delete a webhook
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()

    try {
      const parsed = await parseRequest(deleteWebhookContract, request, context)
      if (!parsed.success) return parsed.response
      const { id } = parsed.data.params

      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        logger.warn('Unauthorized webhook deletion attempt')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const userId = auth.userId

      // Find the webhook and check permissions
      const webhooks = await db
        .select({
          webhook: webhook,
          workflow: {
            id: workflow.id,
            userId: workflow.userId,
            workspaceId: workflow.workspaceId,
          },
        })
        .from(webhook)
        .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
        .where(eq(webhook.id, id))
        .limit(1)

      if (webhooks.length === 0) {
        logger.warn(`Webhook not found: ${id}`)
        return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
      }

      const webhookData = webhooks[0]

      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId: webhookData.workflow.id,
        userId,
        action: 'write',
      })
      const canDelete = authorization.allowed

      if (!canDelete) {
        logger.warn(`User ${userId} denied permission to delete webhook: ${id}`)
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
      await assertWorkflowMutable(webhookData.workflow.id)

      const foundWebhook = webhookData.webhook

      await cleanupExternalWebhook(foundWebhook, webhookData.workflow, requestId)
      await db.delete(webhook).where(eq(webhook.id, id))

      try {
        PlatformEvents.webhookDeleted({
          webhookId: id,
          workflowId: webhookData.workflow.id,
        })
      } catch {
        // Telemetry should not fail the operation
      }

      logger.info(`Successfully deleted webhook: ${id}`)

      recordAudit({
        workspaceId: webhookData.workflow.workspaceId || null,
        actorId: userId,
        actorName: auth.userName,
        actorEmail: auth.userEmail,
        action: AuditAction.WEBHOOK_DELETED,
        resourceType: AuditResourceType.WEBHOOK,
        resourceId: id,
        resourceName: foundWebhook.provider || 'generic',
        description: `Deleted ${foundWebhook.provider || 'generic'} webhook`,
        metadata: {
          provider: foundWebhook.provider || 'generic',
          workflowId: webhookData.workflow.id,
          webhookPath: foundWebhook.path || undefined,
          blockId: foundWebhook.blockId || undefined,
        },
        request,
      })

      const wsId = webhookData.workflow.workspaceId || undefined
      captureServerEvent(
        userId,
        'webhook_trigger_deleted',
        {
          webhook_id: id,
          workflow_id: webhookData.workflow.id,
          provider: foundWebhook.provider || 'generic',
          workspace_id: wsId ?? '',
        },
        wsId ? { groups: { workspace: wsId } } : undefined
      )

      return NextResponse.json({ success: true }, { status: 200 })
    } catch (error: any) {
      if (error instanceof WorkflowLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }

      logger.error('Error deleting webhook', {
        error: error.message,
        stack: error.stack,
      })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
