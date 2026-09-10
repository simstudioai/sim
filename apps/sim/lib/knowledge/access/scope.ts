import { type Principal, resolvePrincipalSubject } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  document,
  foldedEmail,
  knowledgeBase,
  knowledgeExternalGroup,
  knowledgeExternalGroupMember,
  member,
  user,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { LIVE_ENROLLMENT_STATUSES } from '@/lib/credential-groups/credentials'
import { resolveKnowledgeAccessAvailability } from '@/lib/knowledge/access/availability'
import {
  type ConfluenceReaderCredential,
  resolveConfluenceSiteReadGrants,
} from '@/lib/knowledge/access/confluence-site'
import {
  domainMemberWildcard,
  EXTERNAL_GROUP_STALE_AFTER_MS,
  emailDomain,
} from '@/lib/knowledge/access/external-groups'
import {
  type GitHubReaderCredential,
  resolveGitHubInstallationReadGrants,
} from '@/lib/knowledge/access/github-installation'
import { knowledgeMetadataCandidateAccessCondition } from '@/lib/knowledge/access/predicate'
import {
  groupToken,
  sortAccessTokens,
  subjectToken,
  userToken,
} from '@/lib/knowledge/access/tokens'
import {
  type KnowledgeAccessProvider,
  type KnowledgeAccessScope,
  MAX_KNOWLEDGE_ACCESS_CANDIDATES,
  ORGANIZATION_ACCESS_TOKENS,
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
 * Whether some other account folds to this one's address.
 *
 * `user.email` is unique byte-for-byte only, and a small number of historical
 * accounts collide once folded. Until those are merged and the index promoted
 * to UNIQUE, this check is what keeps either account from reading the other's
 * documents — and it stays afterwards, so access control never quietly depends
 * on a constraint still being there. One probe of `user_email_lower_idx` per
 * read; it plans as an index scan, not a table scan.
 */
const emailHeldByAnotherAccount = sql<boolean>`EXISTS (
  SELECT 1 FROM ${user} AS other
  WHERE other.id <> ${user.id}
    AND lower(btrim(other.email)) = ${foldedEmail(user.email)}
)`

/**
 * The `g:` tokens a person holds in the resource owner, from the external directory
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
async function loadExternalGroupTokens(
  memberTokens: readonly string[],
  scope: ResourceScope
): Promise<string[]> {
  /**
   * A query of its own rather than a fourth join on the credential query in
   * `loadUserAccess`:
   * that one already fans out per managed credential, and joining groups onto
   * it would multiply the two — every credential row repeated for every group.
   * Two indexed reads cost less than one cross product.
   */
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
        inArray(knowledgeExternalGroupMember.subjectToken, [...memberTokens]),
        resourceScopeCondition(knowledgeExternalGroup, scope),
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
  /** Exactly one workspace or organization owner is required at resolution. */
  workspaceId?: string
  organizationId?: string
  /** Canonical bases already selected by the application resolver, never caller assertions. */
  knowledgeBaseIds?: readonly string[]
  signal?: AbortSignal
}

/**
 * The tokens a person holds in the resource owner: its baseline pair, one `s:` token
 * per active managed credential bound to them through a credential-group
 * enrollment, their own `u:` address, and a `g:` token per directory group it
 * belongs to. The person must be email-verified — every binding here is by
 * email, and an unverified address must not inherit grants made to whoever
 * really owns it. Nothing here is cached: revoking a credential or leaving a
 * group is visible on the next read.
 */
