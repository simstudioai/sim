import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { safeCompare } from '@/lib/core/security/encryption'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Attio')

function validateAttioSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Attio signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }
    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    logger.debug('Attio signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${signature.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: signature.length,
      match: computedHash === signature,
    })
    return safeCompare(computedHash, signature)
  } catch (error) {
    logger.error('Error validating Attio signature:', error)
    return false
  }
}

export const attioHandler: WebhookProviderHandler = {
  verifyAuth({ webhook, request, rawBody, requestId, providerConfig }: AuthContext) {
    const secret = providerConfig.webhookSecret as string | undefined

    if (!secret) {
      logger.debug(
        `[${requestId}] Attio webhook ${webhook.id as string} has no signing secret, skipping signature verification`
      )
    } else {
      const signature = request.headers.get('Attio-Signature')

      if (!signature) {
        logger.warn(`[${requestId}] Attio webhook missing signature header`)
        return new NextResponse('Unauthorized - Missing Attio signature', {
          status: 401,
        })
      }

      const isValidSignature = validateAttioSignature(secret, signature, rawBody)

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Attio signature verification failed`, {
          signatureLength: signature.length,
          secretLength: secret.length,
        })
        return new NextResponse('Unauthorized - Invalid Attio signature', {
          status: 401,
        })
      }
    }

    return null
  },

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>

    if (triggerId && triggerId !== 'attio_webhook') {
      const { isAttioPayloadMatch, getAttioEvent } = await import('@/triggers/attio/utils')
      if (!isAttioPayloadMatch(triggerId, obj)) {
        const event = getAttioEvent(obj)
        const eventType = event?.event_type as string | undefined
        logger.debug(
          `[${requestId}] Attio event mismatch for trigger ${triggerId}. Event: ${eventType}. Skipping execution.`,
          {
            webhookId: webhook.id,
            workflowId: workflow.id,
            triggerId,
            receivedEvent: eventType,
            bodyKeys: Object.keys(obj),
          }
        )
        return NextResponse.json({
          status: 'skipped',
          reason: 'event_type_mismatch',
        })
      }
    }

    return true
  },

  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const {
      extractAttioRecordData,
      extractAttioRecordUpdatedData,
      extractAttioRecordMergedData,
      extractAttioNoteData,
      extractAttioTaskData,
      extractAttioCommentData,
      extractAttioListEntryData,
      extractAttioListEntryUpdatedData,
      extractAttioListData,
      extractAttioWorkspaceMemberData,
      extractAttioGenericData,
    } = await import('@/triggers/attio/utils')

    const providerConfig = (webhook.providerConfig as Record<string, unknown>) || {}
    const triggerId = providerConfig.triggerId as string | undefined

    if (triggerId === 'attio_record_updated') {
      return { input: extractAttioRecordUpdatedData(body) }
    }
    if (triggerId === 'attio_record_merged') {
      return { input: extractAttioRecordMergedData(body) }
    }
    if (triggerId === 'attio_record_created' || triggerId === 'attio_record_deleted') {
      return { input: extractAttioRecordData(body) }
    }
    if (triggerId?.startsWith('attio_note_')) {
      return { input: extractAttioNoteData(body) }
    }
    if (triggerId?.startsWith('attio_task_')) {
      return { input: extractAttioTaskData(body) }
    }
    if (triggerId?.startsWith('attio_comment_')) {
      return { input: extractAttioCommentData(body) }
    }
    if (triggerId === 'attio_list_entry_updated') {
      return { input: extractAttioListEntryUpdatedData(body) }
    }
    if (triggerId === 'attio_list_entry_created' || triggerId === 'attio_list_entry_deleted') {
      return { input: extractAttioListEntryData(body) }
    }
    if (
      triggerId === 'attio_list_created' ||
      triggerId === 'attio_list_updated' ||
      triggerId === 'attio_list_deleted'
    ) {
      return { input: extractAttioListData(body) }
    }
    if (triggerId === 'attio_workspace_member_created') {
      return { input: extractAttioWorkspaceMemberData(body) }
    }
    return { input: extractAttioGenericData(body) }
  },
}
