import { db } from '@sim/db'
import {
  awsMarketplaceLicense,
  member,
  organization,
  outboxEvent,
  subscription,
  user,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
} from 'drizzle-orm'
import type { EntitlementSummary } from '@/lib/billing/aws-marketplace/entitlements'
import {
  AWS_MARKETPLACE_BUYER_NOTICE_EVENT,
  AWS_MARKETPLACE_TEAM_NOTICE_EVENT,
  type AwsMarketplaceBuyerNotice,
  type AwsMarketplaceNoticeTerms,
  type AwsMarketplaceTeamNotice,
} from '@/lib/billing/aws-marketplace/notice-events'
import type {
  AwsMarketplaceProduct,
  AwsMarketplaceProducts,
} from '@/lib/billing/aws-marketplace/products'
import { TERMINAL_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import type { DbTransaction } from '@/lib/db/types'

export type AwsMarketplaceLicenseRecord = typeof awsMarketplaceLicense.$inferSelect
type AwsMarketplaceLicenseStatus = AwsMarketplaceLicenseRecord['status']

const MAX_LICENSES_PER_AGREEMENT = 20

/** One verification read, as a writer applies it under the license's row lock. */
export interface LicenseVerification {
  summary: EntitlementSummary
  /** When the read started; a read older than the row's last one changes nothing. */
  verifiedAt: Date
  /**
   * AWS said this license ended (Deprovisioned or Agreement Ended), so no entitlements means it
   * lapsed rather than that AWS has not finished setting it up.
   */
  ended?: boolean
}

/** Where an agreement ID came from, and when that source was true. */
interface AgreementObservation {
  agreementId: string | null
  seenAt: Date | null
}

function enqueueTeamNotice(tx: DbTransaction, notice: AwsMarketplaceTeamNotice, id?: string) {
  return enqueueOutboxEvent(tx, AWS_MARKETPLACE_TEAM_NOTICE_EVENT, notice, { id })
}

/** Enqueues a team notice under a fixed id unless one with that id was already sent. */
async function enqueueTeamNoticeOnce(
  tx: DbTransaction,
  notice: AwsMarketplaceTeamNotice,
  id: string
): Promise<void> {
  const [sent] = await tx
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(eq(outboxEvent.id, id))
    .limit(1)
  if (!sent) await enqueueTeamNotice(tx, notice, id)
}

function enqueueBuyerNotice(tx: DbTransaction, notice: AwsMarketplaceBuyerNotice) {
  return enqueueOutboxEvent(tx, AWS_MARKETPLACE_BUYER_NOTICE_EVENT, notice)
}

/** Whether a read that started at `verifiedAt` may overwrite what the row last recorded. */
export function isNewerRead(license: AwsMarketplaceLicenseRecord, verifiedAt: Date): boolean {
  return license.lastVerifiedAt.getTime() <= verifiedAt.getTime()
}

/**
 * No answer about access after AWS has said the license ended, or on a license that was already
 * confirmed once, is a lapse. Otherwise AWS may simply not have finished, so the license stays pending.
 */
function statusFromRead(
  prior: AwsMarketplaceLicenseStatus | null,
  { summary, ended }: LicenseVerification
): AwsMarketplaceLicenseStatus {
  if (summary.active) return 'active'
  if (summary.accessReported || ended) return 'inactive'
  return prior === null || prior === 'pending' ? 'pending' : 'inactive'
}

/**
 * The columns a read writes. With no answer about access the last-known dimension, quantity, and
 * expiry stay as they were, and only the status can change. The read that first finds a license
 * inactive records when it ended.
 */
function verificationFields(
  prior: AwsMarketplaceLicenseStatus | null,
  verification: LicenseVerification
) {
  const status = statusFromRead(prior, verification)
  const { summary, verifiedAt } = verification
  return {
    status,
    ...(status === 'inactive'
      ? prior !== 'inactive' && { endedAt: verifiedAt }
      : { endedAt: null }),
    lastVerifiedAt: verifiedAt,
    lastVerificationAttemptAt: verifiedAt,
    updatedAt: new Date(),
    ...(summary.accessReported && {
      dimension: summary.dimension,
      quantity: summary.quantity,
      expiresAt: summary.expiresAt,
    }),
  }
}

/** An inactive license has nothing to claim, whatever else the writer sets. */
const NO_CLAIM = { claimTokenHash: null, claimExpiresAt: null }

function termsOf(license: AwsMarketplaceLicenseRecord): AwsMarketplaceNoticeTerms {
  return {
    status: license.status,
    dimension: license.dimension,
    quantity: license.quantity,
    expiresAt: license.expiresAt?.toISOString() ?? null,
  }
}

function termsDiffer(before: AwsMarketplaceNoticeTerms, after: AwsMarketplaceNoticeTerms): boolean {
  return (
    before.status !== after.status ||
    before.dimension !== after.dimension ||
    before.quantity !== after.quantity ||
    before.expiresAt !== after.expiresAt
  )
}

/**
 * The one place a read reaches a stored license, for every writer: under the caller's row lock it
 * applies the read unless a newer one is stored, and when that moves the terms, enqueues the team's
 * notice in the same transaction. `alongside` is written either way, except a claim on a license
 * that ends up inactive.
 */
async function applyVerification(
  tx: DbTransaction,
  locked: AwsMarketplaceLicenseRecord,
  verification: LicenseVerification,
  alongside: Partial<typeof awsMarketplaceLicense.$inferInsert> = {}
): Promise<AwsMarketplaceLicenseRecord> {
  const fresh = isNewerRead(locked, verification.verifiedAt)
  const status = fresh ? statusFromRead(locked.status, verification) : locked.status
  const [license] = await tx
    .update(awsMarketplaceLicense)
    .set({
      ...(fresh ? verificationFields(locked.status, verification) : { updatedAt: new Date() }),
      ...alongside,
      ...(status === 'inactive' && NO_CLAIM),
    })
    .where(eq(awsMarketplaceLicense.id, locked.id))
    .returning()
  const before = termsOf(locked)
  const after = termsOf(license)
  if (fresh && termsDiffer(before, after)) {
    await enqueueTeamNotice(tx, { kind: 'terms-changed', licenseId: license.id, before, after })
  }
  return license
}

/** The agreement columns an observation may write: never one older than what is stored. */
function agreementFields(locked: AwsMarketplaceLicenseRecord | null, seen: AgreementObservation) {
  if (!seen.agreementId) return {}
  const stored = locked?.agreementSeenAt
  const older = stored ? !seen.seenAt || seen.seenAt.getTime() < stored.getTime() : false
  if (older || (locked?.agreementId && !seen.seenAt)) return {}
  return { agreementId: seen.agreementId, agreementSeenAt: seen.seenAt }
}

async function lockByArn(tx: DbTransaction, licenseArn: string) {
  const [locked] = await tx
    .select()
    .from(awsMarketplaceLicense)
    .where(eq(awsMarketplaceLicense.licenseArn, licenseArn))
    .for('update')
    .limit(1)
  return locked ?? null
}

/**
 * AWS grants a new license with every new agreement. When a license with no owner names an
 * agreement a linked license was renewed to, it carries on that license's organization, linker,
 * and contact. Runs from whichever arrives second, the Created event or the license itself.
 */
async function inheritFromRenewedLicense(
  tx: DbTransaction,
  license: AwsMarketplaceLicenseRecord
): Promise<AwsMarketplaceLicenseRecord> {
  if (!license.agreementId || license.organizationId || license.linkedByUserId) return license
  const [predecessor] = await tx
    .select()
    .from(awsMarketplaceLicense)
    .where(
      and(
        eq(awsMarketplaceLicense.renewedAgreementId, license.agreementId),
        eq(awsMarketplaceLicense.productCode, license.productCode),
        eq(awsMarketplaceLicense.customerAwsAccountId, license.customerAwsAccountId),
        ne(awsMarketplaceLicense.id, license.id),
        or(
          isNotNull(awsMarketplaceLicense.organizationId),
          isNotNull(awsMarketplaceLicense.linkedByUserId)
        )
      )
    )
    .orderBy(asc(awsMarketplaceLicense.organizationId))
    .limit(1)
  if (!predecessor) return license
  const [inherited] = await tx
    .update(awsMarketplaceLicense)
    .set({
      ...organizationLink(predecessor.organizationId),
      linkedByUserId: predecessor.linkedByUserId,
      contactEmail: predecessor.contactEmail,
      companyName: predecessor.companyName,
      updatedAt: new Date(),
    })
    .where(eq(awsMarketplaceLicense.id, license.id))
    .returning()
  return inherited
}

/**
 * Creates the row for a license nobody stored yet, carrying on a renewed license's owner, and tells
 * the team. Null when the ARN already has a row, which the caller then updates under its lock.
 */
async function insertNewLicense(
  tx: DbTransaction,
  input: {
    licenseArn: string
    productCode: string
    customerAwsAccountId: string
    seen: AgreementObservation
    verification: LicenseVerification
    alongside: Partial<typeof awsMarketplaceLicense.$inferInsert>
  },
  source: 'registration' | 'event'
): Promise<AwsMarketplaceLicenseRecord | null> {
  const status = statusFromRead(null, input.verification)
  const [created] = await tx
    .insert(awsMarketplaceLicense)
    .values({
      id: generateId(),
      licenseArn: input.licenseArn,
      productCode: input.productCode,
      customerAwsAccountId: input.customerAwsAccountId,
      ...agreementFields(null, input.seen),
      ...input.alongside,
      ...verificationFields(null, input.verification),
      ...(status === 'inactive' && NO_CLAIM),
    })
    .onConflictDoNothing({ target: awsMarketplaceLicense.licenseArn })
    .returning()
  if (!created) return null
  const license = await inheritFromRenewedLicense(tx, created)
  await enqueueTeamNotice(tx, { kind: 'new-license', licenseId: license.id, source })
  return license
}

/**
 * Records a registration: the license row keyed by its ARN, with `claim` unless the newest answer
 * is inactive. A new row tells the team at once, so a buyer who pays and abandons setup is seen.
 */
export async function saveRegisteredLicense(input: {
  licenseArn: string
  productCode: string
  customerAwsAccountId: string
  agreementId: string | null
  verification: LicenseVerification
  claim: { hash: string; expiresAt: Date }
}): Promise<{ id: string; status: AwsMarketplaceLicenseStatus }> {
  const { verification, claim } = input
  const claimFields = { claimTokenHash: claim.hash, claimExpiresAt: claim.expiresAt }
  const seen = { agreementId: input.agreementId, seenAt: verification.verifiedAt }
  return db.transaction(async (tx) => {
    const created = await insertNewLicense(
      tx,
      { ...input, seen, alongside: claimFields },
      'registration'
    )
    if (created) return { id: created.id, status: created.status }

    const locked = await lockByArn(tx, input.licenseArn)
    if (!locked) throw new Error('AWS Marketplace license vanished during registration')
    const written = await applyVerification(tx, locked, verification, {
      ...agreementFields(locked, seen),
      ...claimFields,
    })
    const license = await inheritFromRenewedLicense(tx, written)
    return { id: license.id, status: license.status }
  })
}

type LicenseVerificationOutcome =
  | { kind: 'created' | 'updated'; license: AwsMarketplaceLicenseRecord }
  /** No row, and AWS described nothing to create one from. */
  | { kind: 'skipped' }

/**
 * Applies a verification read. A license AWS describes with an entitlement but nobody registered is
 * recorded (a renewal gets a new ARN), carrying on a renewed license's owner when there is one; one
 * AWS no longer describes is only updated if it exists. The first License Updated event for a
 * license already taken tells the team, whose earlier notice said to wait for it.
 */
export async function recordLicenseVerification(input: {
  licenseArn: string
  productCode: string
  verification: LicenseVerification
  /** The account from the event, for an entitlement that omits it. */
  fallbackAccountId?: string | null
  agreement?: AgreementObservation
  /** When a License Updated event was applied, which AWS asks to wait for before activating. */
  licenseEventReceivedAt?: Date
}): Promise<LicenseVerificationOutcome> {
  const { verification, licenseEventReceivedAt } = input
  const seen = input.agreement ?? { agreementId: null, seenAt: null }
  const stamp = licenseEventReceivedAt ? { licenseEventReceivedAt } : {}
  return db.transaction(async (tx) => {
    const accountId = verification.summary.customerAwsAccountId ?? input.fallbackAccountId
    if (accountId && verification.summary.licenseSeen) {
      const created = await insertNewLicense(
        tx,
        {
          licenseArn: input.licenseArn,
          productCode: input.productCode,
          customerAwsAccountId: accountId,
          seen,
          verification,
          alongside: stamp,
        },
        'event'
      )
      if (created) return { kind: 'created', license: created }
    }
    const locked = await lockByArn(tx, input.licenseArn)
    if (!locked) return { kind: 'skipped' }
    const written = await applyVerification(tx, locked, verification, {
      ...agreementFields(locked, seen),
      ...stamp,
    })
    const license = await inheritFromRenewedLicense(tx, written)
    if (
      licenseEventReceivedAt &&
      !locked.licenseEventReceivedAt &&
      (license.organizationId || license.linkedByUserId)
    ) {
      await enqueueTeamNotice(
        tx,
        { kind: 'license-event-received', licenseId: license.id },
        `aws-marketplace-license-event-${license.id}`
      )
    }
    return { kind: 'updated', license }
  })
}

/**
 * Records that `agreementId` replaced `previousAgreementId`, from either arrival order, and tells
 * the team. A renewal is accepted only on a row with none recorded or one naming the previous
 * agreement, so a late A→B cannot overwrite B→C. Rows already on the new agreement count too, so
 * the notice survives a license event that got here first, and SQS redelivery cannot send it twice.
 * Returns whether any stored license was involved.
 */
export async function applyAgreementRenewal(input: {
  products: AwsMarketplaceProducts
  previousAgreementId: string
  agreementId: string
}): Promise<boolean> {
  const { products, previousAgreementId, agreementId } = input
  return db.transaction(async (tx) => {
    const predecessors = await tx
      .select()
      .from(awsMarketplaceLicense)
      .where(belongsToAgreement(products, previousAgreementId))
      .for('update')
    const accepted = predecessors.filter(
      (row) => row.renewedAgreementId === null || row.renewedAgreementId === previousAgreementId
    )
    if (accepted.length > 0) {
      await tx
        .update(awsMarketplaceLicense)
        .set({ renewedAgreementId: agreementId, updatedAt: new Date() })
        .where(
          inArray(
            awsMarketplaceLicense.id,
            accepted.map((row) => row.id)
          )
        )
    }
    const successors = await tx
      .select()
      .from(awsMarketplaceLicense)
      .where(and(ofProducts(products), eq(awsMarketplaceLicense.agreementId, agreementId)))
      .for('update')
    for (const successor of successors) await inheritFromRenewedLicense(tx, successor)

    const licenseIds = [...accepted, ...successors].map((row) => row.id)
    if (licenseIds.length === 0) return false
    await enqueueTeamNoticeOnce(
      tx,
      { kind: 'renewed', licenseIds, previousAgreementId, agreementId },
      `aws-marketplace-renewal-${agreementId}`
    )
    return true
  })
}

/** Tells the team of an AWS advisory on an agreement we hold; redelivery cannot send it twice. */
export async function enqueueAgreementAdvisory(input: {
  products: AwsMarketplaceProducts
  agreementId: string
  state: 'issued' | 'resolved'
  detail: string
  messageId: string
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: awsMarketplaceLicense.id })
      .from(awsMarketplaceLicense)
      .where(belongsToAgreement(input.products, input.agreementId))
      .limit(MAX_LICENSES_PER_AGREEMENT)
    if (rows.length === 0) return false
    await enqueueTeamNoticeOnce(
      tx,
      {
        kind: 'advisory',
        licenseIds: rows.map((row) => row.id),
        agreementId: input.agreementId,
        state: input.state,
        detail: input.detail,
      },
      `aws-marketplace-advisory-${input.messageId}`
    )
    return true
  })
}

