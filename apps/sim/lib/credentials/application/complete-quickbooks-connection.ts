import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveCredentialConnectionTarget } from '@/lib/credentials/application/connection-target'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { type ConnectDraft, getActiveConnectDraft } from '@/lib/credentials/connect-draft'
import { processCredentialDraft } from '@/lib/credentials/draft-processor'
import {
  exchangeQuickBooksAuthorizationCode,
  fetchQuickBooksConnectionProfile,
} from '@/lib/oauth/quickbooks'
import { decryptQuickBooksOAuthClientConfig } from '@/lib/oauth/quickbooks-client-config'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'
import {
  type ActiveWorkspaceApplicationContext,
  loadActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'

export interface CompleteQuickBooksConnectionInput {
  draftId: string
  code: string
  realmId: string
  redirectUri: string
  signal?: AbortSignal
}

interface CompleteQuickBooksConnectionContext extends ActiveWorkspaceApplicationContext {
  draft: ConnectDraft
}

export const completeQuickBooksConnection = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.completeConnection,
  resolveContext: async ({
    principal,
    input,
  }: {
    principal: { kind: 'session'; userId: string; sessionId: string }
    input: CompleteQuickBooksConnectionInput
  }): Promise<CompleteQuickBooksConnectionContext> => {
    const draft = await getActiveConnectDraft(input.draftId, principal.userId)
    if (!draft?.workspaceId) {
      throw new OrchestrationError('not_found', 'QuickBooks connection link is invalid or expired')
    }
    const workspace = await loadActiveWorkspaceApplicationContext(draft.workspaceId)
    if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
    return { ...workspace, draft }
  },
  authorizationOptions: {},
  execute: async ({ principal, input, context }) => {
    if (context.draft.providerId !== 'quickbooks') {
      throw new OrchestrationError('validation', 'Credential draft is not for QuickBooks')
    }
    const target = await resolveCredentialConnectionTarget({
      principal,
      context,
      providerId: context.draft.credentialId ? undefined : context.draft.providerId,
      credentialId: context.draft.credentialId ?? undefined,
    })
    if (target.providerId !== 'quickbooks') {
      throw new OrchestrationError('conflict', 'OAuth connection provider no longer matches')
    }

    const oauthConfig = context.draft.oauthConfig
    if (!oauthConfig) {
      throw new OrchestrationError('validation', 'QuickBooks OAuth client configuration is missing')
    }
    const clientConfig = await decryptQuickBooksOAuthClientConfig(oauthConfig)
    const tokens = await exchangeQuickBooksAuthorizationCode({
      code: input.code,
      redirectUri: input.redirectUri,
      clientConfig,
      signal: input.signal,
    })
    const profile = await fetchQuickBooksConnectionProfile(
      tokens.accessToken,
      input.realmId,
      clientConfig
    )
    const now = new Date()
    const accessTokenExpiresAt = new Date(now.getTime() + tokens.accessTokenExpiresIn * 1000)
    const refreshTokenExpiresAt = new Date(now.getTime() + tokens.refreshTokenExpiresIn * 1000)
    const [existing] = await db
      .select({ id: account.id })
      .from(account)
      .where(
        and(
          eq(account.userId, principal.userId),
          eq(account.providerId, 'quickbooks'),
          eq(account.accountId, profile.accountId)
        )
      )
      .limit(1)

    const accountId = existing?.id ?? generateId()
    const accountValues = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      /**
       * Intuit's OIDC identity JWT is only meaningful at connection time, where
       * `profile.accountId` is already derived from it. Persisting it would project
       * the token into the credential payload of every QuickBooks tool call, none of
       * which read it.
       */
      idToken: null,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      scope: tokens.scope || getCanonicalScopesForProvider('quickbooks').join(' '),
      oauthConfig,
      updatedAt: now,
    }
    if (existing) {
      await db.update(account).set(accountValues).where(eq(account.id, existing.id))
    } else {
      await db.insert(account).values({
        id: accountId,
        accountId: profile.accountId,
        providerId: 'quickbooks',
        userId: principal.userId,
        ...accountValues,
        createdAt: now,
      })
    }

    await processCredentialDraft({
      draftId: context.draft.id,
      userId: principal.userId,
      providerId: 'quickbooks',
      accountId,
    })
    return { accountId, environment: clientConfig.environment, realmId: profile.realmId }
  },
})
