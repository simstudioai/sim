import { type Principal, resolvePrincipalSubject } from '@sim/auth/principal'
import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { LIVE_ENROLLMENT_STATUSES } from '@/lib/credential-groups/credentials'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { sortAccessTokens, subjectToken } from '@/lib/knowledge/access/tokens'
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

/** Enrollment states under which a credential-group membership counts as live. */

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
   * A member token only counts where permission-aware knowledge is on, so
   * turning the feature off hides every member-scoped document at once — on
   * the next read, before any run has suspended anyone — rather than leaving
   * enrolled members reading them until a run happens to land. Read first, so
   * a workspace without the feature never pays for the enrollment join.
   */
  if (!(await isKnowledgeMemberAccessAvailable({ workspaceId }))) {
    return [...WORKSPACE_ACCESS_TOKENS]
  }

  const rows = await db
    .select({
      providerId: credential.providerId,
      providerTenantId: credential.providerTenantId,
      providerSubjectId: credential.providerSubjectId,
    })
    .from(user)
    .leftJoin(
      credentialGroupEnrollment,
      and(
        eq(
          credentialGroupEnrollment.email,
          sql`COALESCE(${user.normalizedEmail}, lower(btrim(${user.email})))`
        ),
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

  const subjectTokens = new Set<string>()
  for (const row of rows) {
    if (!row.providerSubjectId) continue
    try {
      subjectTokens.add(subjectToken(row))
    } catch (error) {
      logger.warn('Skipping malformed managed credential subject', {
        userId,
        workspaceId,
        providerId: row.providerId,
        error: getErrorMessage(error),
      })
    }
  }
  return sortAccessTokens(new Set([...WORKSPACE_ACCESS_TOKENS, ...subjectTokens]))
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
