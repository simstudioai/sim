import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { requireCurrentHumanRole } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { KnowledgeWorkspaceContext } from '@/lib/knowledge/application/contexts'

/** The shared search index may be deleted only by a current workspace administrator. */
export async function authorizeSearchIndexDeletion(
  principal: Principal,
  context: KnowledgeWorkspaceContext,
  knowledgeBase: { isSearchIndex?: boolean }
): Promise<boolean> {
  if (!knowledgeBase.isSearchIndex) return false
  const userId = resolvePrincipalSubjectUserId(principal)
  if (!userId) {
    throw new OrchestrationError('forbidden', 'Only workspace admins can delete the search index')
  }
  await requireCurrentHumanRole(userId, context, 'admin')
  return true
}
