import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { account } from '@/db/schema'
import { OAuthProvider } from '@/tools/types'

/**
 * Check if the user has authorized a specific OAuth provider
 */
async function hasAuthorizedProvider(
  userId: string,
  provider: OAuthProvider,
  requiredScopes?: string[],
  credentialId?: string
): Promise<boolean> {
  try {
    // If a specific credential ID is provided, check if it exists and belongs to the user
    if (credentialId) {
      const credential = await db
        .select()
        .from(account)
        .where(and(eq(account.id, credentialId), eq(account.userId, userId)))
        .limit(1)

      return credential.length > 0
    }

    // Otherwise, determine the appropriate provider ID based on scopes
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

    // Construct the provider ID based on the provider and feature type
    const providerId = `${provider}-${featureType}`

    // Check if the user has this provider account
    const accounts = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))
      .limit(1)

    return accounts.length > 0
  } catch (error) {
    console.error('Error checking OAuth authorization:', error)
    return false
  }
}

/**
 * API route to check if a tool requires OAuth and if the user is authorized
 */
export async function POST(request: NextRequest) {
  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      return NextResponse.json(
        { requiresAuth: true, isAuthorized: false, error: 'User not authenticated' },
        { status: 401 }
      )
    }

    // Get the tool and credential ID from the request body
    const { tool, credentialId } = await request.json()

    // Check if the tool requires OAuth
    if (!tool.oauth || !tool.oauth.required) {
      return NextResponse.json({ requiresAuth: false, isAuthorized: true }, { status: 200 })
    }

    // Get the provider and required scopes
    const provider = tool.oauth.provider
    const requiredScopes = tool.oauth.additionalScopes || []

    // Check if the user has authorized this provider
    const isAuthorized = await hasAuthorizedProvider(
      session.user.id,
      provider,
      requiredScopes,
      credentialId
    )

    // Return the authorization status
    if (isAuthorized) {
      return NextResponse.json({ requiresAuth: true, isAuthorized: true }, { status: 200 })
    } else {
      return NextResponse.json(
        {
          requiresAuth: true,
          isAuthorized: false,
          error: JSON.stringify({
            type: 'oauth_required',
            provider,
            toolId: tool.id,
            toolName: tool.name,
            requiredScopes,
          }),
        },
        { status: 200 }
      )
    }
  } catch (error) {
    console.error('Error checking OAuth authorization:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
