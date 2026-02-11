import { db } from '@sim/db'
import { account, credential, credentialMember, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { jwtDecode } from 'jwt-decode'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { syncWorkspaceOAuthCredentialsForUser } from '@/lib/credentials/oauth'
import { evaluateScopeCoverage, type OAuthProvider, parseProvider } from '@/lib/oauth'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthCredentialsAPI')

const credentialsQuerySchema = z
  .object({
    provider: z.string().nullish(),
    workflowId: z.string().uuid('Workflow ID must be a valid UUID').nullish(),
    workspaceId: z.string().uuid('Workspace ID must be a valid UUID').nullish(),
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

function toCredentialResponse(
  id: string,
  displayName: string,
  providerId: string,
  updatedAt: Date,
  scope: string | null
) {
  const storedScope = scope?.trim()
  const grantedScopes = storedScope ? storedScope.split(/[\s,]+/).filter(Boolean) : []
  const scopeEvaluation = evaluateScopeCoverage(providerId, grantedScopes)
  const [_, featureType = 'default'] = providerId.split('-')

  return {
    id,
    name: displayName,
    provider: providerId,
    lastUsed: updatedAt.toISOString(),
    isDefault: featureType === 'default',
    scopes: scopeEvaluation.grantedScopes,
    canonicalScopes: scopeEvaluation.canonicalScopes,
    missingScopes: scopeEvaluation.missingScopes,
    extraScopes: scopeEvaluation.extraScopes,
    requiresReauthorization: scopeEvaluation.requiresReauthorization,
  }
}

async function getFallbackDisplayName(
  requestId: string,
  providerParam: string | null | undefined,
  accountRow: {
    idToken: string | null
    accountId: string
    userId: string
  }
) {
  const providerForParse = (providerParam || 'google') as OAuthProvider
  const { baseProvider } = parseProvider(providerForParse)

  if (accountRow.idToken) {
    try {
      const decoded = jwtDecode<GoogleIdToken>(accountRow.idToken)
      if (decoded.email) return decoded.email
      if (decoded.name) return decoded.name
    } catch (_error) {
      logger.warn(`[${requestId}] Error decoding ID token`, {
        accountId: accountRow.accountId,
      })
    }
  }

  if (baseProvider === 'github') {
    return `${accountRow.accountId} (GitHub)`
  }

  try {
    const userRecord = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, accountRow.userId))
      .limit(1)

    if (userRecord.length > 0) {
      return userRecord[0].email
    }
  } catch (_error) {
    logger.warn(`[${requestId}] Error fetching user email`, {
      userId: accountRow.userId,
    })
  }

  return `${accountRow.accountId} (${baseProvider})`
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
      workspaceId: searchParams.get('workspaceId'),
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

    const { provider: providerParam, workflowId, workspaceId, credentialId } = parseResult.data

    // Authenticate requester (supports session and internal JWT)
    const authResult = await checkSessionOrInternalAuth(request)
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthenticated credentials request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }
    const requesterUserId = authResult.userId

    let effectiveWorkspaceId = workspaceId ?? undefined
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
      effectiveWorkspaceId = workflowAuthorization.workflow?.workspaceId || undefined
    }

    if (effectiveWorkspaceId) {
      const workspaceAccess = await checkWorkspaceAccess(effectiveWorkspaceId, requesterUserId)
      if (!workspaceAccess.hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    let accountsData

    if (credentialId) {
      const [platformCredential] = await db
        .select({
          id: credential.id,
          workspaceId: credential.workspaceId,
          type: credential.type,
          displayName: credential.displayName,
          providerId: credential.providerId,
          accountId: credential.accountId,
          accountProviderId: account.providerId,
          accountScope: account.scope,
          accountUpdatedAt: account.updatedAt,
        })
        .from(credential)
        .leftJoin(account, eq(credential.accountId, account.id))
        .where(eq(credential.id, credentialId))
        .limit(1)

      if (platformCredential) {
        if (platformCredential.type !== 'oauth' || !platformCredential.accountId) {
          return NextResponse.json({ credentials: [] }, { status: 200 })
        }

        if (workflowId) {
          if (!effectiveWorkspaceId || platformCredential.workspaceId !== effectiveWorkspaceId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
          }
        } else {
          const [membership] = await db
            .select({ id: credentialMember.id })
            .from(credentialMember)
            .where(
              and(
                eq(credentialMember.credentialId, platformCredential.id),
                eq(credentialMember.userId, requesterUserId),
                eq(credentialMember.status, 'active')
              )
            )
            .limit(1)

          if (!membership) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
          }
        }

        if (!platformCredential.accountProviderId || !platformCredential.accountUpdatedAt) {
          return NextResponse.json({ credentials: [] }, { status: 200 })
        }

        return NextResponse.json(
          {
            credentials: [
              toCredentialResponse(
                platformCredential.id,
                platformCredential.displayName,
                platformCredential.accountProviderId,
                platformCredential.accountUpdatedAt,
                platformCredential.accountScope
              ),
            ],
          },
          { status: 200 }
        )
      }
    }

    if (effectiveWorkspaceId && providerParam) {
      await syncWorkspaceOAuthCredentialsForUser({
        workspaceId: effectiveWorkspaceId,
        userId: requesterUserId,
      })

      const credentialsData = await db
        .select({
          id: credential.id,
          displayName: credential.displayName,
          providerId: account.providerId,
          scope: account.scope,
          updatedAt: account.updatedAt,
        })
        .from(credential)
        .innerJoin(account, eq(credential.accountId, account.id))
        .innerJoin(
          credentialMember,
          and(
            eq(credentialMember.credentialId, credential.id),
            eq(credentialMember.userId, requesterUserId),
            eq(credentialMember.status, 'active')
          )
        )
        .where(
          and(
            eq(credential.workspaceId, effectiveWorkspaceId),
            eq(credential.type, 'oauth'),
            eq(account.providerId, providerParam)
          )
        )

      return NextResponse.json(
        {
          credentials: credentialsData.map((row) =>
            toCredentialResponse(row.id, row.displayName, row.providerId, row.updatedAt, row.scope)
          ),
        },
        { status: 200 }
      )
    }

    if (credentialId && workflowId) {
      accountsData = await db.select().from(account).where(eq(account.id, credentialId))
    } else if (credentialId) {
      accountsData = await db
        .select()
        .from(account)
        .where(and(eq(account.userId, requesterUserId), eq(account.id, credentialId)))
    } else {
      accountsData = await db
        .select()
        .from(account)
        .where(and(eq(account.userId, requesterUserId), eq(account.providerId, providerParam!)))
    }

    // Transform accounts into credentials
    const credentials = await Promise.all(
      accountsData.map(async (acc) => {
        const displayName = await getFallbackDisplayName(requestId, providerParam, acc)
        return toCredentialResponse(acc.id, displayName, acc.providerId, acc.updatedAt, acc.scope)
      })
    )

    return NextResponse.json({ credentials }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching OAuth credentials`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
