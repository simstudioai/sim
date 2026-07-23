import {
  db,
  SSO_CALLBACK_INTENT_PREFIX,
  ssoProvider,
  verification,
  withSSOProviderMutationLock,
} from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, gt, like, lte } from 'drizzle-orm'
import { SSOManagementError } from '@/lib/auth/sso/management'

const logger = createLogger('SSOCallbackIntent')
const SSO_CALLBACK_INTENT_TTL_MS = 10 * 60_000

function callbackIntentIdentifier(providerId: string): string {
  return `${SSO_CALLBACK_INTENT_PREFIX}${providerId}`
}

export async function assertNoActiveSSOCallbacks(providerId: string): Promise<void> {
  const [activeIntent] = await db
    .select({ id: verification.id })
    .from(verification)
    .where(
      and(
        eq(verification.identifier, callbackIntentIdentifier(providerId)),
        gt(verification.expiresAt, new Date())
      )
    )
    .limit(1)

  if (activeIntent) {
    throw new SSOManagementError(
      'An SSO sign-in is currently completing for this provider. Try again shortly.',
      409,
      'SSO_CALLBACK_IN_PROGRESS'
    )
  }
}

export async function withSSOCallbackIntent<T>(
  providerId: string,
  callback: () => Promise<T>
): Promise<T> {
  const intentId = generateId()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SSO_CALLBACK_INTENT_TTL_MS)
  const registered = await withSSOProviderMutationLock(async () => {
    await db
      .delete(verification)
      .where(
        and(
          like(verification.identifier, `${SSO_CALLBACK_INTENT_PREFIX}%`),
          lte(verification.expiresAt, now)
        )
      )

    const [provider] = await db
      .select({ id: ssoProvider.id })
      .from(ssoProvider)
      .where(eq(ssoProvider.providerId, providerId))
      .limit(1)
    if (!provider) return false

    await db.insert(verification).values({
      id: intentId,
      identifier: callbackIntentIdentifier(providerId),
      value: intentId,
      expiresAt,
    })
    return true
  })

  try {
    return await callback()
  } finally {
    if (registered) {
      try {
        await db.delete(verification).where(eq(verification.id, intentId))
      } catch (error) {
        logger.error('Failed to remove SSO callback intent', { intentId, providerId, error })
      }
    }
  }
}
