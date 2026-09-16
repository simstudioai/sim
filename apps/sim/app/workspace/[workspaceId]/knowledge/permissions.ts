import type { KnowledgeBaseData } from '@/lib/knowledge/types'
import type { WorkspaceUserPermissions } from '@/hooks/use-user-permissions'

/** The workspace Search index requires an administrator even when other knowledge bases are editable. */
export function canDeleteKnowledgeBase(
  knowledgeBase: Pick<KnowledgeBaseData, 'isSearchIndex'> | null | undefined,
  permissions: Pick<WorkspaceUserPermissions, 'canEdit' | 'canAdmin'>
): boolean {
  return Boolean(
    knowledgeBase && permissions.canEdit && (!knowledgeBase.isSearchIndex || permissions.canAdmin)
  )
}