function ofProducts(products: AwsMarketplaceProducts) {
  return inArray(awsMarketplaceLicense.productCode, [...products.keys()])
}

function belongsToAgreement(products: AwsMarketplaceProducts, agreementId: string) {
  return and(
    ofProducts(products),
    or(
      eq(awsMarketplaceLicense.agreementId, agreementId),
      eq(awsMarketplaceLicense.renewedAgreementId, agreementId)
    )
  )
}

/** A license to re-read, with the product it was sold under. */
interface LicenseToVerify {
  licenseArn: string
  product: AwsMarketplaceProduct
}

const LICENSE_TO_VERIFY_COLUMNS = {
  licenseArn: awsMarketplaceLicense.licenseArn,
  productCode: awsMarketplaceLicense.productCode,
}

/**
 * The columns that point a license at `organizationId`, stamping when, since usage counts from
 * the link. Every caller links only when the organization changes, so the stamp is the start of
 * this organization's tenure on the license.
 */
function organizationLink(organizationId: string | null) {
  return { organizationId, organizationLinkedAt: organizationId ? new Date() : null }
}

/** Pairs each row with its product; the queries already keep to configured products. */
function withProducts(
  rows: Array<{ licenseArn: string; productCode: string }>,
  products: AwsMarketplaceProducts
): LicenseToVerify[] {
  return rows.flatMap(({ licenseArn, productCode }) => {
    const product = products.get(productCode)
    return product ? [{ licenseArn, product }] : []
  })
}

