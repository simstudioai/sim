import { db } from '@sim/db'
import { awsMarketplaceLicense, member, organization, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import type { EntitlementSummary } from '@/lib/billing/aws-marketplace/entitlements'
import type { DbTransaction } from '@/lib/db/types'

export type AwsMarketplaceLicenseRecord = typeof awsMarketplaceLicense.$inferSelect

interface AdministeredOrganization {
  id: string
  name: string
  role: 'owner' | 'admin'
}

/**
 * The verification columns a read writes. A deprovisioned license returns no entitlements, so its
 * last-known dimension, quantity, and expiry stay as they were and only the status changes.
 */
function verificationFields(summary: EntitlementSummary, verifiedAt: Date) {
  return {
    status: summary.active ? ('active' as const) : ('inactive' as const),
    lastVerifiedAt: verifiedAt,
    updatedAt: new Date(),
    ...(summary.entitlementCount > 0 && {
      dimension: summary.dimension,
      quantity: summary.quantity,
      expiresAt: summary.expiresAt,
    }),
  }
}

/** Whether a read that started at `verifiedAt` may overwrite what the row last recorded. */
function isNewerRead(license: AwsMarketplaceLicenseRecord, verifiedAt: Date): boolean {
  return license.lastVerifiedAt.getTime() <= verifiedAt.getTime()
}

/**
 * Records a registration: the license row keyed by its ARN, as ResolveCustomer and the
 * Entitlement Service described it, with the claim when the license is active. Every writer of
 * entitlement fields follows one rule: a read older than the row's last one changes none of them,
 * so a slow registration cannot restore `active` after the reconcile recorded `inactive`. The
 * claim is stored only while the newest answer is active, and an inactive one clears any claim
 * outstanding from an earlier registration.
 */
export async function saveRegisteredLicense(input: {
  licenseArn: string
  productCode: string
  customerAwsAccountId: string
  customerIdentifier: string | null
  agreementId: string | null
  summary: EntitlementSummary
  verifiedAt: Date
  claim: { hash: string; expiresAt: Date } | null
}): Promise<{ id: string; active: boolean }> {
  const identity = {
    productCode: input.productCode,
    customerAwsAccountId: input.customerAwsAccountId,
    ...(input.customerIdentifier && { customerIdentifier: input.customerIdentifier }),
    ...(input.agreementId && { agreementId: input.agreementId }),
  }
  const claimFields = (active: boolean) => ({
    claimTokenHash: active ? (input.claim?.hash ?? null) : null,
    claimExpiresAt: active ? (input.claim?.expiresAt ?? null) : null,
  })
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(awsMarketplaceLicense)
      .values({
        id: generateId(),
        licenseArn: input.licenseArn,
        ...identity,
        ...verificationFields(input.summary, input.verifiedAt),
        ...claimFields(input.summary.active),
      })
      .onConflictDoNothing({ target: awsMarketplaceLicense.licenseArn })
      .returning({ id: awsMarketplaceLicense.id })
    if (created) return { id: created.id, active: input.summary.active }

    const [locked] = await tx
      .select()
      .from(awsMarketplaceLicense)
      .where(eq(awsMarketplaceLicense.licenseArn, input.licenseArn))
      .for('update')
      .limit(1)
    const fresh = isNewerRead(locked, input.verifiedAt)
    const active = fresh ? input.summary.active : locked.status === 'active'
    await tx
      .update(awsMarketplaceLicense)
      .set({
        ...identity,
        ...(fresh
          ? verificationFields(input.summary, input.verifiedAt)
          : { updatedAt: new Date() }),
        ...claimFields(active && input.summary.active),
      })
      .where(eq(awsMarketplaceLicense.id, locked.id))
    return { id: locked.id, active: active && input.summary.active }
  })
}

/** The terms the team provisions from; a change to any of them needs their attention. */
export interface LicenseTerms {
  status: 'active' | 'inactive'
  quantity: number | null
  expiresAt: Date | null
}

function termsOf(license: AwsMarketplaceLicenseRecord): LicenseTerms {
  return { status: license.status, quantity: license.quantity, expiresAt: license.expiresAt }
}

function termsDiffer(before: LicenseTerms, after: LicenseTerms): boolean {
  return (
    before.status !== after.status ||
    before.quantity !== after.quantity ||
    (before.expiresAt?.getTime() ?? null) !== (after.expiresAt?.getTime() ?? null)
  )
}

