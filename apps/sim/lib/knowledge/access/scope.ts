import { type Principal, resolvePrincipalSubject } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  knowledgeExternalGroup,
  knowledgeExternalGroupMember,
  user,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, gte, inArray, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { LIVE_ENROLLMENT_STATUSES } from '@/lib/credential-groups/credentials'
import { resolveKnowledgeAccessAvailability } from '@/lib/knowledge/access/availability'
import { EXTERNAL_GROUP_STALE_AFTER_MS } from '@/lib/knowledge/access/external-groups'
import {
  groupToken,
  sortAccessTokens,
  subjectToken,
  userToken,
} from '@/lib/knowledge/access/tokens'
import {
  type KnowledgeAccessProvider,
  type KnowledgeAccessScope,
  WORKSPACE_ACCESS_TOKENS,
  type WorkspaceAccessScope,
} from '@/lib/knowledge/access/types'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('KnowledgeAccessScope')

export const WORKSPACE_ACCESS_SCOPE: WorkspaceAccessScope = Object.freeze({
  kind: 'workspace',
  tokens: WORKSPACE_ACCESS_TOKENS,
})

/**
 * An email address reduced to the identity it names. `user.email` is unique
 * byte-for-byte only, so this is the form every binding by email must compare
 * — and `user_email_lower_unique` indexes exactly this expression, so a
 * predicate written any other way silently becomes a sequential scan.
 */
function foldedEmail(column: AnyPgColumn): SQL<string> {
  return sql<string>`lower(btrim(${column}))`
}

/**
 * Whether some other account folds to this one's address.
 *
 * `user_email_lower_unique` is what makes that impossible; this is the
 * assertion that access control does not quietly depend on the constraint still
 * being there. An index can be dropped during an incident, and a restore can
 * bring back a database built before it existed — neither should silently hand
 * one person another's documents. One index probe per read is a fair price; it
 * plans as an index scan, not a table scan.
 */
const emailHeldByAnotherAccount = sql<boolean>`EXISTS (
  SELECT 1 FROM ${user} AS other
  WHERE other.id <> ${user.id}
    AND lower(btrim(other.email)) = ${foldedEmail(user.email)}
)`

/**
 * The `g:` tokens a person holds in a workspace, from the external directory
 * groups a crawl has mirrored.
 *
 * A group whose membership has not been confirmed within
 * {@link EXTERNAL_GROUP_STALE_AFTER_MS} grants nothing. A failed enumeration
 * never overwrites what it could not read, which is what keeps a transient
 * directory outage from revoking anyone — but that same property means a sync
 * that stopped running entirely would otherwise keep granting forever, from
 * membership nobody has checked since. The age bound is the ratchet: an outage
 * is survivable, an abandoned sync is not.
 */
async function loadExternalGroupTokens(email: string, workspaceId: string): Promise<string[]> {
  const freshEnough = new Date(Date.now() - EXTERNAL_GROUP_STALE_AFTER_MS)
  const rows = await db
    .select({
      providerId: knowledgeExternalGroup.providerId,
      tenantId: knowledgeExternalGroup.tenantId,
      externalGroupId: knowledgeExternalGroup.externalGroupId,
    })
    .from(knowledgeExternalGroupMember)
    .innerJoin(
      knowledgeExternalGroup,
      eq(knowledgeExternalGroup.id, knowledgeExternalGroupMember.groupId)
    )
    .where(
      and(
        eq(knowledgeExternalGroupMember.email, email),
        eq(knowledgeExternalGroup.workspaceId, workspaceId),
        gte(knowledgeExternalGroup.lastSyncedAt, freshEnough)
      )
    )

  const tokens: string[] = []
  for (const row of rows) {
    const token = groupToken({
      providerId: row.providerId,
      tenantId: row.tenantId,
      groupId: row.externalGroupId,
    })
    if (token) tokens.push(token)
  }
  return tokens
}

export interface KnowledgeAccessScopeContext {
  /** Undefined only for a legacy personal knowledge base, which cannot own connectors. */
  workspaceId?: string
}

/**
 * The tokens a person holds in a workspace: the workspace pair plus one `s:`
 * token per active managed credential bound to them through a credential-group
 * enrollment. The person must be email-verified — the enrollment binding is by
 * email, and an unverified address must not inherit grants made to whoever
 * really owns it. Nothing here is cached: revoking or suspending a credential
 * is visible on the next read.
 */
