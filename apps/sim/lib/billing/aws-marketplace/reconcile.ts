import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs'
import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { getEventsQueueClient } from '@/lib/billing/aws-marketplace/client'
import { getAwsMarketplaceProducts } from '@/lib/billing/aws-marketplace/config'
import {
  isInvalidEntitlementRequest,
  verifyLicense,
} from '@/lib/billing/aws-marketplace/entitlements'
import type {
  AwsMarketplaceProduct,
  AwsMarketplaceProducts,
} from '@/lib/billing/aws-marketplace/products'
import {
  applyAgreementRenewal,
  enqueueAgreementAdvisory,
  listLicensesDueForReverify,
  listLicensesForAgreement,
  markVerificationAttempted,
  recordLicenseVerification,
} from '@/lib/billing/aws-marketplace/repository'
import { env } from '@/lib/core/config/env'

const logger = createLogger('AwsMarketplaceReconcile')

const EVENT_SOURCE = 'aws.agreement-marketplace'
const LICENSE_UPDATED_EVENT = 'License Updated - Manufacturer'
const LICENSE_DEPROVISIONED_EVENT = 'License Deprovisioned - Manufacturer'
const AGREEMENT_ENDED_EVENT_TYPES = new Set([
  'Purchase Agreement Ended - Proposer',
  'Purchase Agreement Ended - Manufacturer',
])
const AGREEMENT_CREATED_EVENT_TYPES = new Set([
  'Purchase Agreement Created - Proposer',
  'Purchase Agreement Created - Manufacturer',
])
const ADVISORY_STATE_BY_EVENT_TYPE = new Map<string, 'issued' | 'resolved'>([
  ['Purchase Agreement Advisory Issued - Manufacturer', 'issued'],
  ['Purchase Agreement Advisory Resolved - Manufacturer', 'resolved'],
])
const MAX_ADVISORY_DETAIL_LENGTH = 2_000

/** SQS caps one receive at 10 messages; a run drains at most this many batches. */
const RECEIVE_BATCH_SIZE = 10
const MAX_RECEIVE_BATCHES = 10
const RECEIVE_WAIT_SECONDS = 2
/** One license's read is aborted here, whatever the SDK's three attempts have reached. */
const LICENSE_READ_BUDGET_MS = 15_000
/**
 * A batch of 10 single-license messages reads for at most 10 × 15 s = 150 s, and notices are only
 * enqueued, so each receive hides its batch for 180 s; a multi-license message extends its own
 * visibility per license, and if that lets a sibling reappear, handling it again is idempotent. A
 * run starts no batch or re-verify that could read past 6 minutes, inside the cron's 10-minute lock.
 */
const BATCH_BUDGET_MS = RECEIVE_BATCH_SIZE * LICENSE_READ_BUDGET_MS
const VISIBILITY_TIMEOUT_SECONDS = 180
const RUN_BUDGET_MS = 6 * 60 * 1000

const REVERIFY_AFTER_MS = 24 * 60 * 60 * 1000
const REVERIFY_BATCH_SIZE = 50

interface AwsMarketplaceReconcileSummary {
  received: number
  applied: number
  discarded: number
  /** A Deprovisioned event for a license that has no row, so nothing is left to record. */
  skipped: number
  retained: number
  reverified: number
  reverifyFailed: number
  /** The run stopped draining or re-verifying because its wall-clock budget ran out. */
  outOfBudget: boolean
}

/** Whether work that may take up to `workMs` still ends inside the run's budget. */
type BudgetCheck = (workMs: number) => boolean

interface DrainContext {
  /** This run's configured products, by code; an event for any other product is not ours. */
  products: AwsMarketplaceProducts
  queueUrl: string
  summary: AwsMarketplaceReconcileSummary
  fits: BudgetCheck
}

type MarketplaceEvent =
  | {
      kind: 'license'
      deprovisioned: boolean
      licenseArn: string | null
      productCode: string | null
      agreementId: string | null
      acceptorAccountId: string | null
      occurredAt: Date | null
    }
  | { kind: 'agreement-ended'; agreementId: string }
  | { kind: 'agreement-created'; agreementId: string; previousAgreementId: string | null }
  | { kind: 'advisory'; agreementId: string; state: 'issued' | 'resolved'; detail: string }