export type LicenseVerificationOutcome =
  /** AWS described a license no row held yet; it is recorded with no organization. */
  | { kind: 'created'; license: AwsMarketplaceLicenseRecord }
  | {
      kind: 'updated'
      before: LicenseTerms
      license: AwsMarketplaceLicenseRecord
      /** Status, quantity, or expiry moved; an unchanged re-verify is false. */
      changed: boolean
    }
  /** No row to update, or a read older than the row's last one. */
  | { kind: 'skipped' }

/**
 * Applies a verification read that started at `verifiedAt`, comparing the terms before and after
 * under one row lock. A read older than the row's last one changes nothing, so overlapping
 * reconcile runs and registrations cannot roll a license back. A license AWS describes with an
 * entitlement but nobody registered (a renewal may issue a new ARN) is recorded with no
 * organization; one AWS no longer describes is only updated if it exists.
 */
export async function recordLicenseVerification(input: {
  licenseArn: string
  productCode: string
  /** The agreement a license event names; a buyer who never registered has no other source. */
  agreementId?: string | null
  summary: EntitlementSummary
  verifiedAt: Date
}): Promise<LicenseVerificationOutcome> {
  const fields = {
    ...verificationFields(input.summary, input.verifiedAt),
    ...(input.agreementId && { agreementId: input.agreementId }),
  }
  return db.transaction(async (tx) => {
    const accountId = input.summary.customerAwsAccountId
    if (accountId && input.summary.entitlementCount > 0) {
      const [created] = await tx
        .insert(awsMarketplaceLicense)
        .values({
          id: generateId(),
          licenseArn: input.licenseArn,
          productCode: input.productCode,
          customerAwsAccountId: accountId,
          customerIdentifier: input.summary.customerIdentifier,
          ...fields,
        })
        .onConflictDoNothing({ target: awsMarketplaceLicense.licenseArn })
        .returning()
      if (created) return { kind: 'created', license: created }
    }
    const [locked] = await tx
      .select()
      .from(awsMarketplaceLicense)
      .where(eq(awsMarketplaceLicense.licenseArn, input.licenseArn))
      .for('update')
      .limit(1)
    if (!locked || !isNewerRead(locked, input.verifiedAt)) return { kind: 'skipped' }
    const [license] = await tx
      .update(awsMarketplaceLicense)
      .set(fields)
      .where(eq(awsMarketplaceLicense.id, locked.id))
      .returning()
    const before = termsOf(locked)
    return { kind: 'updated', before, license, changed: termsDiffer(before, termsOf(license)) }
  })
}

/**
 * The licenses longest since their last re-verify attempt, up to `limit`, none attempted after
 * `cutoff`. Ordering by the attempt rather than the success keeps a license AWS keeps refusing
 * from holding the front of every batch.
 */
export async function listLicensesDueForReverify(cutoff: Date, limit: number): Promise<string[]> {
  const { lastVerificationAttemptAt, lastVerifiedAt } = awsMarketplaceLicense
  const rows = await db
    .select({ licenseArn: awsMarketplaceLicense.licenseArn })
    .from(awsMarketplaceLicense)
    .where(
      or(
        lt(lastVerificationAttemptAt, cutoff),
        and(isNull(lastVerificationAttemptAt), lt(lastVerifiedAt, cutoff))
      )
    )
    .orderBy(asc(sql`coalesce(${lastVerificationAttemptAt}, ${lastVerifiedAt})`))
    .limit(limit)
  return rows.map((row) => row.licenseArn)
}

const MAX_LICENSES_PER_AGREEMENT = 20

function belongsToAgreement(productCode: string, agreementId: string) {
  return and(
    eq(awsMarketplaceLicense.productCode, productCode),
    or(
      eq(awsMarketplaceLicense.agreementId, agreementId),
      eq(awsMarketplaceLicense.renewedAgreementId, agreementId)
    )
  )
}

/** The licenses an agreement covers, by the ID they registered with or last renewed to. */
export async function listLicensesForAgreement(
  productCode: string,
  agreementId: string
): Promise<string[]> {
  const rows = await db
    .select({ licenseArn: awsMarketplaceLicense.licenseArn })
    .from(awsMarketplaceLicense)
    .where(belongsToAgreement(productCode, agreementId))
    .orderBy(asc(awsMarketplaceLicense.createdAt))
    .limit(MAX_LICENSES_PER_AGREEMENT)
  return rows.map((row) => row.licenseArn)
}