/**
 * The licenses an agreement covers, least recently attempted first, so a redelivered message moves
 * on to the ones an earlier delivery did not reach.
 */
export async function listLicensesForAgreement(
  products: AwsMarketplaceProducts,
  agreementId: string
): Promise<LicenseToVerify[]> {
  const rows = await db
    .select(LICENSE_TO_VERIFY_COLUMNS)
    .from(awsMarketplaceLicense)
    .where(belongsToAgreement(products, agreementId))
    .orderBy(asc(awsMarketplaceLicense.lastVerificationAttemptAt))
    .limit(MAX_LICENSES_PER_AGREEMENT)
  return withProducts(rows, products)
}

/** Licenses of these products longest since an attempt, up to `limit`, none after `cutoff`. */
export async function listLicensesDueForReverify(
  products: AwsMarketplaceProducts,
  cutoff: Date,
  limit: number
): Promise<LicenseToVerify[]> {
  const rows = await db
    .select(LICENSE_TO_VERIFY_COLUMNS)
    .from(awsMarketplaceLicense)
    .where(and(ofProducts(products), lt(awsMarketplaceLicense.lastVerificationAttemptAt, cutoff)))
    .orderBy(asc(awsMarketplaceLicense.lastVerificationAttemptAt))
    .limit(limit)
  return withProducts(rows, products)
}