function parseEventTime(value: unknown): Date | null {
  const text = toStringOrNull(value)
  const time = text ? new Date(text) : null
  return time && Number.isFinite(time.getTime()) ? time : null
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
  if (detailType === LICENSE_UPDATED_EVENT || detailType === LICENSE_DEPROVISIONED_EVENT) {
    return {
      kind: 'license',
      deprovisioned: detailType === LICENSE_DEPROVISIONED_EVENT,
      licenseArn: toStringOrNull(toRecord(detail.license).arn),
      productCode: toStringOrNull(toRecord(detail.product).code),
      agreementId,
      acceptorAccountId: toStringOrNull(toRecord(detail.acceptor).accountId),
      occurredAt: parseEventTime(event.time),
    }
  }
  if (!agreementId) return null
  if (AGREEMENT_ENDED_EVENT_TYPES.has(detailType)) return { kind: 'agreement-ended', agreementId }
  if (AGREEMENT_CREATED_EVENT_TYPES.has(detailType)) {
    return {
      kind: 'agreement-created',
      agreementId,
      previousAgreementId: toStringOrNull(agreement.previousAgreementId),
    }
  }
  const advisoryState = ADVISORY_STATE_BY_EVENT_TYPE.get(detailType)
  if (advisoryState) {
    return {
      kind: 'advisory',
      agreementId,
      state: advisoryState,
      detail: truncate(JSON.stringify(detail), MAX_ADVISORY_DETAIL_LENGTH),
    }
  }
  return null
}

type MessageOutcome = 'applied' | 'discarded' | 'skipped' | 'retained'

/** Stamps the attempt, asks the Entitlement Service, and records its answer. */
async function reverifyLicense(
  product: AwsMarketplaceProduct,
  licenseArn: string,
  options: Pick<
    Parameters<typeof recordLicenseVerification>[0],
    'agreement' | 'fallbackAccountId' | 'licenseEventReceivedAt'
  > & { ended?: boolean } = {}
) {
  const verifiedAt = new Date()
  await markVerificationAttempted(licenseArn, verifiedAt)
  const summary = await verifyLicense(
    product,
    licenseArn,
    AbortSignal.timeout(LICENSE_READ_BUDGET_MS)
  )
  const outcome = await recordLicenseVerification({
    licenseArn,
    productCode: product.productCode,
    verification: { summary, verifiedAt, ended: options.ended },
    agreement: options.agreement,
    fallbackAccountId: options.fallbackAccountId,
    licenseEventReceivedAt: options.licenseEventReceivedAt,
  })
  return { summary, outcome }
}

async function extendVisibility(
  context: DrainContext,
  message: Message,
  messageId: string | undefined
) {
  if (!message.ReceiptHandle) return
  try {
    await getEventsQueueClient().send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: context.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
      })
    )
  } catch (error) {
    logger.warn('Could not extend an AWS Marketplace event; it may be redelivered', {
      messageId,
      message: getErrorMessage(error, 'Unknown error'),
    })
  }
}

/**
 * Each license gets its own read bound and commits on its own, so one that fails or runs out of
 * time costs no other's progress. The message stays queued until AWS reports all of them ended,
 * since a read can lag the event, and a redelivery starts with those least recently attempted. An
 * agreement ID with no license is normal: the seller account has other products.
 */
async function applyAgreementEnded(
  context: DrainContext,
  agreementId: string,
  message: Message
): Promise<MessageOutcome> {
  const messageId = message.MessageId
  const licenses = await listLicensesForAgreement(context.products, agreementId)
  if (licenses.length === 0) {
    logger.info('Ignoring an AWS Marketplace agreement event for no stored license', { messageId })
    return 'discarded'
  }
  let incomplete = false
  for (const [index, { licenseArn, product }] of licenses.entries()) {
    if (!context.fits(LICENSE_READ_BUDGET_MS)) {
      context.summary.outOfBudget = true
      return 'retained'
    }
    if (index > 0) await extendVisibility(context, message, messageId)
    try {
      const { summary } = await reverifyLicense(product, licenseArn, { ended: true })
      if (summary.active) {
        incomplete = true
        logger.info('AWS still reports a license of an ended agreement current', { messageId })
      }
    } catch (error) {
      if (isInvalidEntitlementRequest(error)) {
        logger.warn('The Entitlement Service rejected a license of an ended agreement', {
          messageId,
          message: getErrorMessage(error, 'Unknown error'),
        })
        continue
      }
      incomplete = true
      logger.warn('Could not re-verify a license of an ended agreement', {
        messageId,
        message: getErrorMessage(error, 'Unknown error'),
      })
    }
  }
  return incomplete ? 'retained' : 'applied'
}