/**
 * Moves the licenses of the previous agreement to the renewal and returns those this call moved.
 * The seller receives one renewal as both a Proposer and a Manufacturer event, and SQS may
 * redeliver either; only the first finds rows to move, so the team hears of it once.
 */
export async function markLicensesRenewed(input: {
  productCode: string
  previousAgreementId: string
  agreementId: string
}): Promise<AwsMarketplaceLicenseRecord[]> {
  return db
    .update(awsMarketplaceLicense)
    .set({ renewedAgreementId: input.agreementId, updatedAt: new Date() })
    .where(
      and(
        belongsToAgreement(input.productCode, input.previousAgreementId),
        or(
          isNull(awsMarketplaceLicense.renewedAgreementId),
          ne(awsMarketplaceLicense.renewedAgreementId, input.agreementId)
        )
      )
    )
    .returning()
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

/**
 * Consumes the claim and records the verification it relied on unless a newer one is stored,
 * taking the license when `link` is given: for an organization, or for an account alone when its
 * organization is null. A license already taken by the same party keeps its original link.
 */
export async function consumeLicenseClaim(
  tx: DbTransaction,
  input: {
    licenseId: string
    link: { organizationId: string | null; userId: string } | null
    contact: { email: string; companyName: string | null }
    /** Null when the row already holds a newer read, which this one must not overwrite. */
    verification: { summary: EntitlementSummary; verifiedAt: Date } | null
  }
): Promise<AwsMarketplaceLicenseRecord> {
  const [row] = await tx
    .update(awsMarketplaceLicense)
    .set({
      ...(input.verification
        ? verificationFields(input.verification.summary, input.verification.verifiedAt)
        : { updatedAt: new Date() }),
      contactEmail: input.contact.email,
      companyName: input.contact.companyName,
      ...(input.link && {
        organizationId: input.link.organizationId,
        linkedByUserId: input.link.userId,
        linkedAt: new Date(),
      }),
      claimTokenHash: null,
      claimExpiresAt: null,
    })
    .where(eq(awsMarketplaceLicense.id, input.licenseId))
    .returning()
  return row
}

/** Organizations the user owns or administers, which are the ones a license may be linked to. */
export async function listAdministeredOrganizations(
  userId: string
): Promise<AdministeredOrganization[]> {
  const rows = await db
    .select({ id: organization.id, name: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(eq(member.userId, userId), inArray(member.role, ['owner', 'admin'])))
    .orderBy(asc(organization.name))
  return rows.flatMap((row) =>
    row.role === 'owner' || row.role === 'admin' ? [{ ...row, role: row.role }] : []
  )
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

/** What an organization's members see of the Marketplace licenses linked to it. */
export async function listOrganizationLicenses(organizationId: string) {
  return db
    .select({
      id: awsMarketplaceLicense.id,
      status: awsMarketplaceLicense.status,
      dimension: awsMarketplaceLicense.dimension,
      quantity: awsMarketplaceLicense.quantity,
      expiresAt: awsMarketplaceLicense.expiresAt,
      lastVerifiedAt: awsMarketplaceLicense.lastVerifiedAt,
    })
    .from(awsMarketplaceLicense)
    .where(eq(awsMarketplaceLicense.organizationId, organizationId))
    .orderBy(asc(awsMarketplaceLicense.createdAt))
}

/** Organizations already linked to another license of this AWS account, for the team to match. */
export async function listOrganizationsLinkedToAccount(input: {
  customerAwsAccountId: string
  productCode: string
  excludingLicenseArn: string
}): Promise<Array<{ id: string; name: string }>> {
  return db
    .selectDistinct({ id: organization.id, name: organization.name })
    .from(awsMarketplaceLicense)
    .innerJoin(organization, eq(awsMarketplaceLicense.organizationId, organization.id))
    .where(
      and(
        eq(awsMarketplaceLicense.customerAwsAccountId, input.customerAwsAccountId),
        eq(awsMarketplaceLicense.productCode, input.productCode),
        ne(awsMarketplaceLicense.licenseArn, input.excludingLicenseArn)
      )
    )
    .orderBy(asc(organization.name))
}
