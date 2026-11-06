import { db } from '@sim/db'
import { awsMarketplaceLicense, member, organization, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, lte } from 'drizzle-orm'
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

/**
 * Records a registration: the license row keyed by its ARN, as ResolveCustomer and the
 * Entitlement Service just described it, with a fresh claim when it is active. An inactive
 * registration clears any claim outstanding from an earlier one.
 */
export async function saveRegisteredLicense(input: {
  licenseArn: string
  productCode: string
  customerIdentifier: string
  customerAwsAccountId: string | null
  summary: EntitlementSummary
  verifiedAt: Date
  claim: { hash: string; expiresAt: Date } | null
}): Promise<string> {
  const fields = {
    productCode: input.productCode,
    customerIdentifier: input.customerIdentifier,
    customerAwsAccountId: input.customerAwsAccountId,
    ...verificationFields(input.summary, input.verifiedAt),
    claimTokenHash: input.claim?.hash ?? null,
    claimExpiresAt: input.claim?.expiresAt ?? null,
  }
  const [row] = await db
    .insert(awsMarketplaceLicense)
    .values({ id: generateId(), licenseArn: input.licenseArn, ...fields })
    .onConflictDoUpdate({ target: awsMarketplaceLicense.licenseArn, set: fields })
    .returning({ id: awsMarketplaceLicense.id })
  return row.id
}

/**
 * Applies a verification read that started at `verifiedAt`. A read older than the row's last one
 * changes nothing, so overlapping reconcile runs and registrations cannot roll a license back. A
 * license AWS describes but nobody registered is recorded so it is visible to the team; one AWS
 * no longer describes is only updated if it exists.
 */
export async function recordLicenseVerification(input: {
  licenseArn: string
  productCode: string
  summary: EntitlementSummary
  verifiedAt: Date
}): Promise<void> {
  const fields = verificationFields(input.summary, input.verifiedAt)
  const notNewer = lte(awsMarketplaceLicense.lastVerifiedAt, input.verifiedAt)
  if (input.summary.customerIdentifier) {
    await db
      .insert(awsMarketplaceLicense)
      .values({
        id: generateId(),
        licenseArn: input.licenseArn,
        productCode: input.productCode,
        customerIdentifier: input.summary.customerIdentifier,
        customerAwsAccountId: input.summary.customerAwsAccountId,
        ...fields,
      })
      .onConflictDoUpdate({
        target: awsMarketplaceLicense.licenseArn,
        set: fields,
        setWhere: notNewer,
      })
    return
  }
  await db
    .update(awsMarketplaceLicense)
    .set(fields)
    .where(and(eq(awsMarketplaceLicense.licenseArn, input.licenseArn), notNewer))
}

/** The licenses whose last verification is oldest, up to `limit`, none newer than `cutoff`. */
export async function listLicensesVerifiedBefore(cutoff: Date, limit: number): Promise<string[]> {
  const rows = await db
    .select({ licenseArn: awsMarketplaceLicense.licenseArn })
    .from(awsMarketplaceLicense)
    .where(lte(awsMarketplaceLicense.lastVerifiedAt, cutoff))
    .orderBy(asc(awsMarketplaceLicense.lastVerifiedAt))
    .limit(limit)
  return rows.map((row) => row.licenseArn)
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
 * Consumes the claim and records the verification it relied on, taking the license when `link`
 * is given: for an organization, or for an account alone when its organization is null. A
 * license already taken by the same party keeps its original link.
 */
export async function consumeLicenseClaim(
  tx: DbTransaction,
  input: {
    licenseId: string
    link: { organizationId: string | null; userId: string } | null
    summary: EntitlementSummary
    verifiedAt: Date
  }
): Promise<AwsMarketplaceLicenseRecord> {
  const [row] = await tx
    .update(awsMarketplaceLicense)
    .set({
      ...verificationFields(input.summary, input.verifiedAt),
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
  userId: string
): Promise<{ organizationName: string | null; userName: string | null; userEmail: string | null }> {
  const [[org], [person]] = await Promise.all([
    organizationId
      ? db
          .select({ name: organization.name })
          .from(organization)
          .where(eq(organization.id, organizationId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1),
  ])
  return {
    organizationName: org?.name ?? null,
    userName: person?.name ?? null,
    userEmail: person?.email ?? null,
  }
}
