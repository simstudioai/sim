import { and, asc, eq, inArray, ne, type SQL, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { ssoDomain, ssoProvider } from './schema'

/**
 * Which identity provider signs in an organization domain.
 *
 * An organization may keep several providers on one domain while it moves from
 * one identity provider to another. The verified domain names the one sign-in
 * uses (`sso_domain.primary_provider_id`); until it names one, sign-in uses the
 * domain's first verified provider by id. The name is honored only while that
 * provider still belongs to the organization and serves the domain, so moving
 * a provider to another domain can never leave this one without a sign-in
 * provider. Shared by the app and the self-host scripts so both apply one rule.
 */

/** Reads and writes these rules need; satisfied by a database or a transaction. */
type SsoPrimaryWriter = Pick<PgDatabase<PgQueryResultHKT>, 'select' | 'update'>

/** A provider's domain as every comparison uses it: lower-cased, trimmed, a leading `*.` dropped. */
export const ssoProviderDomainKey: SQL<string> = sql`lower(regexp_replace(btrim(${ssoProvider.domain}), '^\\*\\.', ''))`

/** Joins a provider to its organization's verified record of the domain it serves. */
export const verifiedDomainOfProvider = and(
  eq(ssoDomain.organizationId, ssoProvider.organizationId),
  sql`${ssoDomain.domain} = ${ssoProviderDomainKey}`,
  eq(ssoDomain.status, 'verified')
)

/** Whether the provider is the one its verified domain names; false when no domain record joins. */
export const isNamedPrimary: SQL<boolean> = sql<boolean>`coalesce(${ssoDomain.primaryProviderId} = ${ssoProvider.providerId}, false)`

/**
 * Keeps sign-in where it is when a provider joins a domain that names no
 * primary: names the provider that has been signing the domain in, so the
 * newcomer does not take over by sorting first. Call with the domain record
 * locked. Does nothing when that provider belongs to another tenant.
 */
export async function nameIncumbentSignInProvider(
  tx: SsoPrimaryWriter,
  input: {
    domainRecordId: string
    organizationId: string
    domain: string
    joiningProviderId: string
  }
): Promise<void> {
  const [incumbent] = await tx
    .select({ providerId: ssoProvider.providerId, organizationId: ssoProvider.organizationId })
    .from(ssoProvider)
    .where(
      and(
        eq(ssoProvider.domainVerified, true),
        sql`${ssoProviderDomainKey} = ${input.domain}`,
        ne(ssoProvider.providerId, input.joiningProviderId)
      )
    )
    .orderBy(asc(ssoProvider.providerId))
    .limit(1)
  if (incumbent?.organizationId !== input.organizationId) return
  await tx
    .update(ssoDomain)
    .set({ primaryProviderId: incumbent.providerId, updatedAt: new Date() })
    .where(eq(ssoDomain.id, input.domainRecordId))
}

/**
 * Clears the name wherever an organization's domain made one of these deleted
 * providers primary, so a provider later registered under the same id does not
 * inherit the role.
 */
export async function forgetPrimaryProviders(
  tx: SsoPrimaryWriter,
  organizationId: string,
  providerIds: string[]
): Promise<void> {
  if (providerIds.length === 0) return
  await tx
    .update(ssoDomain)
    .set({ primaryProviderId: null, updatedAt: new Date() })
    .where(
      and(
        eq(ssoDomain.organizationId, organizationId),
        inArray(ssoDomain.primaryProviderId, providerIds)
      )
    )
}