/** Stamps an attempt to verify a license, before its outcome is known. */
export async function markVerificationAttempted(licenseArn: string, attemptedAt: Date) {
  await db
    .update(awsMarketplaceLicense)
    .set({ lastVerificationAttemptAt: attemptedAt })
    .where(eq(awsMarketplaceLicense.licenseArn, licenseArn))
}

export async function findLicenseByClaimHash(
  claimTokenHash: string
): Promise<AwsMarketplaceLicenseRecord | null> {
  const [row] = await db
    .select()
    .from(awsMarketplaceLicense)
    .where(eq(awsMarketplaceLicense.claimTokenHash, claimTokenHash))
    .limit(1)
  return row ?? null
}

export async function lockLicense(
  tx: DbTransaction,
  licenseId: string
): Promise<AwsMarketplaceLicenseRecord | null> {
  const [row] = await tx
    .select()
    .from(awsMarketplaceLicense)
    .where(eq(awsMarketplaceLicense.id, licenseId))
    .for('update')
    .limit(1)
  return row ?? null
}

/** Whom to contact about provisioning; AWS asks the registration page to collect it. */
export interface BuyerContact {
  contactEmail: string
  companyName: string | null
}

function contactChanged(locked: AwsMarketplaceLicenseRecord, contact: BuyerContact): boolean {
  return locked.contactEmail !== contact.contactEmail || locked.companyName !== contact.companyName
}

