import { db } from '@sim/db'
import { account, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { jwtDecode } from 'jwt-decode'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { evaluateScopeCoverage, type OAuthProvider, parseProvider } from '@/lib/oauth'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthCredentialsAPI')

const credentialsQuerySchema = z
  .object({
    provider: z.string().nullish(),
    workflowId: z.string().uuid('Workflow ID must be a valid UUID').nullish(),
    credentialId: z
      .string()
      .min(1, 'Credential ID must not be empty')
      .max(255, 'Credential ID is too long')
      .nullish(),
  })
  .refine((data) => data.provider || data.credentialId, {
    message: 'Provider or credentialId is required',
    path: ['provider'],
  })

interface GoogleIdToken {
  email?: string
  sub?: string
  name?: string
}

/**
 * Get credentials for a specific provider
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { searchParams } = new URL(request.url)
    const rawQuery = {
      provider: searchParams.get('provider'),
      workflowId: searchParams.get('workflowId'),
      credentialId: searchParams.get('credentialId'),
    }

    const parseResult = credentialsQuerySchema.safeParse(rawQuery)

    if (!parseResult.success) {
      const refinementError = parseResult.error.errors.find((err) => err.code === 'custom')
      if (refinementError) {
        logger.warn(`[${requestId}] Invalid query parameters: ${refinementError.message}`)
        return NextResponse.json(
          {
            error: refinementError.message,
          },
          { status: 400 }
        )
      }

      const firstError = parseResult.error.errors[0]
      const errorMessage = firstError?.message || 'Validation failed'

      logger.warn(`[${requestId}] Invalid query parameters`, {
        errors: parseResult.error.errors,
      })

      return NextResponse.json(
        {
          error: errorMessage,
        },
        { status: 400 }
      )
    }

    const { provider: providerParam, workflowId, credentialId } = parseResult.data

    // Authenticate requester (supports session and internal JWT)
    const authResult = await checkSessionOrInternalAuth(request)
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthenticated credentials request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }
    const requesterUserId = authResult.userId

    const effectiveUserId = requesterUserId
    if (workflowId) {
      const workflowAuthorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: requesterUserId,
        action: 'read',
      })
      if (!workflowAuthorization.allowed) {
        logger.warn(`[${requestId}] Forbidden credentials request for workflow`, {
          requesterUserId,
          workflowId,
          status: workflowAuthorization.status,
        })
        return NextResponse.json(
          { error: workflowAuthorization.message || 'Forbidden' },
          { status: workflowAuthorization.status }
        )
      }
    }

    // Parse the provider to get base provider and feature type (if provider is present)
    const { baseProvider } = parseProvider((providerParam || 'google') as OAuthProvider)

    let accountsData

    if (credentialId) {
      accountsData = await db
        .select()
        .from(account)
        .where(and(eq(account.userId, effectiveUserId), eq(account.id, credentialId)))
    } else {
      // Fetch all credentials for provider and effective user
      accountsData = await db
        .select()
        .from(account)
        .where(and(eq(account.userId, effectiveUserId), eq(account.providerId, providerParam!)))
    }

    // Transform accounts into credentials
    const credentials = await Promise.all(
      accountsData.map(async (acc) => {
        // Extract the feature type from providerId (e.g., 'google-default' -> 'default')
        const [_, featureType = 'default'] = acc.providerId.split('-')

        // Try multiple methods to get a user-friendly display name
        let displayName = ''

        // Method 1: Try to extract email from ID token (works for Google, etc.)
        if (acc.idToken) {
          try {
            const decoded = jwtDecode<GoogleIdToken>(acc.idToken)
            if (decoded.email) {
              displayName = decoded.email
            } else if (decoded.name) {
              displayName = decoded.name
            }
          } catch (_error) {
            logger.warn(`[${requestId}] Error decoding ID token`, {
              accountId: acc.id,
            })
          }
        }

        // Method 2: For GitHub, the accountId might be the username
        if (!displayName && baseProvider === 'github') {
          displayName = `${acc.accountId} (GitHub)`
        }

        // Method 3: Try to get the user's email from our database
        if (!displayName) {
          try {
            const userRecord = await db
              .select({ email: user.email })
              .from(user)
              .where(eq(user.id, acc.userId))
              .limit(1)

            if (userRecord.length > 0) {
              displayName = userRecord[0].email
            }
          } catch (_error) {
            logger.warn(`[${requestId}] Error fetching user email`, {
              userId: acc.userId,
            })
          }
        }

        // Fallback: Use accountId with provider type as context
        if (!displayName) {
          displayName = `${acc.accountId} (${baseProvider})`
        }

        const storedScope = acc.scope?.trim()
        const grantedScopes = storedScope ? storedScope.split(/[\s,]+/).filter(Boolean) : []
        const scopeEvaluation = evaluateScopeCoverage(acc.providerId, grantedScopes)

        return {
          id: acc.id,
          name: displayName,
          provider: acc.providerId,
          lastUsed: acc.updatedAt.toISOString(),
          isDefault: featureType === 'default',
          scopes: scopeEvaluation.grantedScopes,
          canonicalScopes: scopeEvaluation.canonicalScopes,
          missingScopes: scopeEvaluation.missingScopes,
          extraScopes: scopeEvaluation.extraScopes,
          requiresReauthorization: scopeEvaluation.requiresReauthorization,
        }
      })
    )

    return NextResponse.json({ credentials }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching OAuth credentials`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
