import { db } from '@sim/db'
import { account, credential, credentialMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { oauthCredentialsQuerySchema } from '@/lib/api/contracts/credentials'
import { getValidationErrorMessage } from '@/lib/api/server'
import { AuthType, type AuthTypeValue, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { canUseCredential, getCredentialActorContext } from '@/lib/credentials/access'
import { syncWorkspaceOAuthCredentialsForUser } from '@/lib/credentials/oauth'
import {
  getCanonicalScopesForProvider,
  getServiceAccountProviderForProviderId,
  providerIdsForService,
} from '@/lib/oauth/utils'
import {
  capabilityRefusal,
  isWorkspaceCapabilityWithheld,
} from '@/lib/permission-groups/capability-assertions'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthCredentialsAPI')

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
 * Whether `integrations.manage` is withheld from the caller in `workspaceId`.
 *
 * Only a session is asked. This route authenticates through
 * `checkSessionOrInternalAuth`, so the same handler answers both a person
 * opening the credential selector and the executor resolving a credential for a
 * running workflow. A permission group describes what a *person* may reach; the
 * executor is not that person, and refusing it would stop a deployed workflow
 * the group permits — a run failing hours after an admin ticked a box, with
 * nothing on the surface connecting the two. So the arm that carries a human
 * intent is gated and the machine arm is not, which is the same split
 * `principalUserId` makes for a workspace API key.
 */
async function integrationsWithheldFromSession(
  authType: AuthTypeValue | undefined,
  userId: string,
  workspaceId: string | null | undefined
): Promise<boolean> {
  if (authType !== AuthType.SESSION) return false
  if (!workspaceId) return false
  return isWorkspaceCapabilityWithheld(userId, workspaceId, 'integrations.manage')
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

    const parseResult = oauthCredentialsQuerySchema.safeParse(rawQuery)

    if (!parseResult.success) {
      const refinementError = parseResult.error.issues.find((err) => err.code === 'custom')
      if (refinementError) {
        logger.warn(`[${requestId}] Invalid query parameters: ${refinementError.message}`)
        return NextResponse.json({ error: refinementError.message }, { status: 400 })
      }

      logger.warn(`[${requestId}] Invalid query parameters`, {
        errors: parseResult.error.issues,
      })

      return NextResponse.json(
        { error: getValidationErrorMessage(parseResult.error, 'Validation failed') },
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

    let requesterCanAdmin = false
    if (effectiveWorkspaceId) {
      const workspaceAccess = await checkWorkspaceAccess(effectiveWorkspaceId, requesterUserId)
      if (!workspaceAccess.hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      requesterCanAdmin = workspaceAccess.canAdmin

      // permission-group-enforced: integrations.manage — raw handler with inline queries, which the authorization funnel never sees
      if (
        await integrationsWithheldFromSession(
          authResult.authType,
          requesterUserId,
          effectiveWorkspaceId
        )
      ) {
        return NextResponse.json(
          { error: capabilityRefusal('integrations.manage') },
          { status: 403 }
        )
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
        /**
         * The credential names the workspace whose group governs it, and that is
         * asked unconditionally — not only when the query named no workspace.
         * The asserted `workspaceId` is the caller's to choose, so gating on it
         * alone let a caller who reaches two workspaces pair the ungoverned one
         * with a credential from the workspace whose group withholds
         * Integrations, and read it. Both are checked; either withholding is a
         * refusal, and the resolver memoizes the repeat when they are the same.
         *
         * Asked after each branch's own access check, never before: a caller who
         * may not reach this credential at all must not learn from the refusal
         * wording that the workspace it belongs to is one their group governs.
         */
        const credentialScopeWithheld = () =>
          integrationsWithheldFromSession(
            authResult.authType,
            requesterUserId,
            platformCredential.workspaceId
          )

        if (platformCredential.type === 'service_account') {
          if (
            workflowId &&
            (!effectiveWorkspaceId || platformCredential.workspaceId !== effectiveWorkspaceId)
          ) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
          }

          if (!workflowId) {
            const access = await getCredentialActorContext(platformCredential.id, requesterUserId)
            if (!canUseCredential(access)) {
              return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
          }

          // permission-group-enforced: integrations.manage — the credentialId path carries its own workspace scope
          if (await credentialScopeWithheld()) {
            return NextResponse.json(
              { error: capabilityRefusal('integrations.manage') },
              { status: 403 }
            )
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
          const access = await getCredentialActorContext(platformCredential.id, requesterUserId)
          if (!canUseCredential(access)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
          }
        }

        // permission-group-enforced: integrations.manage — the credentialId path carries its own workspace scope
        if (await credentialScopeWithheld()) {
          return NextResponse.json(
            { error: capabilityRefusal('integrations.manage') },
            { status: 403 }
          )
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

      const oauthSelect = {
        id: credential.id,
        displayName: credential.displayName,
        providerId: account.providerId,
        scope: account.scope,
        updatedAt: account.updatedAt,
      }
      const credentialsData = await db
        .select(oauthSelect)
        .from(credential)
        .innerJoin(account, eq(credential.accountId, account.id))
        .leftJoin(
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
            inArray(account.providerId, providerIdsForService(providerParam)),
            requesterCanAdmin ? undefined : isNotNull(credentialMember.id)
          )
        )

      const results = credentialsData.map((row) =>
        toCredentialResponse(row.id, row.displayName, row.providerId, row.updatedAt, row.scope)
      )

      const saProviderId = getServiceAccountProviderForProviderId(providerParam)

      if (saProviderId) {
        const saSelect = {
          id: credential.id,
          displayName: credential.displayName,
          providerId: credential.providerId,
          updatedAt: credential.updatedAt,
        }
        const serviceAccountCreds = await db
          .select(saSelect)
          .from(credential)
          .leftJoin(
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
              eq(credential.providerId, saProviderId),
              requesterCanAdmin ? undefined : isNotNull(credentialMember.id)
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
