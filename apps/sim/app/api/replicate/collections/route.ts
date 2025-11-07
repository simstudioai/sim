import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { decryptSecret } from '@/lib/utils'
import { fetchWithRetry, getUserFriendlyError, parseErrorMessage } from '@/lib/api/retry'

export const dynamic = 'force-dynamic'

/**
 * GET /api/replicate/collections
 * Lists all available Replicate collections
 *
 * Query params:
 *   - workspaceId: Optional workspace ID for environment variable resolution
 *
 * Returns array of collections with name, slug, and description
 */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId')
  const rawApiKey = request.headers.get('x-replicate-api-key')

  if (!rawApiKey) {
    return NextResponse.json(
      { error: 'API key required in x-replicate-api-key header' },
      { status: 401 }
    )
  }

  let apiKey = rawApiKey

  // Resolve environment variable if needed ({{VAR}} syntax)
  if (rawApiKey.match(/^\{\{[^}]+\}\}$/)) {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const varName = rawApiKey.slice(2, -2).trim()

    try {
      const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
        session.user.id,
        workspaceId || undefined
      )

      const variables = { ...personalEncrypted, ...workspaceEncrypted }
      const encryptedValue = variables[varName]

      if (!encryptedValue) {
        return NextResponse.json(
          {
            error: `Environment variable "${varName}" not found. Please add it in Settings → Environment.`,
          },
          { status: 400 }
        )
      }

      const { decrypted } = await decryptSecret(encryptedValue)
      apiKey = decrypted
    } catch (error: any) {
      return NextResponse.json(
        { error: `Failed to resolve environment variable "${varName}": ${error.message}` },
        { status: 500 }
      )
    }
  }

  try {
    const response = await fetchWithRetry(
      'https://api.replicate.com/v1/collections',
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      },
      {
        maxAttempts: 2,
        baseDelay: 500,
      }
    )

    if (!response.ok) {
      const errorMessage = await parseErrorMessage(response)
      const userFriendlyError = getUserFriendlyError(response.status, errorMessage, 'Replicate')

      return NextResponse.json({ error: userFriendlyError }, { status: response.status })
    }

    const data = await response.json()

    // Transform to dropdown options format
    const collections = (data.results || []).map((collection: any) => ({
      value: collection.slug,
      label: collection.name,
      description: collection.description || '',
    }))

    return NextResponse.json({ collections })
  } catch (error: any) {
    console.error('Collections fetch error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
