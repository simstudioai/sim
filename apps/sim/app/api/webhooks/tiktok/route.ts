import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  tiktokWebhookEnvelopeSchema,
  tiktokWebhookHeadersSchema,
} from '@/lib/api/contracts/webhooks'
import {
  API_EXECUTION_REQUIRES_PAID_PLAN_MESSAGE,
  isWorkspaceApiExecutionEntitled,
} from '@/lib/billing/core/api-access'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { WEBHOOK_MAX_BODY_BYTES } from '@/lib/webhooks/constants'
import {
  checkWebhookPreprocessing,
  handlePreDeploymentVerification,
  queueWebhookExecution,
  shouldSkipWebhookEvent,
} from '@/lib/webhooks/processor'
import { verifyTikTokSignature } from '@/lib/webhooks/providers/tiktok'
import { findTikTokWebhooksForOpenId } from '@/lib/webhooks/tiktok-fanout'
import { blockExistsInDeployment } from '@/lib/workflows/persistence/utils'

const logger = createLogger('TikTokWebhookIngress')

const TIKTOK_BODY_LABEL = 'TikTok webhook body'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

async function readTikTokBody(req: Request): Promise<string> {
  assertContentLengthWithinLimit(req.headers, WEBHOOK_MAX_BODY_BYTES, TIKTOK_BODY_LABEL)
  const buffer = await readStreamToBufferWithLimit(req.body, {
    maxBytes: WEBHOOK_MAX_BODY_BYTES,
    label: TIKTOK_BODY_LABEL,
  })
  return new TextDecoder().decode(buffer)
}

/**
 * App-level TikTok webhook Callback URL.
 * Portal: `{APP_URL}/api/webhooks/tiktok` (e.g. https://www.sim.ai/api/webhooks/tiktok).
 * Verifies TikTok-Signature once, then fans out by user_openid → credential → workflows.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const ticket = tryAdmit()
  if (!ticket) {
    return admissionRejectedResponse()
  }

  const requestId = generateRequestId()
  const receivedAt = Date.now()

  try {
    let rawBody: string
    try {
      rawBody = await readTikTokBody(request)
    } catch (bodyError) {
      if (isPayloadSizeLimitError(bodyError)) {
        logger.warn(`[${requestId}] Rejected oversized TikTok webhook body`, {
          maxBytes: WEBHOOK_MAX_BODY_BYTES,
          observedBytes: bodyError.observedBytes,
        })
        return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
      }
      throw bodyError
    }

    const headersResult = tiktokWebhookHeadersSchema.safeParse({
      'tiktok-signature': request.headers.get('TikTok-Signature'),
    })
    if (!headersResult.success) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const authError = verifyTikTokSignature(
      rawBody,
      headersResult.data['tiktok-signature'],
      requestId
    )
    if (authError) {
      return authError
    }

    let parsedJson: unknown
    try {
      parsedJson = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      logger.warn(`[${requestId}] TikTok webhook body is not valid JSON`)
      // Ack to avoid retry storms on malformed payloads after a valid signature.
      return NextResponse.json({ ok: true })
    }

    const envelopeResult = tiktokWebhookEnvelopeSchema.safeParse(parsedJson)
    if (!envelopeResult.success) {
      logger.warn(`[${requestId}] Invalid TikTok webhook envelope`, {
        issues: envelopeResult.error.issues,
      })
      return NextResponse.json({ ok: true })
    }

    const envelope = envelopeResult.data
    const matches = await findTikTokWebhooksForOpenId(envelope.user_openid, requestId)

    if (matches.length === 0) {
      logger.info(`[${requestId}] No matching TikTok webhooks; acknowledging`, {
        event: envelope.event,
        userOpenIdPrefix: envelope.user_openid.slice(0, 12),
      })
      return NextResponse.json({ ok: true })
    }

    let processed = 0
    for (const { webhook: foundWebhook, workflow: foundWorkflow } of matches) {
      // Schema allows null provider; fan-out already filtered to provider = 'tiktok'.
      const webhookRecord = {
        ...foundWebhook,
        provider: foundWebhook.provider ?? 'tiktok',
        providerConfig:
          (foundWebhook.providerConfig as Record<string, unknown> | null) ?? undefined,
      }

      if (
        foundWorkflow.workspaceId &&
        !(await isWorkspaceApiExecutionEntitled(foundWorkflow.workspaceId))
      ) {
        logger.warn(`[${requestId}] Workspace not entitled for TikTok webhook`, {
          webhookId: webhookRecord.id,
          workspaceId: foundWorkflow.workspaceId,
        })
        continue
      }

      const preprocessResult = await checkWebhookPreprocessing(
        foundWorkflow,
        webhookRecord,
        requestId
      )
      if (preprocessResult.error) {
        logger.warn(`[${requestId}] Preprocessing failed for TikTok webhook`, {
          webhookId: webhookRecord.id,
        })
        continue
      }

      if (webhookRecord.blockId) {
        const blockExists = await blockExistsInDeployment(foundWorkflow.id, webhookRecord.blockId)
        if (!blockExists) {
          const preDeploymentResponse = handlePreDeploymentVerification(webhookRecord, requestId)
          if (preDeploymentResponse) {
            continue
          }
          logger.info(
            `[${requestId}] Trigger block ${webhookRecord.blockId} not found in deployment for workflow ${foundWorkflow.id}`
          )
          continue
        }
      }

      if (shouldSkipWebhookEvent(webhookRecord, envelope, requestId)) {
        continue
      }

      await queueWebhookExecution(webhookRecord, foundWorkflow, envelope, request, {
        requestId,
        path: webhookRecord.path,
        actorUserId: preprocessResult.actorUserId,
        executionId: preprocessResult.executionId,
        correlation: preprocessResult.correlation,
        receivedAt,
      })
      processed += 1
    }

    if (processed === 0 && matches.length > 0) {
      logger.info(`[${requestId}] TikTok webhooks matched but none processed`, {
        matchCount: matches.length,
        hint: API_EXECUTION_REQUIRES_PAID_PLAN_MESSAGE,
      })
    }

    return NextResponse.json({ ok: true, webhooksProcessed: processed })
  } catch (error) {
    logger.error(`[${requestId}] TikTok webhook ingress error`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    // Still 200 after accept path failures that aren't auth — TikTok retries on non-200.
    return NextResponse.json({ ok: true })
  } finally {
    ticket.release()
  }
})