async function loadUserAccess(
  userId: string,
  context: KnowledgeAccessScopeContext
): Promise<{
  tokens: readonly string[]
  githubReaders?: GitHubReaderCredential[]
  confluenceReaders?: ConfluenceReaderCredential[]
}> {
  const { workspaceId, organizationId } = context
  const scope = resourceScopeFromOwner(context)
  const baseline = organizationId ? ORGANIZATION_ACCESS_TOKENS : WORKSPACE_ACCESS_TOKENS

  /**
   * Member tokens belong to current members of the resource owner. Resolved before any
   * document is looked up, so someone who left but still holds
   * a managed credential cannot learn which documents their old tokens match.
   */
  if (scope.kind === 'organization') {
    const [membership] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, scope.organizationId), eq(member.userId, userId)))
      .limit(1)
    if (!membership) return { tokens: [] }
  } else {
    const workspaceAccess = await checkWorkspaceAccess(scope.workspaceId, userId)
    if (!workspaceAccess.hasAccess) return { tokens: [] }
  }
  /**
   * An identity token only counts where permission-aware knowledge is on, so
   * turning the feature off hides every permission-scoped document at once — on
   * the next read, before any run has suspended anyone — rather than leaving
   * people reading them until a run happens to land. Read first, so a workspace
   * without the feature never pays for the joins below.
   */
  const availability = await resolveKnowledgeAccessAvailability(context)
  if (!availability.memberScoped && !availability.sourceMirrored) {
    return { tokens: [...baseline] }
  }

  const rows = await db
    .select({
      emailIsAmbiguous: emailHeldByAnotherAccount,
      email: foldedEmail(user.email),
      credentialId: credential.id,
      providerId: credential.providerId,
      providerTenantId: credential.providerTenantId,
      providerSubjectId: credential.providerSubjectId,
    })
    .from(user)
    .leftJoin(
      credentialGroup,
      and(resourceScopeCondition(credentialGroup, scope), eq(credentialGroup.status, 'active'))
    )
    .leftJoin(
      credentialGroupEnrollment,
      and(
        eq(credentialGroupEnrollment.credentialGroupId, credentialGroup.id),
        scope.kind === 'organization'
          ? eq(credentialGroupEnrollment.userId, user.id)
          : eq(credentialGroupEnrollment.email, foldedEmail(user.email)),
        inArray(credentialGroupEnrollment.status, [...LIVE_ENROLLMENT_STATUSES])
      )
    )
    .leftJoin(
      credential,
      and(
        eq(credential.credentialGroupEnrollmentId, credentialGroupEnrollment.id),
        resourceScopeCondition(credential, scope),
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
    return { tokens: [...baseline] }
  }

  const identityTokens = new Set<string>()
  const githubReaders: GitHubReaderCredential[] = []
  const confluenceReaders: ConfluenceReaderCredential[] = []
  for (const row of rows) {
    if (!availability.memberScoped || !row.providerSubjectId) continue
    try {
      const token = subjectToken(row)
      identityTokens.add(token)
      if (row.providerId === 'github-repositories' && row.credentialId)
        githubReaders.push({ credentialId: row.credentialId, subjectToken: token })
      if (row.providerId === 'confluence' && row.credentialId)
        confluenceReaders.push({ credentialId: row.credentialId, subjectToken: token })
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
  if (availability.sourceMirrored) {
    const email = rows[0]?.email
    const own = userToken(email)
    if (own) identityTokens.add(own)
    const groupMemberTokens = [...identityTokens]
    if (own && email) groupMemberTokens.push(domainMemberWildcard(emailDomain(email)))
    if (groupMemberTokens.length > 0) {
      for (const token of await loadExternalGroupTokens(groupMemberTokens, scope)) {
        identityTokens.add(token)
      }
    }
  }

  return {
    tokens: sortAccessTokens(new Set([...baseline, ...identityTokens])),
    githubReaders,
    confluenceReaders,
  }
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
  return (await resolveKnowledgeIdentity(principal, context)).access
}

async function resolveKnowledgeIdentity(
  principal: Principal,
  context: KnowledgeAccessScopeContext
): Promise<{
  access: KnowledgeAccessScope
  githubReaders: readonly GitHubReaderCredential[]
  confluenceReaders: readonly ConfluenceReaderCredential[]
}> {
  if (principal.kind === 'credential_group_enrollment') {
    throw new OrchestrationError(
      'forbidden',
      'Credential Group enrollments cannot read knowledge documents'
    )
  }
  resourceScopeFromOwner(context)
  const subject = resolvePrincipalSubject(principal)
  if (subject?.kind !== 'sim_user') {
    if (context.organizationId)
      throw new OrchestrationError('forbidden', 'Organization search requires a user subject')
    return { access: WORKSPACE_ACCESS_SCOPE, githubReaders: [], confluenceReaders: [] }
  }
  return resolveUserKnowledgeIdentity(subject.userId, context)
}

async function resolveUserKnowledgeIdentity(userId: string, context: KnowledgeAccessScopeContext) {
  resourceScopeFromOwner(context)
  const {
    tokens,
    githubReaders = [],
    confluenceReaders = [],
  } = await loadUserAccess(userId, context)
  return {
    access: { kind: 'user' as const, userId, tokens },
    githubReaders,
    confluenceReaders,
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
  return { kind: 'user', userId, tokens: (await loadUserAccess(userId, { workspaceId })).tokens }
}

/** Memoises {@link resolveKnowledgeAccessScope} for one operation; a failed lookup is retried on the next call. */
export function createKnowledgeAccessProvider(
  principal: Principal,
  context: KnowledgeAccessScopeContext
): KnowledgeAccessProvider {
  return createAccessProvider(() => resolveKnowledgeIdentity(principal, context), context)
}

/** Candidate access for a user already authenticated by a session or personal-key adapter. */
export function createUserKnowledgeAccessProvider(
  userId: string,
  context: KnowledgeAccessScopeContext
): KnowledgeAccessProvider {
  return createAccessProvider(() => resolveUserKnowledgeIdentity(userId, context), context)
}

function createAccessProvider(
  resolveIdentity: () => ReturnType<typeof resolveKnowledgeIdentity>,
  context: KnowledgeAccessScopeContext
): KnowledgeAccessProvider {
  let pending: ReturnType<typeof resolveKnowledgeIdentity> | undefined
  const identity = () => {
    pending ??= resolveIdentity().catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
  const boundedIds = (ids: readonly string[]) => {
    if (ids.length > MAX_KNOWLEDGE_ACCESS_CANDIDATES)
      throw new Error('Knowledge access candidates must be authorized in bounded pages')
    return [...new Set(ids)]
  }
  const provider: KnowledgeAccessProvider = {
    async get() {
      return (await identity()).access
    },
    async getForConnectors(connectorIds, signal) {
      const ids = boundedIds(connectorIds)
      const cancellation =
        context.signal && signal
          ? AbortSignal.any([context.signal, signal])
          : (signal ?? context.signal)
      cancellation?.throwIfAborted()
      const { access, githubReaders, confluenceReaders } = await identity()
      cancellation?.throwIfAborted()
      if (
        access.kind !== 'user' ||
        (!githubReaders.length && !confluenceReaders.length) ||
        !ids.length
      )
        return access
      const input = {
        scope: resourceScopeFromOwner(context),
        knowledgeBaseIds: context.knowledgeBaseIds,
        connectorIds: ids,
        signal: cancellation,
      }
      const [githubInstallationGrants, confluenceSiteGrants] = await Promise.all([
        githubReaders.length
          ? resolveGitHubInstallationReadGrants({ ...input, readers: githubReaders })
          : Promise.resolve([]),
        confluenceReaders.length
          ? resolveConfluenceSiteReadGrants({ ...input, readers: confluenceReaders })
          : Promise.resolve([]),
      ])
      return { ...access, githubInstallationGrants, confluenceSiteGrants }
    },
    async getForDocuments(documentIds, signal) {
      const ids = boundedIds(documentIds)
      signal?.throwIfAborted()
      context.signal?.throwIfAborted()
      const { access, githubReaders, confluenceReaders } = await identity()
      if (
        access.kind !== 'user' ||
        (!githubReaders.length && !confluenceReaders.length) ||
        !ids.length
      )
        return access
      const candidates = await db
        .select({ connectorId: document.connectorId })
        .from(document)
        .innerJoin(knowledgeBase, eq(knowledgeBase.id, document.knowledgeBaseId))
        .where(
          and(
            inArray(document.id, ids),
            resourceScopeCondition(knowledgeBase, resourceScopeFromOwner(context)),
            context.knowledgeBaseIds
              ? inArray(knowledgeBase.id, [...context.knowledgeBaseIds])
              : undefined,
            isNull(knowledgeBase.deletedAt),
            knowledgeMetadataCandidateAccessCondition(access)
          )
        )
        .limit(MAX_KNOWLEDGE_ACCESS_CANDIDATES)
      return provider.getForConnectors(
        candidates.flatMap((candidate) => (candidate.connectorId ? [candidate.connectorId] : [])),
        signal
      )
    },
  }
  return provider
}
