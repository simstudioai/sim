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
  notifyTeamOfAgreementRenewal,
  notifyTeamOfVerification,
} from '@/lib/billing/aws-marketplace/notifications'
import {
  listLicensesDueForReverify,
  listLicensesForAgreement,
  markLicensesRenewed,
  markVerificationAttempted,
  recordLicenseVerification,
} from '@/lib/billing/aws-marketplace/repository'
import { env } from '@/lib/core/config/env'

const logger = createLogger('AwsMarketplaceReconcile')

const EVENT_SOURCE = 'aws.agreement-marketplace'
const LICENSE_EVENT_TYPES = new Set([
  'License Updated - Manufacturer',
  'License Deprovisioned - Manufacturer',
])
const AGREEMENT_ENDED_EVENT_TYPES = new Set([
  'Purchase Agreement Ended - Proposer',
  'Purchase Agreement Ended - Manufacturer',
])
const AGREEMENT_CREATED_EVENT_TYPES = new Set([
  'Purchase Agreement Created - Proposer',
  'Purchase Agreement Created - Manufacturer',
])

/** SQS caps one receive at 10 messages; a run drains at most this many batches. */
const RECEIVE_BATCH_SIZE = 10
const MAX_RECEIVE_BATCHES = 10
const RECEIVE_WAIT_SECONDS = 2
/** One message's or stale license's entitlement reads, retries included, are aborted past this. */
const MESSAGE_BUDGET_MS = 15_000
/** Messages in a batch are handled one after another. */
const BATCH_BUDGET_MS = RECEIVE_BATCH_SIZE * MESSAGE_BUDGET_MS
/**
 * 10 messages × 15 s = 150 s per batch, so each receive hides its batch for 180 s (above the work,
 * independent of the queue's 5-minute default), and a run starts no batch or re-verify that could
 * end past 6 minutes, well inside the cron's 10-minute lock.
 */
const VISIBILITY_TIMEOUT_SECONDS = 180
const RUN_BUDGET_MS = 6 * 60 * 1000

const REVERIFY_AFTER_MS = 24 * 60 * 60 * 1000
const REVERIFY_BATCH_SIZE = 50

interface AwsMarketplaceReconcileSummary {
  received: number
  applied: number
  discarded: number
  retained: number
  reverified: number
  reverifyFailed: number
  /** The run stopped draining or re-verifying because its wall-clock budget ran out. */
  outOfBudget: boolean
}

/** Whether work that may take up to `workMs` still ends inside the run's budget. */
type BudgetCheck = (workMs: number) => boolean

type MarketplaceEvent =
  | { kind: 'license'; licenseArn: string; productCode: string; agreementId: string | null }
  | { kind: 'agreement-ended'; agreementId: string }
  | {
      kind: 'agreement-created'
      agreementId: string
      intent: string | null
      previousAgreementId: string | null
    }

/**
 * The event a queue message carries, or null for a body that is not one. Agreement events name no
 * license, and the Proposer Ended event names no product, so they are matched by agreement ID.
 */
function parseMarketplaceEvent(body: string | undefined): MarketplaceEvent | null {
  if (!body) return null
  let event: Record<string, unknown>
  try {
    event = toRecord(JSON.parse(body))
  } catch {
    return null
  }
  const detailType = toStringOrNull(event['detail-type'])
  if (event.source !== EVENT_SOURCE || !detailType) return null
  const detail = toRecord(event.detail)
  const agreement = toRecord(detail.agreement)
  const agreementId = toStringOrNull(agreement.id)
  if (LICENSE_EVENT_TYPES.has(detailType)) {
    const licenseArn = toStringOrNull(toRecord(detail.license).arn)
    const productCode = toStringOrNull(toRecord(detail.product).code)
    return licenseArn && productCode
      ? { kind: 'license', licenseArn, productCode, agreementId }
      : null
  }
  if (!agreementId) return null
  if (AGREEMENT_ENDED_EVENT_TYPES.has(detailType)) return { kind: 'agreement-ended', agreementId }
  if (AGREEMENT_CREATED_EVENT_TYPES.has(detailType)) {
    return {
      kind: 'agreement-created',
      agreementId,
      intent: toStringOrNull(agreement.intent),
      previousAgreementId: toStringOrNull(agreement.previousAgreementId),
    }
  }
  return null
}

type MessageOutcome = 'applied' | 'discarded' | 'retained'

/** Stamps the attempt, asks the Entitlement Service, records its answer, and tells the team. */
async function reverifyLicense(
  productCode: string,
  licenseArn: string,
  signal: AbortSignal,
  agreementId?: string | null
): Promise<void> {
  const verifiedAt = new Date()
  await markVerificationAttempted(licenseArn, verifiedAt)
  const summary = await verifyLicense(productCode, licenseArn, signal)
  const outcome = await recordLicenseVerification({
    licenseArn,
    productCode,
    agreementId,
    summary,
    verifiedAt,
  })
  await notifyTeamOfVerification(outcome)
}

