import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { decryptSecret } from '@/lib/utils'
import { fetchWithRetry, getUserFriendlyError, parseErrorMessage } from '@/lib/api/retry'

export const dynamic = 'force-dynamic'

/**
 * GET /api/replicate/collections/[slug]
 * Gets models in a specific Replicate collection
 *
 * Path params:
 *   - slug: Collection slug (e.g., "text-to-image")
 *
 * Query params:
 *   - workspaceId: Optional workspace ID for environment variable resolution
 *
 * Returns collection details and array of models
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const { slug } = params
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
      `https://api.replicate.com/v1/collections/${slug}`,
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

    // Transform and deduplicate models using Map
    // Collections may contain multiple versions of the same model
    const modelsMap = new Map<string, { value: string; label: string; description: string }>()

    for (const model of data.models || []) {
      const modelKey = `${model.owner}/${model.name}`

      // Only add if not already present (keeps first occurrence)
      if (!modelsMap.has(modelKey)) {
        modelsMap.set(modelKey, {
          value: modelKey,
          label: modelKey,
          description: model.description || '',
        })
      }
    }

    // Convert Map values back to array
    const models = Array.from(modelsMap.values())

    return NextResponse.json({
      name: data.name,
      slug: data.slug,
      description: data.description,
      models,
    })
  } catch (error: any) {
    console.error('Collection fetch error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
