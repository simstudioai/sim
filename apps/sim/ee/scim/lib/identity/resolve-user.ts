import { member, type ScimUserAttributes, scimUserTombstone, ssoDomain, user } from '@sim/db/schema'
import { normalizeSSODomain } from '@sim/utils/sso-domain'
import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { and, eq, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { primaryEmail } from '@/ee/scim/lib/protocol/canonical'
import { invalidValue, uniqueness } from '@/ee/scim/lib/protocol/errors'

/**
 * Deciding which Sim account an incoming directory identity refers to.
 *
 * This is the security boundary of the whole surface. A directory that could
 * name an arbitrary address and have Sim hand back the matching account would be
 * an account-takeover primitive: the tenant controls what it sends, so it would
 * control which account it captures. Every branch below either proves the
 * identity was provisioned by this same connection, or proves the organization
 * owns the email's domain.
 */

export type IdentityResolution =
  | { action: 'create' }
  | { action: 'link'; userId: string; via: 'tombstone' | 'verified-domain' }

/** Domains this organization has proven it owns, through the SSO domain flow. */
async function listVerifiedDomains(tx: DbOrTx, organizationId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ domain: ssoDomain.domain })
    .from(ssoDomain)
    .where(and(eq(ssoDomain.organizationId, organizationId), eq(ssoDomain.status, 'verified')))
  const domains = new Set<string>()
  for (const row of rows) {
    const normalized = normalizeSSODomain(row.domain)
    if (normalized) domains.add(normalized)
  }
  return domains
}

/**
 * Refuses an address outside the organization's verified domains.
 *
 * Applied on every create and every email change, not only when linking. A
 * directory that could set a member's address to a domain the organization does
 * not own could point a Sim account at a mailbox it controls and then use
 * password recovery against it.
 */
export async function assertDomainOwned(
  tx: DbOrTx,
  organizationId: string,
  email: string
): Promise<void> {
  const domain = normalizeSSODomain(email)
  if (!domain || !isValidEmailSyntax(email)) {
    throw invalidValue(`${email} is not a usable email address`)
  }
  const verified = await listVerifiedDomains(tx, organizationId)
  /**
   * `invalidValue` rather than `uniqueness`. Nothing is duplicated here; the
   * value is one this organization may not use. Labelling it a uniqueness
   * conflict would make Okta record the user as "already exists" and hide the
   * actual remedy — verify the domain — from the administrator.
   */
  if (verified.size === 0) {
    throw invalidValue(
      'This organization has no verified email domains. Verify the domain in Sim before provisioning users.'
    )
  }
  if (!verified.has(domain)) {
    throw invalidValue(
      `The domain ${domain} is not verified for this organization, so ${email} cannot be provisioned`
    )
  }
}

/** Refuses an address already held by a different Sim account. */
export async function assertEmailAvailable(
  tx: DbOrTx,
  email: string,
  exceptUserId?: string
): Promise<void> {
  const [existing] = await tx
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(trim(${user.email})) = ${normalizeEmail(email)}`)
    .limit(1)
  if (existing && existing.id !== exceptUserId) {
    throw uniqueness('Another Sim account already uses this email address')
  }
}

/**
 * Chooses whether to create an account or attach to an existing one.
 *
 * Order matters. An exact tombstone match is the strongest signal available —
 * this connection provisioned that external id before — and it is what makes a
 * directory's delete-and-recreate (an ordinary rename or rehire) reattach the
 * original account instead of stranding it behind a duplicate.
 *
 * Only then is email considered, and only under two conditions together: the
 * organization has proven it owns the domain, and the account is not already
 * committed to a different organization.
 */
export async function resolveProvisionedIdentity(
  tx: DbOrTx,
  params: { connectionId: string; organizationId: string; attributes: ScimUserAttributes }
): Promise<IdentityResolution> {
  const email = primaryEmail(params.attributes)
  /** Checked first so no path — a tombstone relink included — skips it. */
  await assertDomainOwned(tx, params.organizationId, email)

  const externalId = params.attributes.externalId
  if (externalId) {
    const [tombstone] = await tx
      .select({ userId: scimUserTombstone.userId })
      .from(scimUserTombstone)
      .where(
        and(
          eq(scimUserTombstone.connectionId, params.connectionId),
          eq(scimUserTombstone.externalId, externalId)
        )
      )
      .limit(1)
    if (tombstone) return { action: 'link', userId: tombstone.userId, via: 'tombstone' }
  }

  const [existing] = await tx
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(trim(${user.email})) = ${normalizeEmail(email)}`)
    .limit(1)
  if (!existing) return { action: 'create' }

  /**
   * A Sim account belongs to at most one organization, enforced by a unique
   * index on `member.userId`. Attaching to someone already committed elsewhere
   * cannot succeed, and reporting it as a conflict is what tells the directory
   * administrator to resolve it rather than retrying forever.
   */
  const [membership] = await tx
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, existing.id))
    .limit(1)

  if (membership && membership.organizationId !== params.organizationId) {
    throw uniqueness(
      'A Sim account with this email already belongs to a different organization. Remove it there before provisioning.'
    )
  }

  return { action: 'link', userId: existing.id, via: 'verified-domain' }
}

/** Clears a tombstone once its identity has been provisioned again. */
export async function consumeTombstone(
  tx: DbOrTx,
  params: { connectionId: string; externalId?: string | undefined }
): Promise<void> {
  if (!params.externalId) return
  await tx
    .delete(scimUserTombstone)
    .where(
      and(
        eq(scimUserTombstone.connectionId, params.connectionId),
        eq(scimUserTombstone.externalId, params.externalId)
      )
    )
}
