import { db } from '@sim/db'
import { account, credentialSetMember, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { refreshOAuthToken } from '@/lib/oauth'
import {
  getMicrosoftRefreshTokenExpiry,
  isMicrosoftProvider,
  PROACTIVE_REFRESH_THRESHOLD_DAYS,
} from '@/lib/oauth/microsoft'

const logger = createLogger('OAuthUtilsAPI')

interface AccountInsertData {
  id: string
  userId: string
  providerId: string
  accountId: string
  accessToken: string
  scope: string
  createdAt: Date
  updatedAt: Date
  refreshToken?: string
  idToken?: string
  accessTokenExpiresAt?: Date
}

/**
 * Safely inserts an account record, handling duplicate constraint violations gracefully.
 * If a duplicate is detected (unique constraint violation), logs a warning and returns success.
 */
export async function safeAccountInsert(
  data: AccountInsertData,
  context: { provider: string; identifier?: string }
): Promise<void> {
  try {
    await db.insert(account).values(data)
    logger.info(`Created new ${context.provider} account for user`, { userId: data.userId })
  } catch (error: any) {
    if (error?.code === '23505') {
      logger.error(`Duplicate ${context.provider} account detected, credential already exists`, {
        userId: data.userId,
        identifier: context.identifier,
      })
    } else {
      throw error
    }
  }
}

/**
 * Get the user ID based on either a session or a workflow ID
 */
export async function getUserId(
  requestId: string,
  workflowId?: string
): Promise<string | undefined> {
  // If workflowId is provided, this is a server-side request
  if (workflowId) {
    // Get the workflow to verify the user ID
    const workflows = await db
      .select({ userId: workflow.userId })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflows.length) {
      logger.warn(`[${requestId}] Workflow not found`)
      return undefined
    }

    return workflows[0].userId
  }
  // This is a client-side request, use the session
  const session = await getSession()

  // Check if the user is authenticated
  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthenticated request rejected`)
    return undefined
  }

  return session.user.id
}

/**
 * Get a credential by ID and verify it belongs to the user
 */
export async function getCredential(requestId: string, credentialId: string, userId: string) {
  const credentials = await db
    .select()
    .from(account)
    .where(and(eq(account.id, credentialId), eq(account.userId, userId)))
    .limit(1)

  if (!credentials.length) {
    logger.warn(`[${requestId}] Credential not found`)
    return undefined
  }

  return credentials[0]
}

export async function getOAuthToken(userId: string, providerId: string): Promise<string | null> {
  const connections = await db
    .select({
      id: account.id,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      idToken: account.idToken,
      scope: account.scope,
    })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))
    .orderBy(desc(account.updatedAt))
    .limit(1)

  if (connections.length === 0) {
    logger.warn(`No OAuth token found for user ${userId}, provider ${providerId}`)
    return null
  }

  const credential = connections[0]

  // Determine whether we should refresh: missing token OR expired token
  const now = new Date()
  const tokenExpiry = credential.accessTokenExpiresAt
  const shouldAttemptRefresh =
    !!credential.refreshToken && (!credential.accessToken || (tokenExpiry && tokenExpiry < now))

  if (shouldAttemptRefresh) {
    logger.info(
      `Access token expired for user ${userId}, provider ${providerId}. Attempting to refresh.`
    )

    try {
      // Use the existing refreshOAuthToken function
      const refreshResult = await refreshOAuthToken(providerId, credential.refreshToken!)

      if (!refreshResult) {
        logger.error(`Failed to refresh token for user ${userId}, provider ${providerId}`, {
          providerId,
          userId,
          hasRefreshToken: !!credential.refreshToken,
        })
        return null
      }

      const { accessToken, expiresIn, refreshToken: newRefreshToken } = refreshResult

      // Update the database with new tokens
      const updateData: any = {
        accessToken,
        accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000), // Convert seconds to milliseconds
        updatedAt: new Date(),
      }

      // If we received a new refresh token (some providers like Airtable rotate them), save it
      if (newRefreshToken && newRefreshToken !== credential.refreshToken) {
        logger.info(`Updating refresh token for user ${userId}, provider ${providerId}`)
        updateData.refreshToken = newRefreshToken
      }

      // Update the token in the database with the actual expiration time from the provider
      await db.update(account).set(updateData).where(eq(account.id, credential.id))

      logger.info(`Successfully refreshed token for user ${userId}, provider ${providerId}`)
      return accessToken
    } catch (error) {
      logger.error(`Error refreshing token for user ${userId}, provider ${providerId}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        providerId,
        userId,
      })
      return null
    }
  }

  if (!credential.accessToken) {
    logger.warn(
      `Access token is null and no refresh attempted or available for user ${userId}, provider ${providerId}`
    )
    return null
  }

  logger.info(`Found valid OAuth token for user ${userId}, provider ${providerId}`)
  return credential.accessToken
}

/**
 * Refreshes an OAuth token if needed based on credential information
 * @param credentialId The ID of the credential to check and potentially refresh
 * @param userId The user ID who owns the credential (for security verification)
 * @param requestId Request ID for log correlation
 * @returns The valid access token or null if refresh fails
 */
