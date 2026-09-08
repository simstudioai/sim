import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { oauthAccessToken, oauthClient, oauthConsent } from '@sim/db/schema'
import { and, eq, or } from 'drizzle-orm'
import {
  keysetColumns,
  keysetPage,
  listOrderBy,
  resumeKeyset,
  searchFilter,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'
import type { OperationUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireUserAccountPrincipal } from '@/lib/users/application/authorization'
import { userAccountOperations } from '@/lib/users/application/operations'
import { AUTHORIZED_APPS_PAGE_SIZE } from '@/lib/users/constants'

export interface ListAuthorizedAppsInput {
  cursor?: string
  search?: string
}

interface AuthorizedAppRecord {
  clientId: string
  name: string | null
  scopes: string[]
  authorizedAt: Date
}

export interface ListAuthorizedAppsResult {
  apps: AuthorizedAppRecord[]
  nextCursor: string | null
}

const AUTHORIZED_APP_KEYS = [
  timestampKey<AuthorizedAppRecord>(oauthConsent.createdAt, (app) => app.authorizedAt),
  textKey<AuthorizedAppRecord>(oauthConsent.clientId, (app) => app.clientId),
]

function readAuthorizedAppsCursor(cursor: string | undefined): string[] | undefined {
  if (!cursor) return undefined
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      !decoded.every((key): key is string => typeof key === 'string' && key.length > 0)
    ) {
      throw new Error('Malformed cursor')
    }
    return decoded
  } catch {
    throw new OrchestrationError('validation', 'Invalid authorized apps cursor')
  }
}

/**
 * The OAuth clients this account has consented to, newest grant first.
 *
 * A consent row is the grant, so it is the whole answer: it survives every
 * token the client has rotated through, and its age is what a person weighs
 * when deciding whether an app should still have access.
 */
export const listAuthorizedAppsUseCase: OperationUseCase<
  typeof userAccountOperations.readAuthorizedApps,
  ListAuthorizedAppsInput,
  ListAuthorizedAppsResult
> = {
  operation: userAccountOperations.readAuthorizedApps,
  async execute({ principal, input }) {
    requireUserAccountPrincipal(principal, userAccountOperations.readAuthorizedApps)
    const search = input.search?.trim() || undefined
    const after = resumeKeyset(AUTHORIZED_APP_KEYS, readAuthorizedAppsCursor(input.cursor), 'desc')

    const rows = await db
      .select({
        clientId: oauthConsent.clientId,
        name: oauthClient.name,
        scopes: oauthConsent.scopes,
        authorizedAt: oauthConsent.createdAt,
      })
      .from(oauthConsent)
      .innerJoin(oauthClient, eq(oauthConsent.clientId, oauthClient.clientId))
      .where(
        and(
          eq(oauthConsent.userId, principal.userId),
          search
            ? or(searchFilter(oauthClient.name, search), searchFilter(oauthClient.clientId, search))
            : undefined,
          after
        )
      )
      .orderBy(...listOrderBy(keysetColumns(AUTHORIZED_APP_KEYS), 'desc'))
      .limit(AUTHORIZED_APPS_PAGE_SIZE + 1)

    const page = keysetPage(AUTHORIZED_APP_KEYS, rows, AUTHORIZED_APPS_PAGE_SIZE)
    return {
      apps: page.data,
      nextCursor: page.nextCursorKeys
        ? Buffer.from(JSON.stringify(page.nextCursorKeys)).toString('base64url')
        : null,
    }
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
