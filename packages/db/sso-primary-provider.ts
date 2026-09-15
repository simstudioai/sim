import { and, asc, eq, ne, type SQL, sql } from 'drizzle-orm'
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
 * Keeps sign-in where it is when a provider joins a domain, so the newcomer does
 * not take over by sorting first. When the domain already names a primary that
 * still signs it in, nothing changes. Otherwise the organization provider that
 * has been signing the domain in is named, or the stale name is cleared when
 * there is none. Call inside the transaction that holds the domain record lock.
 */
export async function keepDomainSignInProvider(
  tx: SsoPrimaryWriter,
  input: {
    domainRecordId: string
    organizationId: string
    domain: string
    joiningProviderId: string
  }
): Promise<void> {
  const [record] = await tx
    .select({ primaryProviderId: ssoDomain.primaryProviderId })
    .from(ssoDomain)
    .where(eq(ssoDomain.id, input.domainRecordId))
    .limit(1)
  if (!record) return

  const signingIn = await tx
    .select({ providerId: ssoProvider.providerId })
    .from(ssoProvider)
    .where(
      and(
        eq(ssoProvider.organizationId, input.organizationId),
        eq(ssoProvider.domainVerified, true),
        sql`${ssoProviderDomainKey} = ${input.domain}`,
        ne(ssoProvider.providerId, input.joiningProviderId)
      )
    )
    .orderBy(asc(ssoProvider.providerId))
  const namedStillSignsIn = signingIn.some(
    (provider) => provider.providerId === record.primaryProviderId
  )
  if (namedStillSignsIn) return

  const primaryProviderId = signingIn[0]?.providerId ?? null
  if (primaryProviderId === record.primaryProviderId) return
  await tx
    .update(ssoDomain)
    .set({ primaryProviderId, updatedAt: new Date() })
    .where(eq(ssoDomain.id, input.domainRecordId))
}

/**
 * Clears the name wherever one of an organization's domains made this deleted
 * provider primary, so a provider later registered under the same id does not
 * inherit the role.
 */
export async function forgetPrimaryProvider(
  tx: SsoPrimaryWriter,
  organizationId: string,
  providerId: string
): Promise<void> {
  await tx
    .update(ssoDomain)
    .set({ primaryProviderId: null, updatedAt: new Date() })
    .where(
      and(eq(ssoDomain.organizationId, organizationId), eq(ssoDomain.primaryProviderId, providerId))
    )
}
