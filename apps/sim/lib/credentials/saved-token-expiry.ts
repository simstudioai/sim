import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { and, eq, lte } from 'drizzle-orm'
import { UserFailure } from '@/lib/core/errors/user-failure'
import { getTokenServiceAccountDescriptor } from '@/lib/credentials/token-service-accounts/descriptors'

/** The provider's own failure that a saved token's expiry explains. */
interface ProviderRefusal {
  status: number
  statusText?: unknown
  data?: unknown
}

/**
 * A provider refused a saved token that is past the expiry its vendor stated when it was saved.
 * Only replacing the token restores the credential, so it is the user's to fix. It keeps the
 * provider's `status`, `statusText`, and `data`, so callers that branch on the HTTP failure still
 * see it; the boundary that replaces the refusal with it carries the refusal's log attribution over.
 */
class SavedTokenExpiredError extends UserFailure {
  readonly status: number
  readonly statusText?: string
  readonly data?: unknown

  constructor(message: string, refusal: ProviderRefusal) {
    super(message)
    this.name = 'SavedTokenExpiredError'
    this.status = refusal.status
    if (typeof refusal.statusText === 'string') this.statusText = refusal.statusText
    if (refusal.data !== undefined) this.data = refusal.data
  }
}

/**
 * Explains a provider's refusal of a saved service-account token when the credential records a
 * vendor-stated expiry that has passed: the run then says the token expired and must be replaced,
 * instead of reporting a bare authorization failure. Returns `null`, leaving the provider's own
 * failure to stand, when the credential records no expiry, the expiry is still ahead, or the
 * credential is not a saved service account. Never refuses a token on its own: only a refusal the
 * provider already made is explained.
 */
export async function explainExpiredSavedToken(
  credentialId: string,
  refusal: ProviderRefusal
): Promise<SavedTokenExpiredError | null> {
  const [row] = await db
    .select({ providerId: credential.providerId, expiresAt: credential.accessTokenExpiresAt })
    .from(credential)
    .where(
      and(
        eq(credential.id, credentialId),
        eq(credential.type, 'service_account'),
        lte(credential.accessTokenExpiresAt, new Date())
      )
    )
    .limit(1)
  if (!row?.expiresAt) return null
  const descriptor = getTokenServiceAccountDescriptor(row.providerId)
  const token = descriptor ? `${descriptor.serviceLabel} ${descriptor.tokenNoun}` : 'token'
  const replacement = descriptor?.tokenNoun ?? 'token'
  return new SavedTokenExpiredError(
    `The saved ${token} expired on ${row.expiresAt.toISOString().slice(0, 10)}. Create a new ${replacement} and reconnect the credential.`,
    refusal
  )
}
