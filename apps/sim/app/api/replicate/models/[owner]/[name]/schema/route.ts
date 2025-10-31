import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { dereferenceSchema } from '@/lib/response-format'
import { decryptSecret } from '@/lib/utils'
import { fetchWithRetry, getUserFriendlyError, parseErrorMessage } from '@/lib/api/retry'

export const dynamic = 'force-dynamic'

/**
 * GET /api/replicate/models/[owner]/[name]/schema
 * Fetches and dereferences the input/output schema for a Replicate model
 * Query params:
 *   - version: Optional specific version ID (defaults to latest)
 *   - workspaceId: Optional workspace ID for environment variable resolution
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { owner: string; name: string } }
) {
  const { owner, name } = params
  const rawApiKey = request.headers.get('x-replicate-api-key')
  const versionId = request.nextUrl.searchParams.get('version')
  const workspaceId = request.nextUrl.searchParams.get('workspaceId')

  if (!rawApiKey) {
    return NextResponse.json({ error: 'API key required in x-replicate-api-key header' }, { status: 401 })
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
      // Load encrypted environment variables (personal + workspace)
      const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
        session.user.id,
        workspaceId || undefined
      )

      // Merge variables (workspace overrides personal)
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

      // Decrypt the variable value
      const { decrypted } = await decryptSecret(encryptedValue)
      apiKey = decrypted
    } catch (error: any) {
      console.error('Environment variable resolution error:', error)
      return NextResponse.json(
        {
          error: `Failed to resolve environment variable "${varName}": ${error.message}`,
        },
        { status: 500 }
      )
    }
  }

  try {
    // Construct URL based on whether version is specified
    let url = `https://api.replicate.com/v1/models/${owner}/${name}`
    if (versionId) {
      url += `/versions/${versionId}`
    }

    const response = await fetchWithRetry(
      url,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        // Use Next.js caching instead of custom cache
        next: { revalidate: 3600 }, // 1 hour cache
      },
      {
        maxAttempts: 3,
        baseDelay: 1000,
        retryableStatusCodes: [429, 500, 502, 503, 504],
      }
    )

    if (!response.ok) {
      const errorMessage = await parseErrorMessage(response)
      const userFriendlyError = getUserFriendlyError(response.status, errorMessage, 'Replicate')

      return NextResponse.json({ error: userFriendlyError }, { status: response.status })
    }

    const data = await response.json()

    // Get version data (either from specific version or latest)
    const versionData = versionId ? data : data.latest_version

    if (!versionData) {
      return NextResponse.json({ error: 'No version data available' }, { status: 404 })
    }

    const fullSchema = versionData.openapi_schema

    if (!fullSchema?.components?.schemas) {
      return NextResponse.json({ error: 'No OpenAPI schema available for this model' }, { status: 404 })
    }

    // Dereference the input and output schemas
    const inputSchema = fullSchema.components.schemas.Input
      ? dereferenceSchema(fullSchema.components.schemas.Input, fullSchema)
      : null

    const outputSchema = fullSchema.components.schemas.Output
      ? dereferenceSchema(fullSchema.components.schemas.Output, fullSchema)
      : null

    const schemaResponse = {
      version_id: versionData.id,
      input: inputSchema,
      output: outputSchema,
    }

    return NextResponse.json(schemaResponse)
  } catch (error: any) {
    console.error('Schema fetch error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
