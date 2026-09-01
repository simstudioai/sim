import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cancelWorkflowExecution } from '@/lib/execution/cancel-workflow-execution'
import { getSlackBotCredential } from '@/lib/oauth/credential-service'
import { findWebhooksByRoutingKey, type WebhookDispatchResult } from '@/lib/webhooks/processor'
import { verifySlackRequestSignature } from '@/lib/webhooks/providers/slack'
import { setSlackAgentSessionStatus } from '@/lib/webhooks/slack-agent-api'
import { LEGACY_SLACK_CUSTOM_BOT_INGRESS_MODE } from '@/lib/webhooks/slack-custom-ingress-constants'
import { dispatchSlackWebhooks } from '@/lib/webhooks/slack-dispatch'
import {
  listSlackStreamSessions,
  resolveStoppedSlackSession,
  unregisterSlackStreamSession,
} from '@/lib/webhooks/slack-stream-sessions'

const logger = createLogger('SlackCustomBotIngress')

interface LegacySlackPathWebhook {
  id: string
  provider: string | null
  routingKey: string | null
  providerConfig: unknown
}

interface SlackCustomBotRequestOptions {
  credentialId: string
  request: NextRequest
  rawBody: string
  requestId: string
}

interface DispatchSlackCustomBotOptions {
  credentialId: string
  body: unknown
  request: NextRequest
  requestId: string
  receivedAt: number
}

/**
 * Returns the custom-bot credential attached to a migrated legacy Slack path.
 * A persisted marker is treated as a strict contract so partial migrations fail
 * instead of silently falling back to the duplicated legacy secrets.
 */
export function getLegacySlackCustomBotCredentialId(
  foundWebhook: LegacySlackPathWebhook
): string | null {
  const providerConfig =
    foundWebhook.providerConfig !== null &&
    typeof foundWebhook.providerConfig === 'object' &&
    !Array.isArray(foundWebhook.providerConfig)
      ? (foundWebhook.providerConfig as Record<string, unknown>)
      : {}

  if (providerConfig.ingressMode !== LEGACY_SLACK_CUSTOM_BOT_INGRESS_MODE) {
    return null
  }
  if (foundWebhook.provider !== 'slack') {
    throw new Error(`Legacy Slack custom-bot webhook ${foundWebhook.id} must use provider slack`)
  }
  if (providerConfig.triggerId !== 'slack_webhook') {
    throw new Error(
      `Legacy Slack custom-bot webhook ${foundWebhook.id} must use trigger slack_webhook`
    )
  }

  const credentialId =
    typeof providerConfig.credentialId === 'string' && providerConfig.credentialId.length > 0
      ? providerConfig.credentialId
      : null
  if (!credentialId) {
    throw new Error(`Legacy Slack custom-bot webhook ${foundWebhook.id} has no credentialId`)
  }
  if (foundWebhook.routingKey !== credentialId) {
    throw new Error(
      `Legacy Slack custom-bot webhook ${foundWebhook.id} routing key does not match its credential`
    )
  }

  return credentialId
}

export async function verifySlackCustomBotCredentialRequest({
  credentialId,
  request,
  rawBody,
  requestId,
}: SlackCustomBotRequestOptions): Promise<NextResponse | null> {
  const botCredential = await getSlackBotCredential(credentialId)
  if (!botCredential) {
    logger.warn(`[${requestId}] Unknown Slack bot credential ${credentialId}`)
    return new NextResponse(null, { status: 404 })
  }
  if (!botCredential.signingSecret) {
    logger.warn(`[${requestId}] Slack bot credential ${credentialId} has no signing secret`)
    return new NextResponse(null, { status: 404 })
  }

  return verifySlackRequestSignature(botCredential.signingSecret, request, rawBody, requestId)
}

export async function dispatchSlackCustomBotCredential({
  credentialId,
  body,
  request,
  requestId,
  receivedAt,
}: DispatchSlackCustomBotOptions): Promise<WebhookDispatchResult[]> {
  const webhooks = await findWebhooksByRoutingKey(credentialId, requestId, 'slack')
  if (webhooks.length === 0) {
    logger.info(
      `[${requestId}] No active trigger for bot credential ${credentialId}; nothing to run`
    )
    return []
  }

  return dispatchSlackWebhooks(webhooks, { body, request, requestId, receivedAt })
}

/** Cancels every workflow currently associated with Slack's stopped agent session. */
export async function handleSlackAgentSessionStopped(
  credentialId: string,
  body: unknown
): Promise<void> {
  const target = resolveStoppedSlackSession(body)
  if (!target) return

  const executions = await listSlackStreamSessions(credentialId, target)
  if (executions.length === 0) return
  await Promise.all(
    executions.map(async (execution) => {
      await cancelWorkflowExecution({
        executionId: execution.executionId,
        workflowId: execution.workflowId,
        userId: execution.userId,
        workspaceId: execution.workspaceId,
      })
      await unregisterSlackStreamSession(credentialId, target, execution.executionId)
    })
  )

  const credential = await getSlackBotCredential(credentialId)
  if (!credential) {
    throw new Error('Slack agent session stop credential is unavailable')
  }
  await setSlackAgentSessionStatus(credential.botToken, target, 'active')
}
