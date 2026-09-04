import {
  getWorkspaceOwnerSubscriptionAccess,
  type WorkspaceOwnerSubscriptionAccess,
} from '@/lib/billing/core/workspace-access'
import { isHosted } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'

/**
 * Who is asking. Members mode — creating, switching, syncing, and honouring
 * member tokens — is judged by the workspace alone, because the member engine
 * has no person to speak for and every gate must agree with it. Retrieval
 * defaults pass the signed-in user as well, so the flag's platform-admin
 * clause lets an admin try hybrid retrieval anywhere; an actorless caller
 * (a schedule, a cron, a workspace API key) passes none.
 */
export interface KnowledgeMemberAccessContext {
  workspaceId: string
  userId?: string
  /** The workspace owner's plan, when the caller already holds it. */
  ownerBilling?: WorkspaceOwnerSubscriptionAccess
}

/**
 * What permission-aware knowledge this workspace may use.
 *
 * Two answers rather than one, because the two ways a document can be
 * permission-scoped depend on different things. `admin` mode mirrors a source's
 * own ACLs and touches no Credential Group; `members` mode is built entirely
 * out of them. Collapsing both into one gate would let an operator turning off
 * Credential Groups silently revoke every document an administrator crawl had
 * mirrored, from a feature it does not use.
 *
 * Resolved together so the billing lookup happens once, and returned as a pair
 * so a caller cannot check one and act on the other.
 */
export interface KnowledgeAccessAvailability {
  /** Source-mirrored ACLs: `admin` connectors, and the `u:`/`g:` tokens that read them. */
  sourceMirrored: boolean
  /** Credential-Group enrollments: `members` connectors, and the `s:` tokens that read them. */
  memberScoped: boolean
}

export async function resolveKnowledgeAccessAvailability(
  context: KnowledgeMemberAccessContext
): Promise<KnowledgeAccessAvailability> {
  if (!(await isFeatureEnabled('knowledge-member-access', context))) {
    return { sourceMirrored: false, memberScoped: false }
  }
  const ownerBilling =
    context.ownerBilling ?? (await getWorkspaceOwnerSubscriptionAccess(context.workspaceId))

  /**
   * Both are enterprise features on Sim Cloud. Credential Groups carry that
   * clause already, so mirroring restates it rather than borrowing a gate whose
   * other half is about a feature it does not use.
   */
  const sourceMirrored = !isHosted || ownerBilling.isEnterprise
  return {
    sourceMirrored,
    memberScoped: await isCredentialGroupsAvailable({
      workspaceId: context.workspaceId,
      ownerBilling,
    }),
  }
}

/**
 * Whether members mode is on for this workspace: the `knowledge-member-access`
 * flag, and Credential Groups available to the workspace, which members mode
 * enrolls people through. The members-mode gates — creating and switching
 * connectors, the member engine, the workspace host context the UI reads —
 * check this; the reader's tokens come from `resolveKnowledgeAccessAvailability`
 * directly, which this is the `memberScoped` half of, so they can never
 * disagree. When it turns off, member-scoped documents are hidden on the next
 * read, members-mode connectors wait rather than change anything, and search
 * returns to the semantic-only default; nothing is deleted.
 */
export async function isKnowledgeMemberAccessAvailable(
  context: KnowledgeMemberAccessContext
): Promise<boolean> {
  return (await resolveKnowledgeAccessAvailability(context)).memberScoped
}

/** Refuses with the one message every source-mirroring gate uses when the feature is off. */
export async function requireSourceMirroredAccessAvailable(
  context: KnowledgeMemberAccessContext
): Promise<void> {
  if ((await resolveKnowledgeAccessAvailability(context)).sourceMirrored) return
  throw new OrchestrationError(
    'validation',
    'Administrator access is not available for this workspace'
  )
}

/** Refuses with the one message every members-mode gate uses when the feature is off for the workspace. */
export async function requireKnowledgeMemberAccessAvailable(
  context: KnowledgeMemberAccessContext
): Promise<void> {
  if (await isKnowledgeMemberAccessAvailable(context)) return
  throw new OrchestrationError(
    'validation',
    'Per-member access is not available for this workspace'
  )
}
