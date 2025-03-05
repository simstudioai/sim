import { useCallback, useEffect, useState } from 'react'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { useSession } from '@/lib/auth-client'
import { db } from '@/db'
import { account } from '@/db/schema'
import { OAuthProvider } from '@/tools/types'

/**
 * Interface for the OAuth error structure
 */
export interface OAuthRequiredError {
  type: 'oauth_required'
  provider: OAuthProvider
  toolId: string
  toolName: string
  requiredScopes?: string[]
}

/**
 * Check if the user has authorized the required OAuth provider with necessary scopes (server-side)
 *
 * @param provider - The OAuth provider to check
 * @param requiredScopes - Optional scopes to check
 * @returns Boolean indicating if the provider is authorized with required scopes
 */
export async function hasAuthorizedProviderServer(
  provider: OAuthProvider,
  requiredScopes?: string[]
): Promise<boolean> {
  try {
    // Get the session
    const session = await getSession()

    // If not authenticated, return false
    if (!session?.user?.id) {
      return false
    }

    // Determine the appropriate feature type based on the scopes
    let featureType = 'default'

    if (requiredScopes && requiredScopes.length > 0) {
      if (requiredScopes.some((scope) => scope.includes('repo'))) {
        featureType = 'repo'
      } else if (requiredScopes.some((scope) => scope.includes('workflow'))) {
        featureType = 'workflow'
      } else if (
        requiredScopes.some((scope) => scope.includes('gmail') || scope.includes('mail'))
      ) {
        featureType = 'email'
      } else if (requiredScopes.some((scope) => scope.includes('calendar'))) {
        featureType = 'calendar'
      } else if (requiredScopes.some((scope) => scope.includes('drive'))) {
        featureType = 'drive'
      } else if (requiredScopes.some((scope) => scope.includes('write'))) {
        featureType = 'write'
      } else if (requiredScopes.some((scope) => scope.includes('read'))) {
        featureType = 'read'
      }
    }

    // We check the appropriate provider ID based on the feature type
    const providerId = `${provider}-${featureType}`

    // Check if there's an account for this provider for the user
    const accounts = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, session.user.id), eq(account.providerId, providerId)))

    return accounts.length > 0
  } catch (error) {
    console.error('Error checking provider authorization:', error)
    return false
  }
}

/**
 * Check if a tool requires OAuth and if the user has authorized it (server-side)
 *
 * @param tool - The tool configuration
 * @returns Object indicating if OAuth is required and if the user has authorized it
 */
export async function checkOAuthRequirementServer(tool: any): Promise<{
  requiresAuth: boolean
  isAuthorized: boolean
  provider?: OAuthProvider
  requiredScopes?: string[]
}> {
  // Skip if no OAuth config or not required
  if (!tool.oauth || !tool.oauth.required) {
    return { requiresAuth: false, isAuthorized: false }
  }

  const provider = tool.oauth.provider
  const additionalScopes = tool.oauth.additionalScopes || []

  // Check if the user has authorized this provider with required scopes
  const isAuthorized = await hasAuthorizedProviderServer(provider, additionalScopes)

  return {
    requiresAuth: true,
    isAuthorized,
    provider,
    requiredScopes: additionalScopes,
  }
}

/**
 * Verify OAuth requirements before executing a tool (server-side)
 * Throws an error if OAuth is required but not authorized
 *
 * @param tool - The tool configuration
 * @throws Error with JSON.stringify(OAuthRequiredError)
 */
export async function verifyOAuthBeforeExecutionServer(tool: any): Promise<void> {
  const { requiresAuth, isAuthorized, provider, requiredScopes } =
    await checkOAuthRequirementServer(tool)

  if (requiresAuth && !isAuthorized && provider) {
    // Throw a structured error that can be caught and handled
    throw new Error(
      JSON.stringify({
        type: 'oauth_required',
        provider,
        toolId: tool.id,
        toolName: tool.name,
        requiredScopes,
      })
    )
  }
}

/**
 * Get OAuth tokens for a provider if the user has authorized it
 *
 * @param userId - The user's ID
 * @param provider - The OAuth provider to get tokens for
 * @returns The OAuth tokens or null if not authorized
 */
export async function getOAuthTokens(
  userId: string,
  provider: OAuthProvider
): Promise<{
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
} | null> {
  try {
    // Query the account table for this user and provider
    const accounts = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, provider)))
      .limit(1)

    if (!accounts.length || !accounts[0].accessToken) {
      return null
    }

    const userAccount = accounts[0]

    // Check if the token is expired
    if (
      userAccount.accessTokenExpiresAt &&
      new Date(userAccount.accessTokenExpiresAt) < new Date()
    ) {
      // In a production app, we would use the refresh token to get a new access token here
      // But for simplicity, we'll just return null for expired tokens
      console.warn(`Token for ${provider} is expired and needs refresh`)
      return null
    }

    // Ensure accessToken is not null using the type guard we did earlier
    const accessToken = userAccount.accessToken as string

    return {
      accessToken,
      refreshToken: userAccount.refreshToken || undefined,
      expiresAt: userAccount.accessTokenExpiresAt
        ? new Date(userAccount.accessTokenExpiresAt)
        : undefined,
    }
  } catch (error) {
    console.error('Error getting OAuth tokens:', error)
    return null
  }
}

