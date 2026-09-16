import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import {
  getWorkspaceOwnerSubscriptionAccess,
  type WorkspaceOwnerSubscriptionAccess,
} from '@/lib/billing/core/workspace-access'
import { isHosted } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'

/**
 * Who is asking. Members mode — creating, switching, syncing, and honouring
 * member tokens — is judged by the resource owner alone, because the member engine
 * has no person to speak for and every gate must agree with it. Retrieval
 * defaults for workspaces pass the signed-in user as well, so the flag's platform-admin
 * clause lets an admin try hybrid retrieval anywhere; an actorless caller
 * (a schedule, a cron, a workspace API key) passes none. Organization access
 * always uses the target organization alone, including retrieval.
 */
export interface KnowledgeMemberAccessContext {
  workspaceId?: string
  organizationId?: string
  userId?: string
  /** The workspace owner's plan, when the caller already holds it. */
  ownerBilling?: WorkspaceOwnerSubscriptionAccess
}

/**
 * Source mirroring and managed identities have independent gates. Mirrored
 * email and domain grants work without Connected accounts. Provider-subject
 * grants, including Confluence directory memberships with hidden emails,
 * also require managed identities to remain available.
 */
export interface KnowledgeAccessAvailability {
  /** Mirroring source ACLs and resolving their verified email and directory-group grants. */
  sourceMirrored: boolean
  /** Managed identities used by member sync and by subject-based source ACLs and groups. */
  memberScoped: boolean
}

export async function resolveKnowledgeAccessAvailability(
  context: KnowledgeMemberAccessContext
): Promise<KnowledgeAccessAvailability> {
  if (context.organizationId && context.workspaceId)
    throw new Error('Knowledge access requires one resource owner')
  if (
    !(await isFeatureEnabled(
      'knowledge-member-access',
      context.organizationId
        ? { orgId: context.organizationId }
        : { workspaceId: context.workspaceId, userId: context.userId }
    ))
  ) {
    return { sourceMirrored: false, memberScoped: false }
  }
  if (context.organizationId) {
    return {
      sourceMirrored:
        !isHosted || (await isOrganizationOnEnterprisePlan(context.organizationId, 'throw')),
      memberScoped: await isScopedCredentialGroupsAvailable({
        kind: 'organization',
        organizationId: context.organizationId,
      }),
    }
  }
  if (!context.workspaceId) throw new Error('Knowledge access requires a resource owner')
  const ownerBilling =
    context.ownerBilling ?? (await getWorkspaceOwnerSubscriptionAccess(context.workspaceId))

  /** Mirroring remains independent of the additional managed-identity feature gate. */
  const sourceMirrored = !isHosted || ownerBilling.isEnterprise
  return {
    sourceMirrored,
    memberScoped: await isCredentialGroupsAvailable({
      organizationId: ownerBilling.organizationId,
      ownerBilling,
    }),
  }
}

/**
 * Whether members mode is on for this resource owner: the `knowledge-member-access`
 * flag, and Credential Groups available to that owner, which members mode
 * enrolls people through. The members-mode gates — creating and switching
 * connectors, the member engine, the host context the UI reads —
 * check this; the reader's tokens come from `resolveKnowledgeAccessAvailability`
 * directly, which this is the `memberScoped` half of, so they can never
 * disagree. When it turns off, member-scoped documents are hidden on the next
 * read and members-mode connectors wait rather than change anything. Organization
 * Search is blocked; workspace search returns to the semantic-only default.
 * Nothing is deleted.
 */
export async function isKnowledgeMemberAccessAvailable(
  context: KnowledgeMemberAccessContext
): Promise<boolean> {
  return (await resolveKnowledgeAccessAvailability(context)).memberScoped
}

/** Organization Search is available only when both owner-scoped rollout gates are enabled. */
export async function requireOrganizationSearchAvailable(organizationId: string): Promise<void> {
  if (await isKnowledgeMemberAccessAvailable({ organizationId })) return
  throw new OrchestrationError('forbidden', 'Search is not enabled for this organization')
}

/** Refuses with the one message every source-mirroring gate uses when the feature is off. */
export async function requireSourceMirroredAccessAvailable(
  context: KnowledgeMemberAccessContext
): Promise<void> {
  if ((await resolveKnowledgeAccessAvailability(context)).sourceMirrored) return
  throw new OrchestrationError(
    'validation',
    `Administrator access is not available for this ${context.organizationId ? 'organization' : 'workspace'}`
  )
}

/** Refuses with the one message every members-mode gate uses when the feature is off for the resource owner. */
export async function requireKnowledgeMemberAccessAvailable(
  context: KnowledgeMemberAccessContext
): Promise<void> {
  if (await isKnowledgeMemberAccessAvailable(context)) return
  throw new OrchestrationError(
    'validation',
    `Per-member access is not available for this ${context.organizationId ? 'organization' : 'workspace'}`
  )
}
