import { db } from '@sim/db'
import { account, credential, credentialMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { syncWorkspaceOAuthCredentialsForUser } from '@/lib/credentials/oauth'
import {
  getCanonicalScopesForProvider,
  getServiceAccountProviderForProviderId,
} from '@/lib/oauth/utils'
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

function toCredentialResponse(
  id: string,
  displayName: string,
  providerId: string,
  updatedAt: Date,
  scope: string | null,
  credentialType: 'oauth' | 'service_account' = 'oauth'
) {
  const storedScope = scope?.trim()
  // Some providers (e.g. Box) don't return scopes in their token response,
  // so the DB column stays empty. Fall back to the configured scopes for
  // the provider so the credential-selector doesn't show a false
  // "Additional permissions required" banner.
  const scopes = storedScope
    ? storedScope.split(/[\s,]+/).filter(Boolean)
    : getCanonicalScopesForProvider(providerId)
  const [_, featureType = 'default'] = providerId.split('-')

  return {
    id,
    name: displayName,
    provider: providerId,
    type: credentialType,
    lastUsed: updatedAt.toISOString(),
    isDefault: featureType === 'default',
    scopes,
  }
}

/**
 * Get credentials for a specific provider
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
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

    if (credentialId) {
      const [platformCredential] = await db
        .select({
          id: credential.id,
          workspaceId: credential.workspaceId,
          type: credential.type,
          displayName: credential.displayName,
          providerId: credential.providerId,
          accountId: credential.accountId,
          updatedAt: credential.updatedAt,
          accountProviderId: account.providerId,
          accountScope: account.scope,
          accountUpdatedAt: account.updatedAt,
        })
        .from(credential)
        .leftJoin(account, eq(credential.accountId, account.id))
        .where(eq(credential.id, credentialId))
        .limit(1)

      if (platformCredential) {
        if (platformCredential.type === 'service_account') {
          if (
            workflowId &&
            (!effectiveWorkspaceId || platformCredential.workspaceId !== effectiveWorkspaceId)
          ) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
          }

          if (!workflowId) {
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

          return NextResponse.json(
            {
              credentials: [
                toCredentialResponse(
                  platformCredential.id,
                  platformCredential.displayName,
                  platformCredential.providerId || 'google-service-account',
                  platformCredential.updatedAt,
                  null,
                  'service_account'
                ),
              ],
            },
            { status: 200 }
          )
        }

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

      const results = credentialsData.map((row) =>
        toCredentialResponse(row.id, row.displayName, row.providerId, row.updatedAt, row.scope)
      )

      const saProviderId = getServiceAccountProviderForProviderId(providerParam)

      if (saProviderId) {
        const serviceAccountCreds = await db
          .select({
            id: credential.id,
            displayName: credential.displayName,
            providerId: credential.providerId,
            updatedAt: credential.updatedAt,
          })
          .from(credential)
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
              eq(credential.type, 'service_account'),
              eq(credential.providerId, saProviderId)
            )
          )

        for (const sa of serviceAccountCreds) {
          results.push(
            toCredentialResponse(
              sa.id,
              sa.displayName,
              sa.providerId || saProviderId,
              sa.updatedAt,
              null,
              'service_account'
            )
          )
        }
      }

      return NextResponse.json({ credentials: results }, { status: 200 })
    }

    return NextResponse.json({ credentials: [] }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching OAuth credentials`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
