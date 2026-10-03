import { db } from '@sim/db'
import { credential, pendingCredentialDraft, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, gt, lt } from 'drizzle-orm'
import { resourceScopeColumns, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { defaultCredentialDisplayName } from '@/lib/credentials/display-name'
import { CREDENTIAL_DRAFT_TTL_MS } from '@/lib/credentials/draft-constants'
import {
  encryptQuickBooksOAuthClientConfig,
  type QuickBooksOAuthClientConfig,
} from '@/lib/oauth/quickbooks-client-config'
import { credentialProviderMatchesService, getAllOAuthServices } from '@/lib/oauth/utils'

const logger = createLogger('OAuthConnectDraft')
const MAX_CONNECT_DRAFT_CREDENTIAL_NAMES = 10_000

export type ConnectDraft = typeof pendingCredentialDraft.$inferSelect

export interface CreatedConnectDraft {
  id: string
  expiresAt: Date
}

/**
 * Creates the pending credential draft at OAuth click time so custom and
 * generic OAuth callbacks can materialize the connected workspace credential.
 */
export async function createConnectDraft(params: {
  userId: string
  workspaceId?: string
  organizationId?: string
  providerId: string
  /** Reconnect only: the existing credential the callback should rebind instead of creating a new one. */
  credentialId?: string
  /** Reconnect only: the credential's actual name, so audit records stay accurate. */
  displayName?: string
  description?: string
  oauthClientConfig?: QuickBooksOAuthClientConfig
}): Promise<CreatedConnectDraft> {
  const { userId, workspaceId, providerId, credentialId } = params
  const scope = resourceScopeFromOwner(params)

  if (providerId === 'quickbooks' && !params.oauthClientConfig) {
    throw new Error(
      'QuickBooks requires an OAuth client ID, client secret, environment, and webhook verifier token'
    )
  }
  if (providerId !== 'quickbooks' && params.oauthClientConfig) {
    throw new Error(`OAuth client configuration is not supported for provider ${providerId}`)
  }
  const oauthConfig = params.oauthClientConfig
    ? await encryptQuickBooksOAuthClientConfig(params.oauthClientConfig)
    : null

  let displayName = params.displayName
  if (!displayName) {
    // Matches through the canonical predicate so an alternate authorization
    // server's id resolves the service's real name — otherwise the default
    // label reads "My salesforce-sandbox".
    const service = getAllOAuthServices().find((s) =>
      credentialProviderMatchesService(providerId, s)
    )
    if (!service) throw new Error(`Cannot create OAuth draft for unknown provider ${providerId}`)
    const serviceName = service.name

    const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId))
    if (!row) throw new Error(`Cannot create OAuth draft for missing user ${userId}`)
    const userName = row.name

    // Auto-number against existing workspace credentials so repeat connects for
    // the same provider stay distinguishable — same behavior as the connect
    // modal, which computes this client-side.
    const rows = await db
      .select({ displayName: credential.displayName })
      .from(credential)
      .where(and(resourceScopeCondition(credential, scope), eq(credential.type, 'oauth')))
      .limit(MAX_CONNECT_DRAFT_CREDENTIAL_NAMES + 1)
    if (rows.length > MAX_CONNECT_DRAFT_CREDENTIAL_NAMES) {
      throw new Error('Workspace has too many OAuth credentials to generate a default name')
    }
    const takenNames = new Set(rows.map((credentialRow) => credentialRow.displayName.toLowerCase()))

    displayName = defaultCredentialDisplayName(userName, serviceName, takenNames)
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + CREDENTIAL_DRAFT_TTL_MS)
  await db
    .delete(pendingCredentialDraft)
    .where(
      and(eq(pendingCredentialDraft.userId, userId), lt(pendingCredentialDraft.expiresAt, now))
    )
  const id = generateId()
  const [draft] = await db
    .insert(pendingCredentialDraft)
    .values({
      id,
      userId,
      ...resourceScopeColumns(scope),
      providerId,
      displayName,
      description: params.description?.trim() || null,
      credentialId: credentialId ?? null,
      oauthConfig,
      expiresAt,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        pendingCredentialDraft.userId,
        pendingCredentialDraft.providerId,
        scope.kind === 'workspace'
          ? pendingCredentialDraft.workspaceId
          : pendingCredentialDraft.organizationId,
      ],
      /**
       * A new launch supersedes an abandoned or failed launch for this provider.
       * Rotating the primary key invalidates the earlier callback's exact draft
       * binding, so only the newest OAuth flow can materialize its intent.
       */
      set: {
        id,
        displayName,
        description: params.description?.trim() || null,
        credentialId: credentialId ?? null,
        oauthConfig,
        expiresAt,
        createdAt: now,
      },
    })
    .returning({ id: pendingCredentialDraft.id, expiresAt: pendingCredentialDraft.expiresAt })

  if (!draft) {
    throw new Error('Failed to create OAuth credential draft')
  }

  logger.info('Created OAuth connect credential draft', {
    userId,
    workspaceId,
    providerId,
    credentialId: credentialId ?? null,
  })
  return draft
}

export async function getActiveConnectDraft(
  draftId: string,
  userId: string
): Promise<ConnectDraft | null> {
  const [draft] = await db
    .select()
    .from(pendingCredentialDraft)
    .where(
      and(
        eq(pendingCredentialDraft.id, draftId),
        eq(pendingCredentialDraft.userId, userId),
        gt(pendingCredentialDraft.expiresAt, new Date())
      )
    )
    .limit(1)
  return draft ?? null
}
