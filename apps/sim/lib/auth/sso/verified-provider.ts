import { db } from '@sim/db'
import { ssoProvider } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Whether the organization has an identity provider that can sign someone in. Domain verification
 * is what sign-in resolution requires of a provider, so this asks exactly that and no more — a
 * stricter test here would stop enforcing a requirement that sign-in can still satisfy.
 */
export async function hasSignInCapableSsoProvider(
  organizationId: string,
  executor: DbOrTx = db
): Promise<boolean> {
  const [row] = await executor
    .select({ id: ssoProvider.id })
    .from(ssoProvider)
    .where(
      and(eq(ssoProvider.organizationId, organizationId), eq(ssoProvider.domainVerified, true))
    )
    .limit(1)
  return row !== undefined
}
