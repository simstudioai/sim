import { DeleteMessageCommand, type Message, ReceiveMessageCommand } from '@aws-sdk/client-sqs'
import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { getEventsQueueClient } from '@/lib/billing/aws-marketplace/client'
import { getAwsMarketplaceProductCode } from '@/lib/billing/aws-marketplace/config'
import {
  isInvalidEntitlementRequest,
  verifyLicense,
} from '@/lib/billing/aws-marketplace/entitlements'
import {
  listLicensesVerifiedBefore,
  recordLicenseVerification,
} from '@/lib/billing/aws-marketplace/repository'
import { env } from '@/lib/core/config/env'

const logger = createLogger('AwsMarketplaceReconcile')

const EVENT_SOURCE = 'aws.agreement-marketplace'
const LICENSE_EVENT_TYPES = new Set([
  'License Updated - Manufacturer',
  'License Deprovisioned - Manufacturer',
])

/** SQS caps one receive at 10 messages; a run drains at most this many batches. */
const RECEIVE_BATCH_SIZE = 10
const MAX_RECEIVE_BATCHES = 10
/** Long enough for a batch of entitlement reads with retries; unhandled messages reappear after it. */
const VISIBILITY_TIMEOUT_SECONDS = 120
const RECEIVE_WAIT_SECONDS = 2

const REVERIFY_AFTER_MS = 24 * 60 * 60 * 1000
const REVERIFY_BATCH_SIZE = 50

interface AwsMarketplaceReconcileSummary {
  received: number
  applied: number
  discarded: number
  retained: number
  reverified: number
  reverifyFailed: number
}

type LicenseEvent = { licenseArn: string; productCode: string } | null

/** The license an agreement event names, or null for a body that is not one. */
function parseLicenseEvent(body: string | undefined): LicenseEvent {
  if (!body) return null
  let event: Record<string, unknown>
  try {
    event = toRecord(JSON.parse(body))
  } catch {
    return null
  }
  const detailType = toStringOrNull(event['detail-type'])
  if (event.source !== EVENT_SOURCE || !detailType || !LICENSE_EVENT_TYPES.has(detailType)) {
    return null
  }
  const detail = toRecord(event.detail)
  const licenseArn = toStringOrNull(toRecord(detail.license).arn)
  const productCode = toStringOrNull(toRecord(detail.product).code)
  return licenseArn && productCode ? { licenseArn, productCode } : null
}

type MessageOutcome = 'applied' | 'discarded' | 'retained'

/**
 * Re-reads the license an event names rather than trusting the event's own fields. A message that
 * can never apply is discarded; one that failed for a reason that may pass is retained, so SQS
 * redelivers it and the dead-letter queue catches one that never succeeds.
 */
async function handleMessage(productCode: string, message: Message): Promise<MessageOutcome> {
  const event = parseLicenseEvent(message.Body)
  if (!event) {
    logger.warn('Discarding an AWS Marketplace event that is not a license event', {
      messageId: message.MessageId,
    })
    return 'discarded'
  }
  if (event.productCode !== productCode) {
    logger.warn('Discarding an AWS Marketplace event for another product', {
      messageId: message.MessageId,
    })
    return 'discarded'
  }
  const verifiedAt = new Date()
  try {
    const summary = await verifyLicense(productCode, event.licenseArn)
    await recordLicenseVerification({
      licenseArn: event.licenseArn,
      productCode,
      summary,
      verifiedAt,
    })
    return 'applied'
  } catch (error) {
    if (isInvalidEntitlementRequest(error)) {
      logger.warn('Discarding an AWS Marketplace event the Entitlement Service rejected', {
        messageId: message.MessageId,
        message: getErrorMessage(error, 'Unknown error'),
      })
      return 'discarded'
    }
    logger.warn('Leaving an AWS Marketplace event for redelivery', {
      messageId: message.MessageId,
      message: getErrorMessage(error, 'Unknown error'),
    })
    return 'retained'
  }
}

async function drainEvents(
  productCode: string,
  queueUrl: string,
  summary: AwsMarketplaceReconcileSummary
): Promise<void> {
  const client = getEventsQueueClient()
  for (let batch = 0; batch < MAX_RECEIVE_BATCHES; batch++) {
    let messages: Message[]
    try {
      const result = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: RECEIVE_BATCH_SIZE,
          VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
          WaitTimeSeconds: RECEIVE_WAIT_SECONDS,
        })
      )
      messages = result.Messages ?? []
    } catch (error) {
      logger.error('Could not receive AWS Marketplace events', {
        message: getErrorMessage(error, 'Unknown error'),
      })
      return
    }
    if (messages.length === 0) return

    for (const message of messages) {
      summary.received++
      const outcome = await handleMessage(productCode, message)
      summary[outcome]++
      if (outcome === 'retained' || !message.ReceiptHandle) continue
      try {
        await client.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle })
        )
      } catch (error) {
        logger.warn('Could not delete a handled AWS Marketplace event; it will be redelivered', {
          messageId: message.MessageId,
          message: getErrorMessage(error, 'Unknown error'),
        })
      }
    }
  }
}

async function reverifyStaleLicenses(
  productCode: string,
  summary: AwsMarketplaceReconcileSummary
): Promise<void> {
  const cutoff = new Date(Date.now() - REVERIFY_AFTER_MS)
  const licenseArns = await listLicensesVerifiedBefore(cutoff, REVERIFY_BATCH_SIZE)
  for (const licenseArn of licenseArns) {
    const verifiedAt = new Date()
    try {
      const entitlements = await verifyLicense(productCode, licenseArn)
      await recordLicenseVerification({
        licenseArn,
        productCode,
        summary: entitlements,
        verifiedAt,
      })
      summary.reverified++
    } catch (error) {
      summary.reverifyFailed++
      logger.warn('Could not re-verify an AWS Marketplace license', {
        message: getErrorMessage(error, 'Unknown error'),
      })
    }
  }
}

/**
 * Applies queued agreement events, then re-reads licenses no event touched within a day. Both
 * passes are bounded and idempotent: every write is the Entitlement Service's current answer, and
 * an older read never overwrites a newer one. Returns null when the feature is off.
 */
export async function reconcileAwsMarketplaceLicenses(): Promise<AwsMarketplaceReconcileSummary | null> {
  const productCode = getAwsMarketplaceProductCode()
  if (!productCode) return null
  const summary: AwsMarketplaceReconcileSummary = {
    received: 0,
    applied: 0,
    discarded: 0,
    retained: 0,
    reverified: 0,
    reverifyFailed: 0,
  }
  const queueUrl = env.AWS_MARKETPLACE_EVENTS_QUEUE_URL
  if (queueUrl) await drainEvents(productCode, queueUrl, summary)
  await reverifyStaleLicenses(productCode, summary)
  return summary
}
