import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { hasAuthorizedProviderServer } from '@/lib/oauth'
import { OAuthProvider } from '@/tools/types'

/**
 * API endpoint to check if a user has authorized a specific OAuth provider
 *
 * @param request - The request object with provider and optional scopes
 * @returns JSON response with authorization status
 */
export async function GET(request: NextRequest) {
  try {
    // Get the session
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ isAuthorized: false, error: 'Not authenticated' }, { status: 401 })
    }

    // Get the provider from the query string
    const url = new URL(request.url)
    const provider = url.searchParams.get('provider') as OAuthProvider | null

    if (!provider) {
      return NextResponse.json(
        { isAuthorized: false, error: 'Provider is required' },
        { status: 400 }
      )
    }

    // Get optional scopes from the query string
    const scopesParam = url.searchParams.get('scopes')
    const requiredScopes = scopesParam ? scopesParam.split(',') : undefined

    // Check if the user has authorized this provider with the required scopes
    const isAuthorized = await hasAuthorizedProviderServer(provider, requiredScopes)

    return NextResponse.json({ isAuthorized })
  } catch (error) {
    console.error('Error checking OAuth authorization:', error)
    return NextResponse.json(
      { isAuthorized: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