/** An agreement ID we hold no license for is normal: the seller account has other products. */
async function applyAgreementEnded(
  productCode: string,
  agreementId: string,
  messageId: string | undefined,
  signal: AbortSignal
): Promise<MessageOutcome> {
  const licenseArns = await listLicensesForAgreement(productCode, agreementId)
  if (licenseArns.length === 0) {
    logger.info('Ignoring an AWS Marketplace agreement event for no stored license', { messageId })
    return 'discarded'
  }
  for (const licenseArn of licenseArns) {
    await reverifyLicense(productCode, licenseArn, signal)
  }
  return 'applied'
}

async function applyAgreementCreated(
  productCode: string,
  event: Extract<MarketplaceEvent, { kind: 'agreement-created' }>,
  messageId: string | undefined
): Promise<MessageOutcome> {
  const previousAgreementId = event.intent === 'RENEW' ? event.previousAgreementId : null
  const renewed = previousAgreementId
    ? await markLicensesRenewed({
        productCode,
        previousAgreementId,
        agreementId: event.agreementId,
      })
    : []
  if (!previousAgreementId || renewed.length === 0) {
    logger.info('Ignoring an AWS Marketplace agreement event for no stored license', { messageId })
    return 'discarded'
  }
  await notifyTeamOfAgreementRenewal(renewed, {
    previousAgreementId,
    agreementId: event.agreementId,
  })
  return 'applied'
}

/**
 * Re-reads what an event concerns rather than trusting the event's own fields. A message that can
 * never apply is discarded; one that failed for a reason that may pass is retained, so SQS
 * redelivers it and the dead-letter queue catches one that never succeeds.
 */
async function handleMessage(productCode: string, message: Message): Promise<MessageOutcome> {
  const messageId = message.MessageId
  const event = parseMarketplaceEvent(message.Body)
  if (!event) {
    logger.warn('Discarding an unrecognized AWS Marketplace event', { messageId })
    return 'discarded'
  }
  if (event.kind === 'license' && event.productCode !== productCode) {
    logger.warn('Discarding an AWS Marketplace event for another product', { messageId })
    return 'discarded'
  }
  try {
    const signal = AbortSignal.timeout(MESSAGE_BUDGET_MS)
    if (event.kind === 'agreement-ended') {
      return await applyAgreementEnded(productCode, event.agreementId, messageId, signal)
    }
    if (event.kind === 'agreement-created') {
      return await applyAgreementCreated(productCode, event, messageId)
    }
    await reverifyLicense(productCode, event.licenseArn, signal, event.agreementId)
    return 'applied'
  } catch (error) {
    if (isInvalidEntitlementRequest(error)) {
      logger.warn('Discarding an AWS Marketplace event the Entitlement Service rejected', {
        messageId,
        message: getErrorMessage(error, 'Unknown error'),
      })
      return 'discarded'
    }
    logger.warn('Leaving an AWS Marketplace event for redelivery', {
      messageId,
      message: getErrorMessage(error, 'Unknown error'),
    })
    return 'retained'
  }
}

async function drainEvents(
  productCode: string,
  queueUrl: string,
  summary: AwsMarketplaceReconcileSummary,
  fits: BudgetCheck
): Promise<void> {
  const client = getEventsQueueClient()
  for (let batch = 0; batch < MAX_RECEIVE_BATCHES; batch++) {
    if (!fits(BATCH_BUDGET_MS)) {
      summary.outOfBudget = true
      return
    }
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
  summary: AwsMarketplaceReconcileSummary,
  fits: BudgetCheck
): Promise<void> {
  const cutoff = new Date(Date.now() - REVERIFY_AFTER_MS)
  const licenseArns = await listLicensesDueForReverify(cutoff, REVERIFY_BATCH_SIZE)
  for (const licenseArn of licenseArns) {
    if (!fits(MESSAGE_BUDGET_MS)) {
      summary.outOfBudget = true
      return
    }
    try {
      await reverifyLicense(productCode, licenseArn, AbortSignal.timeout(MESSAGE_BUDGET_MS))
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
 * Applies queued agreement events, then re-reads licenses not attempted within a day. Both passes
 * are bounded in count and wall-clock time, and idempotent: every write is the Entitlement
 * Service's current answer, and an older read never overwrites a newer one. Returns null when the
 * feature is off.
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
    outOfBudget: false,
  }
  const startedAt = Date.now()
  const fits: BudgetCheck = (workMs) => Date.now() - startedAt + workMs <= RUN_BUDGET_MS
  const queueUrl = env.AWS_MARKETPLACE_EVENTS_QUEUE_URL
  if (queueUrl) await drainEvents(productCode, queueUrl, summary, fits)
  await reverifyStaleLicenses(productCode, summary, fits)
  return summary
}