async function loadUserAccessTokens(
  userId: string,
  workspaceId: string | undefined
): Promise<string[]> {
  if (!workspaceId) return [...WORKSPACE_ACCESS_TOKENS]

  /**
   * Member tokens belong to current workspace members. Resolved before any
   * document is looked up, so someone who left the workspace but still holds
   * a managed credential cannot learn which documents their old tokens match.
   */
  const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
  if (!workspaceAccess.hasAccess) return [...WORKSPACE_ACCESS_TOKENS]
  /**
   * An identity token only counts where permission-aware knowledge is on, so
   * turning the feature off hides every permission-scoped document at once — on
   * the next read, before any run has suspended anyone — rather than leaving
   * people reading them until a run happens to land. Read first, so a workspace
   * without the feature never pays for the joins below.
   */
  const availability = await resolveKnowledgeAccessAvailability({ workspaceId })
  if (!availability.memberScoped && !availability.sourceMirrored) {
    return [...WORKSPACE_ACCESS_TOKENS]
  }

  const rows = await db
    .select({
      emailIsAmbiguous: emailHeldByAnotherAccount,
      email: foldedEmail(user.email),
      providerId: credential.providerId,
      providerTenantId: credential.providerTenantId,
      providerSubjectId: credential.providerSubjectId,
    })
    .from(user)
    .leftJoin(
      credentialGroupEnrollment,
      and(
        /**
         * The address is folded here rather than read from `normalized_email`,
         * which is declared unique but never written: a `COALESCE` over it
         * would silently start matching a different, broader set of people the
         * day anything backfills that column.
         */
        eq(credentialGroupEnrollment.email, foldedEmail(user.email)),
        inArray(credentialGroupEnrollment.status, [...LIVE_ENROLLMENT_STATUSES])
      )
    )
    .leftJoin(
      credentialGroup,
      and(
        eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId),
        eq(credentialGroup.status, 'active')
      )
    )
    .leftJoin(
      credential,
      and(
        eq(credential.credentialGroupEnrollmentId, credentialGroupEnrollment.id),
        eq(credential.workspaceId, workspaceId),
        eq(credential.type, 'managed_oauth'),
        eq(credential.managedOauthStatus, 'active'),
        /** The option must still be live, exactly as the member engine requires. */
        sql`EXISTS (
          SELECT 1 FROM jsonb_array_elements(${credentialGroup.options}) AS option
          WHERE option->>'id' = ${credential.credentialGroupOptionId}
            AND option->>'status' = 'active'
        )`
      )
    )
    .where(and(eq(user.id, userId), eq(user.emailVerified, true)))

  /**
   * An address two accounts share identifies neither of them, so it binds to
   * nothing. Both accounts keep the tokens every workspace member holds and
   * lose only what their identity would have granted — the safe direction, and
   * the one that cannot hand one person the other's documents.
   */
  if (rows.some((row) => row.emailIsAmbiguous)) {
    logger.error('Refusing identity-derived access tokens for an ambiguous email address', {
      userId,
      workspaceId,
    })
    return [...WORKSPACE_ACCESS_TOKENS]
  }

  const identityTokens = new Set<string>()
  for (const row of rows) {
    if (!availability.memberScoped || !row.providerSubjectId) continue
    try {
      identityTokens.add(subjectToken(row))
    } catch (error) {
      logger.warn('Skipping malformed managed credential subject', {
        userId,
        workspaceId,
        providerId: row.providerId,
        error: getErrorMessage(error),
      })
    }
  }

  /**
   * The person's own address, and the directory groups it belongs to. These are
   * what an admin-mode crawl mirrors onto documents, so they are how a source's
   * own permissions reach the reader. The address is verified — the
   * `emailVerified` predicate above is on the same query — so a grant made to
   * whoever really owns it cannot be claimed by someone who merely typed it.
   */
  const email = availability.sourceMirrored ? rows[0]?.email : undefined
  if (email) {
    const own = userToken(email)
    if (own) identityTokens.add(own)
    for (const token of await loadExternalGroupTokens(email, workspaceId)) {
      identityTokens.add(token)
    }
  }

  return sortAccessTokens(new Set([...WORKSPACE_ACCESS_TOKENS, ...identityTokens]))
}

/**
 * Resolves what a principal may read. A principal with a person behind it gets
 * that person's tokens; everything actorless — workspace API keys, scheduled,
 * webhook, chat, and MCP runs — gets the workspace pair, by policy. Never
 * consults a compatibility actor: a scheduled run must not inherit its
 * deployer's private documents.
 */
export async function resolveKnowledgeAccessScope(
  principal: Principal,
  context: KnowledgeAccessScopeContext
): Promise<KnowledgeAccessScope> {
  if (principal.kind === 'credential_group_enrollment') {
    throw new OrchestrationError(
      'forbidden',
      'Credential Group enrollments cannot read knowledge documents'
    )
  }
  const subject = resolvePrincipalSubject(principal)
  if (subject?.kind !== 'sim_user') return WORKSPACE_ACCESS_SCOPE
  return {
    kind: 'user',
    userId: subject.userId,
    tokens: await loadUserAccessTokens(subject.userId, context.workspaceId),
  }
}

/**
 * The scope of a person identified only by user id — the shape session-backed
 * routes outside the application layer have in hand. Never call this with a
 * user id that stands in for an actorless run (a workflow owner, a billing
 * owner); those callers use {@link WORKSPACE_ACCESS_SCOPE}.
 */
export async function resolveUserKnowledgeAccessScope(
  userId: string,
  workspaceId: string | undefined
): Promise<KnowledgeAccessScope> {
  return { kind: 'user', userId, tokens: await loadUserAccessTokens(userId, workspaceId) }
}

/** Memoises {@link resolveKnowledgeAccessScope} for one operation; a failed lookup is retried on the next call. */
export function createKnowledgeAccessProvider(
  principal: Principal,
  context: KnowledgeAccessScopeContext
): KnowledgeAccessProvider {
  let pending: Promise<KnowledgeAccessScope> | undefined
  return {
    get() {
      pending ??= resolveKnowledgeAccessScope(principal, context).catch((error: unknown) => {
        pending = undefined
        throw error
      })
      return pending
    },
  }
}
