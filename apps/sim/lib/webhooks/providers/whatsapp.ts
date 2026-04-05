import { db, workflowDeploymentVersion } from '@sim/db'
import { webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, or } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:WhatsApp')

/**
 * Handle WhatsApp verification requests
 */
export async function handleWhatsAppVerification(
  requestId: string,
  path: string,
  mode: string | null,
  token: string | null,
  challenge: string | null
): Promise<NextResponse | null> {
  if (mode && token && challenge) {
    logger.info(`[${requestId}] WhatsApp verification request received for path: ${path}`)

    if (mode !== 'subscribe') {
      logger.warn(`[${requestId}] Invalid WhatsApp verification mode: ${mode}`)
      return new NextResponse('Invalid mode', { status: 400 })
    }

    const webhooks = await db
      .select({ webhook })
      .from(webhook)
      .leftJoin(
        workflowDeploymentVersion,
        and(
          eq(workflowDeploymentVersion.workflowId, webhook.workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .where(
        and(
          eq(webhook.provider, 'whatsapp'),
          eq(webhook.isActive, true),
          or(
            eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
            and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
          )
        )
      )

    for (const row of webhooks) {
      const wh = row.webhook
      const providerConfig = (wh.providerConfig as Record<string, unknown>) || {}
      const verificationToken = providerConfig.verificationToken

      if (!verificationToken) {
        continue
      }

      if (token === verificationToken) {
        logger.info(`[${requestId}] WhatsApp verification successful for webhook ${wh.id}`)
        return new NextResponse(challenge, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
          },
        })
      }
    }

    logger.warn(`[${requestId}] No matching WhatsApp verification token found`)
    return new NextResponse('Verification failed', { status: 403 })
  }

  return null
}

export const whatsappHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const entry = b?.entry as Array<Record<string, unknown>> | undefined
    const changes = entry?.[0]?.changes as Array<Record<string, unknown>> | undefined
    const data = changes?.[0]?.value as Record<string, unknown> | undefined
    const messages = (data?.messages as Array<Record<string, unknown>>) || []

    if (messages.length > 0) {
      const message = messages[0]
      const metadata = data?.metadata as Record<string, unknown> | undefined
      const text = message.text as Record<string, unknown> | undefined
      return {
        input: {
          messageId: message.id,
          from: message.from,
          phoneNumberId: metadata?.phone_number_id,
          text: text?.body,
          timestamp: message.timestamp,
          raw: JSON.stringify(message),
        },
      }
    }
    return { input: null }
  },

  handleEmptyInput(requestId: string) {
    logger.info(`[${requestId}] No messages in WhatsApp payload, skipping execution`)
    return { message: 'No messages in WhatsApp payload' }
  },
}
