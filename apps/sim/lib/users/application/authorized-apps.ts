import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from '@sim/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import type { AuthorizedApp } from '@/lib/api/contracts/user'
import type { OperationUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireUserAccountPrincipal } from '@/lib/users/application/authorization'
import { userAccountOperations } from '@/lib/users/application/operations'

/**
 * The OAuth clients this account has consented to, newest grant first.
 *
 * A consent row is the grant, so it is the whole answer: it survives every
 * token the client has rotated through, and its age is what a person weighs
 * when deciding whether an app should still have access.
 */
export const listAuthorizedAppsUseCase: OperationUseCase<
  typeof userAccountOperations.readAuthorizedApps,
  Record<string, never>,
  AuthorizedApp[]
> = {
  operation: userAccountOperations.readAuthorizedApps,
  async execute({ principal }) {
    requireUserAccountPrincipal(principal, userAccountOperations.readAuthorizedApps)

    const rows = await db
      .select({
        clientId: oauthConsent.clientId,
        name: oauthClient.name,
        scopes: oauthConsent.scopes,
        authorizedAt: oauthConsent.createdAt,
      })
      .from(oauthConsent)
      .innerJoin(oauthClient, eq(oauthConsent.clientId, oauthClient.clientId))
      .where(eq(oauthConsent.userId, principal.userId))
      .orderBy(desc(oauthConsent.createdAt))

    return rows.map((row) => ({
      clientId: row.clientId,
      name: row.name ?? row.clientId,
      scopes: row.scopes,
      authorizedAt: row.authorizedAt.toISOString(),
    }))
  },
}

export interface RevokeAuthorizedAppInput {
  clientId: string
}

/**
 * Withdraws an app's access to the account in one transaction: the consent
 * (so the next authorize asks again), every live refresh token (so the app
 * cannot mint another access token), and every access token (so the ones it
 * holds stop working on the next request). The plugin's own delete-consent
 * endpoint removes only the first, which is why this lives here.
 */
export const revokeAuthorizedAppUseCase: OperationUseCase<
  typeof userAccountOperations.revokeAuthorizedApp,
  RevokeAuthorizedAppInput,
  { clientId: string; name: string }
> = {
  operation: userAccountOperations.revokeAuthorizedApp,
  async execute({ principal, input }) {
    requireUserAccountPrincipal(principal, userAccountOperations.revokeAuthorizedApp)
    const userId = principal.userId
    const clientId = input.clientId

    const revoked = await db.transaction(async (tx) => {
      const [consent] = await tx
        .select({ id: oauthConsent.id, name: oauthClient.name })
        .from(oauthConsent)
        .innerJoin(oauthClient, eq(oauthConsent.clientId, oauthClient.clientId))
        .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
        .limit(1)
      if (!consent) return null

      await tx
        .delete(oauthConsent)
        .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
      await tx
        .delete(oauthRefreshToken)
        .where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId)))
      await tx
        .delete(oauthAccessToken)
        .where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId)))

      return { clientId, name: consent.name ?? clientId }
    })

    if (!revoked) throw new OrchestrationError('not_found', 'Authorized app not found')

    recordAudit({
      workspaceId: null,
      actorId: userId,
      action: AuditAction.OAUTH_APP_REVOKED,
      resourceType: AuditResourceType.OAUTH_CLIENT,
      resourceId: revoked.clientId,
      resourceName: revoked.name,
      description: `Revoked ${revoked.name}'s access to the account`,
    })

    return revoked
  },
}
