import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { account } from '@/db/schema'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('OAuthUtils')

/**
 * Set the first credential for a provider as default
 * This ensures that when a user connects a new OAuth provider,
 * the first credential is automatically selected as default
 */
export async function setDefaultCredentialForProvider(
  userId: string,
  providerId: string
): Promise<void> {
  try {
    // Check if there are any existing credentials for this provider and user
    const existingCredentials = await db
      .select({ id: account.id, isDefault: account.isDefault })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))

    // If no existing credentials or no default credential is set, set the first one as default
    if (existingCredentials.length === 0) {
      logger.info('No existing credentials found for provider', { userId, providerId })
      return
    }

    const hasDefault = existingCredentials.some(cred => cred.isDefault)

    if (!hasDefault) {
      // Set the first credential as default
      const firstCredentialId = existingCredentials[0].id
      await db
        .update(account)
        .set({ isDefault: true })
        .where(eq(account.id, firstCredentialId))

      logger.info('Set first credential as default', {
        userId,
        providerId,
        credentialId: firstCredentialId,
      })
    }
  } catch (error) {
    logger.error('Error setting default credential', { error, userId, providerId })
  }
}

/**
 * Get the default credential for a provider
 */
export async function getDefaultCredential(
  userId: string,
  providerId: string
): Promise<string | null> {
  try {
    const credentials = await db
      .select({ id: account.id })
      .from(account)
      .where(
        and(
          eq(account.userId, userId),
          eq(account.providerId, providerId),
          eq(account.isDefault, true)
        )
      )
      .limit(1)

    return credentials.length > 0 ? credentials[0].id : null
  } catch (error) {
    logger.error('Error getting default credential', { error, userId, providerId })
    return null
  }
}

/**
 * Set a specific credential as default for a provider
 * This will unset any other default credentials for the same provider
 */
export async function setCredentialAsDefault(
  userId: string,
  providerId: string,
  credentialId: string
): Promise<void> {
  try {
    // First, unset all default credentials for this provider and user
    await db
      .update(account)
      .set({ isDefault: false })
      .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))

    // Then set the specified credential as default
    await db
      .update(account)
      .set({ isDefault: true })
      .where(eq(account.id, credentialId))

    logger.info('Set credential as default', { userId, providerId, credentialId })
  } catch (error) {
    logger.error('Error setting credential as default', { error, userId, providerId, credentialId })
  }
} 