/**
 * Consumes the claim under the caller's row lock, taking the license when `link` is given: for an
 * organization, or for an account alone when its organization is null. A take tells the team and
 * confirms to the buyer in the same transaction. A license the same party already holds keeps its
 * link and announces only new contact details.
 */
export async function consumeLicenseClaim(
  tx: DbTransaction,
  locked: AwsMarketplaceLicenseRecord,
  input: {
    link: { organizationId: string | null; userId: string } | null
    contact: BuyerContact
    verification: LicenseVerification
  }
): Promise<AwsMarketplaceLicenseRecord> {
  const license = await applyVerification(tx, locked, input.verification, {
    contactEmail: input.contact.contactEmail,
    companyName: input.contact.companyName,
    ...(input.link && {
      ...organizationLink(input.link.organizationId),
      linkedByUserId: input.link.userId,
    }),
    claimTokenHash: null,
    claimExpiresAt: null,
  })
  if (input.link) {
    await enqueueTeamNotice(tx, { kind: 'taken', licenseId: license.id, userId: input.link.userId })
    await enqueueBuyerNotice(tx, { licenseId: license.id })
  } else if (contactChanged(locked, input.contact)) {
    await enqueueTeamNotice(tx, { kind: 'contact', licenseId: license.id })
  }
  return license
}

