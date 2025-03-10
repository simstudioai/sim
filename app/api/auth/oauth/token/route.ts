import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { client } from '@/lib/auth-client'
import { db } from '@/db'
import { account, workflow } from '@/db/schema'

/**
 * Get an access token for a specific credential
 * Supports both session-based authentication (for client-side requests)
 * and workflow-based authentication (for server-side requests)
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json()
    const { credentialId, workflowId } = body

    if (!credentialId) {
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    // Determine the user ID based on the context
    let userId: string | undefined

    // If workflowId is provided, this is a server-side request
    if (workflowId) {
      // Get the workflow to verify the user ID
      const workflows = await db
        .select({ userId: workflow.userId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflows.length) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      userId = workflows[0].userId
    } else {
      // This is a client-side request, use the session
      const session = await getSession()

      // Check if the user is authenticated
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
      }

      userId = session.user.id
    }

    // Get the credential from the database
    const credentials = await db
      .select()
      .from(account)
      .where(and(eq(account.id, credentialId), eq(account.userId, userId)))
      .limit(1)

    if (!credentials.length) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const credential = credentials[0]

    // Check if we need to refresh the token
    const expiresAt = credential.accessTokenExpiresAt
    const now = new Date()
    const needsRefresh = !expiresAt || expiresAt <= now

    if (needsRefresh && credential.refreshToken) {
      try {
        // Get the provider from the providerId (e.g., 'google-email' -> 'google')
        const provider = credential.providerId.split('-')[0]

        // Determine the token endpoint based on the provider
        let tokenEndpoint: string
        let clientId: string | undefined
        let clientSecret: string | undefined

        switch (provider) {
          case 'google':
            tokenEndpoint = 'https://oauth2.googleapis.com/token'
            clientId = process.env.GOOGLE_CLIENT_ID
            clientSecret = process.env.GOOGLE_CLIENT_SECRET
            break
          case 'github':
            tokenEndpoint = 'https://github.com/login/oauth/access_token'
            clientId = process.env.GITHUB_CLIENT_ID
            clientSecret = process.env.GITHUB_CLIENT_SECRET
            break
          case 'twitter':
            tokenEndpoint = 'https://api.twitter.com/2/oauth2/token'
            clientId = process.env.TWITTER_CLIENT_ID
            clientSecret = process.env.TWITTER_CLIENT_SECRET
            break
          default:
            throw new Error(`Unsupported provider: ${provider}`)
        }

        if (!clientId || !clientSecret) {
          throw new Error(`Missing client credentials for provider: ${provider}`)
        }

        // Refresh the token
        const response = await fetch(tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(provider === 'github' && {
              Accept: 'application/json',
            }),
          },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: credential.refreshToken,
          }).toString(),
        })

        if (!response.ok) {
          const errorText = await response.text()
          console.error('Token refresh failed:', response.status, errorText)
          throw new Error(`Failed to refresh token: ${response.status} ${errorText}`)
        }

        const data = await response.json()

        // Update the credential in the database
        await db
          .update(account)
          .set({
            accessToken: data.access_token,
            accessTokenExpiresAt: data.expires_in
              ? new Date(Date.now() + data.expires_in * 1000)
              : null,
            refreshToken: data.refresh_token || credential.refreshToken, // Some providers don't return a new refresh token
            updatedAt: new Date(),
          })
          .where(eq(account.id, credentialId))

        // Return the new access token
        return NextResponse.json({ accessToken: data.access_token }, { status: 200 })
      } catch (error) {
        console.error('Error refreshing token:', error)
        return NextResponse.json({ error: 'Failed to refresh access token' }, { status: 500 })
      }
    }

    // Return the current access token
    return NextResponse.json({ accessToken: credential.accessToken }, { status: 200 })
  } catch (error) {
    console.error('Error getting access token:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Get an OAuth token for a given credential ID
 */
export async function GET(request: NextRequest) {
  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Get the credential ID from the query params
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')

    if (!credentialId) {
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    // Get the credential from the database
    const credentials = await db
      .select()
      .from(account)
      .where(and(eq(account.id, credentialId), eq(account.userId, session.user.id)))
      .limit(1)

    if (!credentials.length) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const credential = credentials[0]

    // Check if the access token is valid
    if (!credential.accessToken) {
      return NextResponse.json({ error: 'No access token available' }, { status: 400 })
    }

    return NextResponse.json({ accessToken: credential.accessToken }, { status: 200 })
  } catch (error) {
    console.error('Error getting OAuth token:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