async function applyLicenseEvent(
  context: DrainContext,
  event: Extract<MarketplaceEvent, { kind: 'license' }>,
  messageId: string | undefined
): Promise<MessageOutcome> {
  const product = event.productCode ? context.products.get(event.productCode) : undefined
  if (!product) {
    logger.warn('Discarding an AWS Marketplace event for another product', { messageId })
    return 'discarded'
  }
  if (!event.licenseArn) {
    logger.warn('Leaving an AWS Marketplace license event with no ARN for the dead-letter queue', {
      messageId,
    })
    return 'retained'
  }
  const { summary, outcome } = await reverifyLicense(product, event.licenseArn, {
    ended: event.deprovisioned,
    agreement: { agreementId: event.agreementId, seenAt: event.occurredAt },
    fallbackAccountId: event.acceptorAccountId,
    licenseEventReceivedAt: event.deprovisioned ? undefined : new Date(),
  })
  if (outcome.kind === 'skipped') {
    if (!event.deprovisioned) {
      logger.warn('Leaving a License Updated event for a license AWS does not describe yet', {
        messageId,
      })
      return 'retained'
    }
    logger.warn('Skipping a License Deprovisioned event for a license with no row', { messageId })
    return 'skipped'
  }
  if (event.deprovisioned && summary.active) {
    logger.warn('AWS deprovisioned a license its Entitlement Service still reports as current', {
      messageId,
      licenseId: outcome.license.id,
    })
    return 'retained'
  }
  return 'applied'
}

/** Whether a stored license was involved in an advisory or a renewal. */
async function applyAgreementEvent(
  products: AwsMarketplaceProducts,
  event: Extract<MarketplaceEvent, { kind: 'advisory' | 'agreement-created' }>,
  messageId: string | undefined
): Promise<boolean> {
  if (event.kind === 'advisory') {
    return enqueueAgreementAdvisory({
      products,
      agreementId: event.agreementId,
      state: event.state,
      detail: event.detail,
      messageId: messageId ?? event.agreementId,
    })
  }
  if (!event.previousAgreementId) return false
  return applyAgreementRenewal({
    products,
    previousAgreementId: event.previousAgreementId,
    agreementId: event.agreementId,
  })
}

async function applyEvent(
  context: DrainContext,
  event: MarketplaceEvent,
  message: Message
): Promise<MessageOutcome> {
  const { products } = context
  const messageId = message.MessageId
  if (event.kind === 'license') return applyLicenseEvent(context, event, messageId)
  if (event.kind === 'agreement-ended') {
    return applyAgreementEnded(context, event.agreementId, message)
  }
  if (await applyAgreementEvent(products, event, messageId)) return 'applied'
  logger.info('Ignoring an AWS Marketplace agreement event for no stored license', { messageId })
  return 'discarded'
}

/**
 * Re-reads what an event concerns rather than trusting the event's own fields. A message that can
 * never apply is discarded; one that failed for a reason that may pass is retained, so SQS
 * redelivers it and the dead-letter queue catches one that never succeeds.
 */
async function handleMessage(context: DrainContext, message: Message): Promise<MessageOutcome> {
  const messageId = message.MessageId
  const event = parseMarketplaceEvent(message.Body)
  if (!event) {
    logger.warn('Discarding an unrecognized AWS Marketplace event', { messageId })
    return 'discarded'
  }
  try {
    return await applyEvent(context, event, message)
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

async function drainEvents(context: DrainContext): Promise<void> {
  const { queueUrl, summary, fits } = context
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
      // An ended agreement can read many licenses; what is not started stays queued for the next run.
      if (!fits(LICENSE_READ_BUDGET_MS)) {
        summary.outOfBudget = true
        return
      }
      summary.received++
      const outcome = await handleMessage(context, message)
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
  products: AwsMarketplaceProducts,
  summary: AwsMarketplaceReconcileSummary,
  fits: BudgetCheck
): Promise<void> {
  const cutoff = new Date(Date.now() - REVERIFY_AFTER_MS)
  const licenses = await listLicensesDueForReverify(products, cutoff, REVERIFY_BATCH_SIZE)
  for (const { licenseArn, product } of licenses) {
    if (!fits(LICENSE_READ_BUDGET_MS)) {
      summary.outOfBudget = true
      return
    }
    try {
      await reverifyLicense(product, licenseArn)
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
  const products = getAwsMarketplaceProducts()
  if (products.size === 0) return null
  const summary: AwsMarketplaceReconcileSummary = {
    received: 0,
    applied: 0,
    discarded: 0,
    skipped: 0,
    retained: 0,
    reverified: 0,
    reverifyFailed: 0,
    outOfBudget: false,
  }
  const startedAt = Date.now()
  const fits: BudgetCheck = (workMs) => Date.now() - startedAt + workMs <= RUN_BUDGET_MS
  const queueUrl = env.AWS_MARKETPLACE_EVENTS_QUEUE_URL
  if (queueUrl) await drainEvents({ products, queueUrl, summary, fits })
  await reverifyStaleLicenses(products, summary, fits)
  return summary
}
