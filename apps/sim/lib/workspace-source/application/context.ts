/**
 * The per-request context every kind reads and writes through: who acts, in which workspace, and
 * the state one request shares across kinds (its hashing budget, the admissions it already
 * checked, the listings it already made).
 */
import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { newHashBudget } from '@/lib/workspace-source/application/hash-budget'
import type { SourceContext } from '@/lib/workspace-source/application/types'
import type { ActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

/**
 * A get's or an apply's context, with a fresh hashing budget, no admissions checked yet and
 * nothing loaded or listed to share.
 */
export function sourceContext(
  principal: Principal,
  workspace: ActiveWorkspaceApplicationContext
): SourceContext {
  return {
    principal,
    workspace,
    createdBy: resolvePrincipalSubjectUserId(principal) ?? null,
    hashBudget: newHashBudget(),
    admitted: new Map(),
    loads: {},
    listings: {},
  }
}

/**
 * Runs a workspace-wide admission once per request: every change that needs the same one (each
 * workspace file a plan creates) shares its outcome, a refusal included.
 */
export function admitOnce(ctx: SourceContext, key: string, admit: () => Promise<unknown>) {
  let admission = ctx.admitted.get(key)
  if (!admission) {
    admission = admit()
    ctx.admitted.set(key, admission)
  }
  return admission
}
