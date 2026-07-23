import {
  db,
  SSO_CALLBACK_INTENT_PREFIX,
  SSO_DOMAIN_VERIFICATION_INTENT_PREFIX,
  ssoProvider,
  verification,
  withSSOProviderMutationLock,
} from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, gt, inArray, like, lte, or } from 'drizzle-orm'
import { SSOManagementError } from '@/lib/auth/sso/management'

const logger = createLogger('SSOProviderOperationIntent')
const SSO_PROVIDER_OPERATION_INTENT_TTL_MS = 10 * 60_000

type ProviderReference = { id: string; providerId: string }

function operationIntentIdentifier(prefix: string, providerId: string): string {
  return `${prefix}${providerId}`
}

async function removeExpiredOperationIntents(now: Date): Promise<void> {
  await db
    .delete(verification)
    .where(
      and(
        or(
          like(verification.identifier, `${SSO_CALLBACK_INTENT_PREFIX}%`),
          like(verification.identifier, `${SSO_DOMAIN_VERIFICATION_INTENT_PREFIX}%`)
        ),
        lte(verification.expiresAt, now)
      )
    )
}

async function insertOperationIntent(
  prefix: string,
  providerId: string,
  intentId: string,
  expiresAt: Date
): Promise<void> {
  await db.insert(verification).values({
    id: intentId,
    identifier: operationIntentIdentifier(prefix, providerId),
    value: intentId,
    expiresAt,
  })
}

async function removeOperationIntent(intentId: string, providerId: string): Promise<void> {
  try {
    await db.delete(verification).where(eq(verification.id, intentId))
  } catch (error) {
    logger.error('Failed to remove SSO provider operation intent', {
      intentId,
      providerId,
      error,
    })
  }
}

export async function assertNoActiveSSOProviderOperations(providerId: string): Promise<void> {
  const [activeIntent] = await db
    .select({ id: verification.id })
    .from(verification)
    .where(
      and(
        inArray(verification.identifier, [
          operationIntentIdentifier(SSO_CALLBACK_INTENT_PREFIX, providerId),
          operationIntentIdentifier(SSO_DOMAIN_VERIFICATION_INTENT_PREFIX, providerId),
        ]),
        gt(verification.expiresAt, new Date())
      )
    )
    .limit(1)

  if (activeIntent) {
    throw new SSOManagementError(
      'An SSO operation is currently completing for this provider. Try again shortly.',
      409,
      'SSO_OPERATION_IN_PROGRESS'
    )
  }
}

export async function withSSOCallbackIntent<T>(
  providerId: string,
  callback: () => Promise<T>
): Promise<T> {
  const intentId = generateId()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SSO_PROVIDER_OPERATION_INTENT_TTL_MS)
  const registered = await withSSOProviderMutationLock(async () => {
    await removeExpiredOperationIntents(now)

    const [provider] = await db
      .select({ id: ssoProvider.id })
      .from(ssoProvider)
      .where(eq(ssoProvider.providerId, providerId))
      .limit(1)
    if (!provider) return false

    await insertOperationIntent(SSO_CALLBACK_INTENT_PREFIX, providerId, intentId, expiresAt)
    return true
  })

  try {
    return await callback()
  } finally {
    if (registered) await removeOperationIntent(intentId, providerId)
  }
}

export async function withSSODomainVerificationIntent<T>(
  expectedProvider: ProviderReference,
  callback: () => Promise<T>
): Promise<T> {
  const intentId = generateId()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SSO_PROVIDER_OPERATION_INTENT_TTL_MS)
  await withSSOProviderMutationLock(async () => {
    await removeExpiredOperationIntents(now)

    const [provider] = await db
      .select({ id: ssoProvider.id })
      .from(ssoProvider)
      .where(
        and(
          eq(ssoProvider.id, expectedProvider.id),
          eq(ssoProvider.providerId, expectedProvider.providerId)
        )
      )
      .limit(1)
    if (!provider) {
      throw new SSOManagementError(
        'The SSO provider changed while domain verification was starting. Reload and try again.',
        409,
        'SSO_PROVIDER_CHANGED'
      )
    }

    await insertOperationIntent(
      SSO_DOMAIN_VERIFICATION_INTENT_PREFIX,
      expectedProvider.providerId,
      intentId,
      expiresAt
    )
  })

  try {
    return await callback()
  } finally {
    await removeOperationIntent(intentId, expectedProvider.providerId)
  }
}
