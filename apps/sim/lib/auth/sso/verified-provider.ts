import { db } from '@sim/db'
import { ssoDomain, ssoProvider } from '@sim/db/schema'
import { verifiedDomainOfProvider } from '@sim/db/sso-primary-provider'
import { and, eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Whether the organization has an identity provider that can actually sign
 * someone in: registered against a domain the organization has verified, which
 * is the same pair sign-in resolution requires.
 */
export async function hasSignInCapableSsoProvider(
  organizationId: string,
  executor: DbOrTx = db
): Promise<boolean> {
  const [row] = await executor
    .select({ id: ssoProvider.id })
    .from(ssoProvider)
    .innerJoin(ssoDomain, verifiedDomainOfProvider)
    .where(
      and(eq(ssoProvider.organizationId, organizationId), eq(ssoProvider.domainVerified, true))
    )
    .limit(1)
  return row !== undefined
}
