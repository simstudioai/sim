import { createLogger } from '@sim/logger'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createTrustedCopilotPrincipal,
} from '@/lib/copilot/auth/application-delegation'
import { createCopilotChatFilePrincipal } from '@/lib/copilot/auth/file-delegation'
import { buildVfsFolderPathMap, encodeVfsPathSegments } from '@/lib/copilot/vfs/path-utils'
import { knowledgeDelegationPolicy } from '@/lib/knowledge/application/authorization'
import { listKnowledgeFolders } from '@/lib/knowledge/application/folders'
import { tableDelegationPolicy } from '@/lib/table/application/authorization'
import { listTableFoldersUseCase } from '@/lib/table/application/folders'
import { workflowDelegationPolicy } from '@/lib/workflows/application/authorization'
import { listWorkflowFolders } from '@/lib/workflows/application/workflow-folders'
import { resolveWorkspaceFileFolderPathOperation } from '@/lib/workspace-files/application/workspace-file-folders'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

const logger = createLogger('ChatFolderContext')

const FOLDER_DOMAINS = {
  workflow: { root: 'workflows', policy: workflowDelegationPolicy },
  table: { root: 'tables', policy: tableDelegationPolicy },
  knowledge_base: { root: 'knowledgebases', policy: knowledgeDelegationPolicy },
} as const

type FolderDomain = keyof typeof FOLDER_DOMAINS

/**
 * Resolves chat folder IDs through each domain's authorized, active-folder query.
 * The cache belongs to one request: repeated mentions share reads, but later turns
 * recheck access and pick up moves, renames, and deletions. Generic folder chips
 * retain their stable ID across clipboard and persisted-chat round trips.
 */
export function createChatFolderResolver(userId: string, workspaceId: string, chatId?: string) {
  const paths = new Map<FolderDomain, Promise<Map<string, string>>>()
  const filePaths = new Map<string, Promise<string | null>>()

  async function loadPaths(domain: FolderDomain): Promise<Map<string, string>> {
    const principal = createTrustedCopilotPrincipal(
      { userId, workspaceId, chatId, delegationId: `copilot-chat:${chatId ?? workspaceId}` },
      {
        audience: FOLDER_DOMAINS[domain].policy.audience,
        ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
      }
    )
    const input = { workspaceId, sortBy: 'name', sortOrder: 'asc' } as const
    const { folders } = await (() => {
      switch (domain) {
        case 'workflow':
          return listWorkflowFolders.execute({ principal, input })
        case 'table':
          return listTableFoldersUseCase.execute({ principal, input })
        case 'knowledge_base':
          return listKnowledgeFolders.execute({ principal, input })
      }
    })()
    return buildVfsFolderPathMap(
      folders.map((folder) => ({
        folderId: folder.id,
        folderName: folder.name,
        parentId: folder.parentId,
      }))
    )
  }

  async function folderPath(folderId: string, domain: FolderDomain): Promise<string | null> {
    let pending = paths.get(domain)
    if (!pending) {
      pending = loadPaths(domain)
      paths.set(domain, pending)
    }
    return (await pending).get(folderId) ?? null
  }

  async function folderPointer(folderId: string, fileFolder = false): Promise<string | null> {
    if (fileFolder) {
      let pending = filePaths.get(folderId)
      if (!pending) {
        pending = resolveWorkspaceFileFolderPathOperation
          .execute({
            principal: createCopilotChatFilePrincipal({ userId, workspaceId, chatId }),
            input: { workspaceId, folderId },
          })
          .then(({ path }) =>
            path
              ? `files/${encodeVfsPathSegments(parseWorkspaceFileFolderDisplayPath(path))}`
              : null
          )
          .catch((error) => {
            logger.warn('Could not resolve chat file folder', { workspaceId, folderId, error })
            return null
          })
        filePaths.set(folderId, pending)
      }
      return pending
    }
    const domains: FolderDomain[] = ['workflow', 'table', 'knowledge_base']
    const results = await Promise.allSettled(
      domains.map(async (domain) => {
        const path = await folderPath(folderId, domain)
        return path ? `${FOLDER_DOMAINS[domain].root}/${path}` : null
      })
    )
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        logger.warn('Could not resolve chat folder domain', {
          domain: domains[index],
          workspaceId,
          error: result.reason,
        })
      }
    }
    return (
      results.find(
        (result): result is PromiseFulfilledResult<string> =>
          result.status === 'fulfilled' && typeof result.value === 'string'
      )?.value ?? null
    )
  }

  return { folderPath, folderPointer }
}

export type ChatFolderResolver = ReturnType<typeof createChatFolderResolver>