export async function refreshAccessTokenIfNeeded(
  credentialId: string,
  userId: string,
  requestId: string
): Promise<string | null> {
  // Get the credential directly using the getCredential helper
  const credential = await getCredential(requestId, credentialId, userId)

  if (!credential) {
    return null
  }

  // Decide if we should refresh: token missing OR expired
  const accessTokenExpiresAt = credential.accessTokenExpiresAt
  const refreshTokenExpiresAt = credential.refreshTokenExpiresAt
  const now = new Date()

  // Check if access token needs refresh (missing or expired)
  const accessTokenNeedsRefresh =
    !!credential.refreshToken &&
    (!credential.accessToken || (accessTokenExpiresAt && accessTokenExpiresAt <= now))

  // Check if we should proactively refresh to prevent refresh token expiry
  // This applies to Microsoft providers whose refresh tokens expire after 90 days of inactivity
  const proactiveRefreshThreshold = new Date(
    now.getTime() + PROACTIVE_REFRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
  )
  const refreshTokenNeedsProactiveRefresh =
    !!credential.refreshToken &&
    isMicrosoftProvider(credential.providerId) &&
    refreshTokenExpiresAt &&
    refreshTokenExpiresAt <= proactiveRefreshThreshold

  const shouldRefresh = accessTokenNeedsRefresh || refreshTokenNeedsProactiveRefresh

  const accessToken = credential.accessToken

  if (shouldRefresh) {
    logger.info(`[${requestId}] Refreshing token for credential`)
    try {
      const refreshedToken = await refreshOAuthToken(
        credential.providerId,
        credential.refreshToken!
      )

      if (!refreshedToken) {
        logger.error(`[${requestId}] Failed to refresh token for credential: ${credentialId}`, {
          credentialId,
          providerId: credential.providerId,
          userId: credential.userId,
          hasRefreshToken: !!credential.refreshToken,
        })
        if (!accessTokenNeedsRefresh && accessToken) {
          logger.info(`[${requestId}] Proactive refresh failed but access token still valid`)
          return accessToken
        }
        return null
      }

      // Prepare update data
      const updateData: Record<string, unknown> = {
        accessToken: refreshedToken.accessToken,
        accessTokenExpiresAt: new Date(Date.now() + refreshedToken.expiresIn * 1000),
        updatedAt: new Date(),
      }

      // If we received a new refresh token, update it
      if (refreshedToken.refreshToken && refreshedToken.refreshToken !== credential.refreshToken) {
        logger.info(`[${requestId}] Updating refresh token for credential`)
        updateData.refreshToken = refreshedToken.refreshToken
      }

      if (isMicrosoftProvider(credential.providerId)) {
        updateData.refreshTokenExpiresAt = getMicrosoftRefreshTokenExpiry()
      }

      // Update the token in the database
      await db.update(account).set(updateData).where(eq(account.id, credentialId))

      logger.info(`[${requestId}] Successfully refreshed access token for credential`)
      return refreshedToken.accessToken
    } catch (error) {
      logger.error(`[${requestId}] Error refreshing token for credential`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        providerId: credential.providerId,
        credentialId,
        userId: credential.userId,
      })
      if (!accessTokenNeedsRefresh && accessToken) {
        logger.info(`[${requestId}] Proactive refresh failed but access token still valid`)
        return accessToken
      }
      return null
    }
  } else if (!accessToken) {
    // We have no access token and either no refresh token or not eligible to refresh
    logger.error(`[${requestId}] Missing access token for credential`)
    return null
  }

  logger.info(`[${requestId}] Access token is valid for credential`)
  return accessToken
}

/**
 * Enhanced version that returns additional information about the refresh operation
 */