/**
 * Get OAuth tokens for a specific tool if the user has authorized it
 *
 * @param userId - The user's ID
 * @param tool - The tool configuration
 * @returns The OAuth tokens or null if not required or not authorized
 */
export async function getOAuthTokensForTool(
  userId: string,
  tool: any
): Promise<{
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
} | null> {
  // Skip if no OAuth config or not required
  if (!tool.oauth || !tool.oauth.required) {
    return null
  }

  // Get tokens for the provider
  return getOAuthTokens(userId, tool.oauth.provider)
}

/**
 * Custom hook to check if a user has authorized an OAuth provider
 *
 * @param provider - The OAuth provider to check
 * @param requiredScopes - Optional array of scopes required for the operation
 * @returns An object with authorization status and loading state
 */
export function useProviderAuthorization(provider: OAuthProvider, requiredScopes?: string[]) {
  const { data: session, isPending } = useSession()
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false)

  useEffect(() => {
    if (isPending || !session?.user) {
      setIsAuthorized(false)
      return
    }

    // Check if the user has provider accounts in their session
    // This is a client-side check, so it may not be as accurate as the server-side check
    const checkAuthorization = async () => {
      try {
        // We'll use an API endpoint to check authorization status
        const response = await fetch(
          `/api/auth/oauth/check?provider=${provider}${
            requiredScopes ? `&scopes=${requiredScopes.join(',')}` : ''
          }`
        )

        if (response.ok) {
          const data = await response.json()
          setIsAuthorized(data.isAuthorized || false)
        } else {
          setIsAuthorized(false)
        }
      } catch (error) {
        console.error('Error checking OAuth authorization:', error)
        setIsAuthorized(false)
      }
    }

    checkAuthorization()
  }, [session, isPending, provider, requiredScopes])

  return {
    isAuthorized,
    isLoading: isPending,
    isLoggedIn: !!session?.user,
  }
}

/**
 * Check if a tool requires OAuth and if the user has authorized it
 * This function must be used in a client component
 *
 * @param tool - The tool configuration
 * @returns Object indicating if OAuth is required and if the user has the necessary authorization
 */
export function useToolOAuthRequirement(tool: any) {
  // Skip if no OAuth config or not required
  if (!tool.oauth || !tool.oauth.required) {
    return {
      requiresAuth: false,
      isAuthorized: true,
      isLoading: false,
    }
  }

  const provider = tool.oauth.provider
  const additionalScopes = tool.oauth.additionalScopes || []

  // Use the provider authorization hook
  const { isAuthorized, isLoading, isLoggedIn } = useProviderAuthorization(
    provider,
    additionalScopes
  )

  return {
    requiresAuth: true,
    isAuthorized: isAuthorized,
    isLoading,
    isLoggedIn,
    provider,
    requiredScopes: additionalScopes,
  }
}

/**
 * Verify OAuth requirements before executing a tool
 * Throws an error if OAuth is required but not authorized
 * This function must be used in a client component
 *
 * @param toolOAuthStatus - The result from useToolOAuthRequirement
 * @param tool - The tool configuration
 * @throws Error with JSON stringified OAuthRequiredError
 */
export function verifyOAuthBeforeExecution(
  toolOAuthStatus: ReturnType<typeof useToolOAuthRequirement>,
  tool: any
): void {
  const { requiresAuth, isAuthorized, isLoading, provider, requiredScopes } = toolOAuthStatus

  // Don't verify while loading
  if (isLoading) {
    return
  }

  if (requiresAuth && !isAuthorized && provider) {
    // Throw a structured error that the frontend can catch and handle
    throw new Error(
      JSON.stringify({
        type: 'oauth_required',
        provider,
        toolId: tool.id,
        toolName: tool.name,
        requiredScopes,
      } as OAuthRequiredError)
    )
  }
}

/**
 * Hook for handling OAuth errors during tool execution
 * Provides a modal state and error handler function
 */
export function useOAuthErrorHandler() {
  const [oauthModalState, setOAuthModalState] = useState<{
    isOpen: boolean
    provider: OAuthProvider
    toolName: string
  }>({
    isOpen: false,
    provider: 'github',
    toolName: '',
  })

  /**
   * Handle an error that might be an OAuth required error
   * Returns true if it was handled as an OAuth error, false otherwise
   */
  const handleError = useCallback((error: any): boolean => {
    if (!error) return false

    try {
      // Try to parse error message as JSON
      let errorObj

      if (typeof error === 'string') {
        errorObj = JSON.parse(error)
      } else if (error instanceof Error && error.message) {
        try {
          errorObj = JSON.parse(error.message)
        } catch {
          return false
        }
      } else {
        return false
      }

      // Check if it's an OAuth required error
      if (errorObj?.type === 'oauth_required') {
        setOAuthModalState({
          isOpen: true,
          provider: errorObj.provider,
          toolName: errorObj.toolName,
        })
        return true
      }
    } catch (parseError) {
      // Not a JSON error or not an OAuth error
      return false
    }

    return false
  }, [])

  const closeModal = useCallback(() => {
    setOAuthModalState((prev) => ({ ...prev, isOpen: false }))
  }, [])

  return {
    oauthModalState,
    handleOAuthError: handleError,
    closeOAuthModal: closeModal,
  }
}