/**
 * Applies a pending buyer's fresh read and their contact details, keeping the claim open. New
 * details tell the team whom to reach while AWS finishes confirming.
 */
export async function saveLicenseContact(
  tx: DbTransaction,
  locked: AwsMarketplaceLicenseRecord,
  input: {
    contact: BuyerContact
    verification: LicenseVerification
  }
): Promise<AwsMarketplaceLicenseRecord> {
  const changed = contactChanged(locked, input.contact)
  const license = await applyVerification(tx, locked, input.verification, {
    contactEmail: input.contact.contactEmail,
    companyName: input.contact.companyName,
  })
  if (changed) await enqueueTeamNotice(tx, { kind: 'contact', licenseId: license.id })
  return license
}

/** Organizations the user owns or administers, which are the ones a license may be linked to. */
export async function listAdministeredOrganizations(
  userId: string
): Promise<Array<{ id: string; name: string }>> {
  return db
    .select({ id: organization.id, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(eq(member.userId, userId), inArray(member.role, ['owner', 'admin'])))
    .orderBy(asc(organization.name))
}

const STATUS_COLUMNS = {
  id: awsMarketplaceLicense.id,
  status: awsMarketplaceLicense.status,
  dimension: awsMarketplaceLicense.dimension,
  quantity: awsMarketplaceLicense.quantity,
  expiresAt: awsMarketplaceLicense.expiresAt,
  lastVerifiedAt: awsMarketplaceLicense.lastVerifiedAt,
}

/** What an organization's members see of the Marketplace licenses linked to it. */
export async function listOrganizationLicenses(organizationId: string) {
  return db
    .select(STATUS_COLUMNS)
    .from(awsMarketplaceLicense)
    .where(eq(awsMarketplaceLicense.organizationId, organizationId))
    .orderBy(asc(awsMarketplaceLicense.createdAt))
}

/** What a buyer sees of the licenses registered to their account, before an organization exists. */
export async function listAccountLicenses(userId: string) {
  return db
    .select(STATUS_COLUMNS)
    .from(awsMarketplaceLicense)
    .where(
      and(
        eq(awsMarketplaceLicense.linkedByUserId, userId),
        isNull(awsMarketplaceLicense.organizationId)
      )
    )
    .orderBy(asc(awsMarketplaceLicense.createdAt))
}

/**
 * Whether AWS Marketplace bills this billing reference: a license of a listing this deployment
 * sells that is not inactive, linked to the organization, or registered to the user's account with
 * no organization yet.
 */
export async function holdsMarketplaceLicense(
  products: AwsMarketplaceProducts,
  referenceId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: awsMarketplaceLicense.id })
    .from(awsMarketplaceLicense)
    .where(
      and(
        ofProducts(products),
        ne(awsMarketplaceLicense.status, 'inactive'),
        or(
          eq(awsMarketplaceLicense.organizationId, referenceId),
          and(
            isNull(awsMarketplaceLicense.organizationId),
            eq(awsMarketplaceLicense.linkedByUserId, referenceId)
          )
        )
      )
    )
    .limit(1)
  return Boolean(row)
}

