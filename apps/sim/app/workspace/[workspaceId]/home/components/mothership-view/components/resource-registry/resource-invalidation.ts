import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { MothershipResourceType } from '@/lib/mothership/resources/types'
import { deploymentKeys, invalidateDeploymentQueries } from '@/hooks/queries/deployments'
import { logKeys } from '@/hooks/queries/logs'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { tableKeys } from '@/hooks/queries/utils/table-keys'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { workspaceFileFolderKeys } from '@/hooks/queries/workspace-file-folders'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

function invalidate(client: QueryClient, key: QueryKey): void {
  void client.invalidateQueries({ queryKey: key })
}

type CacheableResourceType = Exclude<MothershipResourceType, 'generic'>

const RESOURCE_INVALIDATORS: Record<
  CacheableResourceType,
  (qc: QueryClient, workspaceId: string, resourceId?: string) => void
> = {
  table: (qc, _wId, id) => {
    invalidate(qc, tableKeys.lists())
    invalidate(qc, id ? tableKeys.detail(id) : tableKeys.details())
    invalidate(qc, id ? tableKeys.views(id) : tableKeys.viewsRoot())
  },
  file: (qc, wId, id) => {
    invalidate(qc, workspaceFilesKeys.lists())
    invalidate(qc, id ? workspaceFilesKeys.contentFile(wId, id) : workspaceFilesKeys.contents())
    invalidate(qc, workspaceFilesKeys.storageInfo())
  },
  workflow: (qc, wId, id) => {
    void invalidateWorkflowLists(qc, wId)
    invalidate(qc, id ? workflowKeys.state(id) : workflowKeys.states())
    if (id) void invalidateDeploymentQueries(qc, id)
    else invalidate(qc, deploymentKeys.all)
  },
  knowledgebase: (qc, _wId, id) => {
    invalidate(qc, knowledgeKeys.lists())
    invalidate(qc, id ? knowledgeKeys.detail(id) : knowledgeKeys.details())
  },
  folder: (qc) => {
    invalidate(qc, folderKeys.lists())
  },
  filefolder: (qc, wId) => {
    invalidate(qc, workspaceFileFolderKeys.workspaceLists(wId))
    invalidate(qc, workspaceFilesKeys.workspaceLists(wId))
    invalidate(qc, workspaceFilesKeys.storageInfo())
  },
  task: (qc, wId, id) => {
    invalidate(qc, mothershipChatKeys.workspaceLists(wId))
    if (id) invalidate(qc, mothershipChatKeys.detail(id))
  },
  log: (qc, wId, id) => {
    invalidate(qc, [...logKeys.lists(), wId])
    invalidate(qc, [...logKeys.stats(), wId])
    invalidate(qc, [...logKeys.byExecutionAll(), wId])
    invalidate(qc, id ? logKeys.detail(wId, id) : [...logKeys.details(), wId])
  },
  /**
   * Integrations are sourced from the static integration catalog
   * (`listIntegrationsByPopularity()`), not a server-backed query, so there is nothing to
   * invalidate when one is added.
   */
  integration: () => {},
  /**
   * The browser panel hosts the desktop app's natively embedded browser view
   * (in-memory page state, no server-backed query), so there is nothing to
   * invalidate.
   */
  browser: () => {},
  /**
   * The terminal panel is backed by a live PTY in the desktop app, not a
   * server-backed query, so there is nothing to invalidate.
   */
  terminal: () => {},
}

/**
 * Invalidate list and detail queries for a specific resource.
 * Called when a `resource_added` event arrives so the embedded view refreshes
 * and the add-resource dropdown stays up to date.
 */
export function invalidateResourceQueries(
  queryClient: QueryClient,
  workspaceId: string,
  resourceType: MothershipResourceType,
  resourceId?: string
): void {
  if (resourceType === 'generic') return
  RESOURCE_INVALIDATORS[resourceType](queryClient, workspaceId, resourceId)
}