export async function refreshTokenIfNeeded(
  requestId: string,
  credential: any,
  credentialId: string
): Promise<{ accessToken: string; refreshed: boolean }> {
  // Decide if we should refresh: token missing OR expired
  const accessTokenExpiresAt = credential.accessTokenExpiresAt
  const refreshTokenExpiresAt = credential.refreshTokenExpiresAt
  const now = new Date()

  // Check if access token needs refresh (missing or expired)
  const accessTokenNeedsRefresh =
    !!credential.refreshToken &&
    (!credential.accessToken || (accessTokenExpiresAt && accessTokenExpiresAt <= now))

  // Check if we should proactively refresh to prevent refresh token expiry
  // This applies to Microsoft providers whose refresh tokens expire after 90 days of inactivity
  const proactiveRefreshThreshold = new Date(
    now.getTime() + PROACTIVE_REFRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
  )
  const refreshTokenNeedsProactiveRefresh =
    !!credential.refreshToken &&
    isMicrosoftProvider(credential.providerId) &&
    refreshTokenExpiresAt &&
    refreshTokenExpiresAt <= proactiveRefreshThreshold

  const shouldRefresh = accessTokenNeedsRefresh || refreshTokenNeedsProactiveRefresh

  // If token appears valid and present, return it directly
  if (!shouldRefresh) {
    logger.info(`[${requestId}] Access token is valid`)
    return { accessToken: credential.accessToken, refreshed: false }
  }

  try {
    const refreshResult = await refreshOAuthToken(credential.providerId, credential.refreshToken!)

    if (!refreshResult) {
      logger.error(`[${requestId}] Failed to refresh token for credential`)
      if (!accessTokenNeedsRefresh && credential.accessToken) {
        logger.info(`[${requestId}] Proactive refresh failed but access token still valid`)
        return { accessToken: credential.accessToken, refreshed: false }
      }
      throw new Error('Failed to refresh token')
    }

    const { accessToken: refreshedToken, expiresIn, refreshToken: newRefreshToken } = refreshResult

    // Prepare update data
    const updateData: Record<string, unknown> = {
      accessToken: refreshedToken,
      accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000), // Use provider's expiry
      updatedAt: new Date(),
    }

    // If we received a new refresh token, update it
    if (newRefreshToken && newRefreshToken !== credential.refreshToken) {
      logger.info(`[${requestId}] Updating refresh token`)
      updateData.refreshToken = newRefreshToken
    }

    if (isMicrosoftProvider(credential.providerId)) {
      updateData.refreshTokenExpiresAt = getMicrosoftRefreshTokenExpiry()
    }

    await db.update(account).set(updateData).where(eq(account.id, credentialId))

    logger.info(`[${requestId}] Successfully refreshed access token`)
    return { accessToken: refreshedToken, refreshed: true }
  } catch (error) {
    logger.warn(
      `[${requestId}] Refresh attempt failed, checking if another concurrent request succeeded`
    )

    const freshCredential = await getCredential(requestId, credentialId, credential.userId)
    if (freshCredential?.accessToken) {
      const freshExpiresAt = freshCredential.accessTokenExpiresAt
      const stillValid = !freshExpiresAt || freshExpiresAt > new Date()

      if (stillValid) {
        logger.info(`[${requestId}] Found valid token from concurrent refresh, using it`)
        return { accessToken: freshCredential.accessToken, refreshed: true }
      }
    }

    if (!accessTokenNeedsRefresh && credential.accessToken) {
      logger.info(`[${requestId}] Proactive refresh failed but access token still valid`)
      return { accessToken: credential.accessToken, refreshed: false }
    }

    logger.error(`[${requestId}] Refresh failed and no valid token found in DB`, error)
    throw error
  }
}

export interface CredentialSetCredential {
  userId: string
  credentialId: string
  accessToken: string
  providerId: string
}

export async function getCredentialsForCredentialSet(
  credentialSetId: string,
  providerId: string
): Promise<CredentialSetCredential[]> {
  logger.info(`Getting credentials for credential set ${credentialSetId}, provider ${providerId}`)

  const members = await db
    .select({ userId: credentialSetMember.userId })
    .from(credentialSetMember)
    .where(
      and(
        eq(credentialSetMember.credentialSetId, credentialSetId),
        eq(credentialSetMember.status, 'active')
      )
    )

  logger.info(`Found ${members.length} active members in credential set ${credentialSetId}`)

  if (members.length === 0) {
    logger.warn(`No active members found for credential set ${credentialSetId}`)
    return []
  }

  const userIds = members.map((m) => m.userId)
  logger.debug(`Member user IDs: ${userIds.join(', ')}`)

  const credentials = await db
    .select({
      id: account.id,
      userId: account.userId,
      providerId: account.providerId,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
    })
    .from(account)
    .where(and(inArray(account.userId, userIds), eq(account.providerId, providerId)))

  logger.info(
    `Found ${credentials.length} credentials with provider ${providerId} for ${members.length} members`
  )

  const results: CredentialSetCredential[] = []

  for (const cred of credentials) {
    const now = new Date()
    const tokenExpiry = cred.accessTokenExpiresAt
    const shouldRefresh =
      !!cred.refreshToken && (!cred.accessToken || (tokenExpiry && tokenExpiry < now))

    let accessToken = cred.accessToken

    if (shouldRefresh && cred.refreshToken) {
      try {
        const refreshResult = await refreshOAuthToken(providerId, cred.refreshToken)

        if (refreshResult) {
          accessToken = refreshResult.accessToken

          const updateData: Record<string, unknown> = {
            accessToken: refreshResult.accessToken,
            accessTokenExpiresAt: new Date(Date.now() + refreshResult.expiresIn * 1000),
            updatedAt: new Date(),
          }

          if (refreshResult.refreshToken && refreshResult.refreshToken !== cred.refreshToken) {
            updateData.refreshToken = refreshResult.refreshToken
          }

          await db.update(account).set(updateData).where(eq(account.id, cred.id))

          logger.info(`Refreshed token for user ${cred.userId}, provider ${providerId}`)
        }
      } catch (error) {
        logger.error(`Failed to refresh token for user ${cred.userId}, provider ${providerId}`, {
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }
    }

    if (accessToken) {
      results.push({
        userId: cred.userId,
        credentialId: cred.id,
        accessToken,
        providerId,
      })
    }
  }

  logger.info(
    `Found ${results.length} valid credentials for credential set ${credentialSetId}, provider ${providerId}`
  )

  return results
}