/**
 * Licenses with no organization, newest first, for the admin dashboard: those waiting for the team
 * to link them, and inactive ones that never will be.
 */
export async function listUnlinkedLicenses(page: { limit: number; offset: number }) {
  return db
    .select()
    .from(awsMarketplaceLicense)
    .where(isNull(awsMarketplaceLicense.organizationId))
    .orderBy(desc(awsMarketplaceLicense.createdAt))
    .limit(page.limit)
    .offset(page.offset)
}

export async function countUnlinkedLicenses(): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(awsMarketplaceLicense)
    .where(isNull(awsMarketplaceLicense.organizationId))
  return row?.total ?? 0
}

/** Sets a license's organization under its row lock; any outstanding claim has no further use. */
export async function linkLicenseForTeam(
  tx: DbTransaction,
  licenseId: string,
  organizationId: string
): Promise<AwsMarketplaceLicenseRecord> {
  const [license] = await tx
    .update(awsMarketplaceLicense)
    .set({
      ...organizationLink(organizationId),
      claimTokenHash: null,
      claimExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(awsMarketplaceLicense.id, licenseId))
    .returning()
  return license
}

/**
 * Whether the organization has a live Stripe subscription to a self-serve plan: any it is bound to
 * that has not finished, since a trial or a payment still pending turns into a charge. Enterprise
 * is provisioned by the team, who pause its collection for a Marketplace customer.
 */
export async function paysForSelfServePlan(
  tx: DbTransaction,
  organizationId: string
): Promise<boolean> {
  const [row] = await tx
    .select({ id: subscription.id })
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceId, organizationId),
        isNotNull(subscription.stripeSubscriptionId),
        notInArray(subscription.status, [...TERMINAL_SUBSCRIPTION_STATUSES]),
        ne(subscription.plan, 'enterprise')
      )
    )
    .limit(1)
  return Boolean(row)
}

export async function organizationExists(tx: DbTransaction, organizationId: string) {
  const [row] = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  return Boolean(row)
}

/** Who linked a license to which organization, for the team's provisioning notice. */
export async function getLinkParties(
  organizationId: string | null,
  userId: string | null
): Promise<{ organizationName: string | null; userName: string | null; userEmail: string | null }> {
  const [[org], [person]] = await Promise.all([
    organizationId
      ? db
          .select({ name: organization.name })
          .from(organization)
          .where(eq(organization.id, organizationId))
          .limit(1)
      : Promise.resolve([]),
    userId
      ? db
          .select({ name: user.name, email: user.email })
          .from(user)
          .where(eq(user.id, userId))
          .limit(1)
      : Promise.resolve([]),
  ])
  return {
    organizationName: org?.name ?? null,
    userName: person?.name ?? null,
    userEmail: person?.email ?? null,
  }
}

export async function getLicensesByIds(licenseIds: readonly string[]) {
  if (licenseIds.length === 0) return []
  return db
    .select()
    .from(awsMarketplaceLicense)
    .where(inArray(awsMarketplaceLicense.id, [...licenseIds]))
}

/**
 * Organizations already linked to another license of this AWS account, on any listing, for the
 * team to match: a buyer moving to a new listing usually wants the organization they already have.
 */
export async function listOrganizationsLinkedToAccount(input: {
  customerAwsAccountId: string
  excludingLicenseArn: string
}): Promise<Array<{ id: string; name: string }>> {
  return db
    .selectDistinct({ id: organization.id, name: organization.name })
    .from(awsMarketplaceLicense)
    .innerJoin(organization, eq(awsMarketplaceLicense.organizationId, organization.id))
    .where(
      and(
        eq(awsMarketplaceLicense.customerAwsAccountId, input.customerAwsAccountId),
        ne(awsMarketplaceLicense.licenseArn, input.excludingLicenseArn)
      )
    )
    .orderBy(asc(organization.name))
}
