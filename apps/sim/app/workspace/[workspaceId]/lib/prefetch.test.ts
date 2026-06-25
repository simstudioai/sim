/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrefetchInternalJson } = vi.hoisted(() => ({
  mockPrefetchInternalJson: vi.fn(),
}))

vi.mock('@/app/workspace/[workspaceId]/lib/prefetch-internal-fetch', () => ({
  prefetchInternalJson: mockPrefetchInternalJson,
}))

vi.mock('@/components/emcn', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { prefetchFilesBrowser } from '@/app/workspace/[workspaceId]/files/prefetch'
import { prefetchHomeLists } from '@/app/workspace/[workspaceId]/home/prefetch'
import { prefetchKnowledgeBases } from '@/app/workspace/[workspaceId]/knowledge/prefetch'
import { prefetchTables } from '@/app/workspace/[workspaceId]/tables/prefetch'
import { knowledgeKeys } from '@/hooks/queries/kb/knowledge'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { tableKeys } from '@/hooks/queries/utils/table-keys'
import { workspaceFileFolderKeys } from '@/hooks/queries/workspace-file-folders'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

const WORKSPACE_ID = 'ws-123'

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('workspace list prefetches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('prefetchKnowledgeBases', () => {
    it('primes the exact key useKnowledgeBasesQuery reads and unwraps data', async () => {
      const bases = [{ id: 'kb-1' }]
      mockPrefetchInternalJson.mockResolvedValue({ data: bases })
      const client = makeClient()

      await prefetchKnowledgeBases(client, WORKSPACE_ID)

      expect(mockPrefetchInternalJson).toHaveBeenCalledWith(
        `/api/knowledge?workspaceId=${WORKSPACE_ID}&scope=active`
      )
      expect(client.getQueryData(knowledgeKeys.list(WORKSPACE_ID, 'active'))).toEqual(bases)
    })
  })

  describe('prefetchTables', () => {
    it('primes the exact key useTablesList reads and unwraps data.tables', async () => {
      const tables = [{ id: 't-1' }]
      mockPrefetchInternalJson.mockResolvedValue({ data: { tables } })
      const client = makeClient()

      await prefetchTables(client, WORKSPACE_ID)

      expect(mockPrefetchInternalJson).toHaveBeenCalledWith(
        `/api/table?workspaceId=${WORKSPACE_ID}&scope=active`
      )
      expect(client.getQueryData(tableKeys.list(WORKSPACE_ID, 'active'))).toEqual(tables)
    })
  })

  describe('prefetchFilesBrowser', () => {
    it('primes both file + folder keys the client hooks read', async () => {
      const files = [{ id: 'f-1' }]
      const folders = [{ id: 'folder-1' }]
      mockPrefetchInternalJson.mockImplementation(async (path: string) =>
        path.includes('/folders') ? { folders } : { success: true, files }
      )
      const client = makeClient()

      await prefetchFilesBrowser(client, WORKSPACE_ID)

      expect(mockPrefetchInternalJson).toHaveBeenCalledWith(
        `/api/workspaces/${WORKSPACE_ID}/files?scope=active`
      )
      expect(mockPrefetchInternalJson).toHaveBeenCalledWith(
        `/api/workspaces/${WORKSPACE_ID}/files/folders?scope=active`
      )
      expect(client.getQueryData(workspaceFilesKeys.list(WORKSPACE_ID, 'active'))).toEqual(files)
      expect(client.getQueryData(workspaceFileFolderKeys.list(WORKSPACE_ID, 'active'))).toEqual(
        folders
      )
    })

    it('caches an empty file list when the route reports failure', async () => {
      mockPrefetchInternalJson.mockImplementation(async (path: string) =>
        path.includes('/folders') ? { folders: [] } : { success: false, files: [] }
      )
      const client = makeClient()

      await prefetchFilesBrowser(client, WORKSPACE_ID)

      expect(client.getQueryData(workspaceFilesKeys.list(WORKSPACE_ID, 'active'))).toEqual([])
    })
  })

  describe('prefetchHomeLists', () => {
    it('primes folder + file keys, mapping folder rows to the client shape', async () => {
      const folderRow = {
        id: 'folder-1',
        name: 'Docs',
        userId: 'u-1',
        workspaceId: WORKSPACE_ID,
        parentId: null,
        color: null,
        isExpanded: true,
        locked: false,
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        archivedAt: null,
      }
      const files = [{ id: 'f-1' }]
      mockPrefetchInternalJson.mockImplementation(async (path: string) =>
        path.startsWith('/api/folders') ? { folders: [folderRow] } : { success: true, files }
      )
      const client = makeClient()

      await prefetchHomeLists(client, WORKSPACE_ID)

      expect(mockPrefetchInternalJson).toHaveBeenCalledWith(
        `/api/folders?workspaceId=${WORKSPACE_ID}&scope=active`
      )
      const cachedFolders = client.getQueryData(folderKeys.list(WORKSPACE_ID, 'active')) as Array<{
        id: string
        color: string
        createdAt: Date
      }>
      expect(cachedFolders).toHaveLength(1)
      expect(cachedFolders[0].color).toBe('#6B7280')
      expect(cachedFolders[0].createdAt).toBeInstanceOf(Date)
      expect(client.getQueryData(workspaceFilesKeys.list(WORKSPACE_ID, 'active'))).toEqual(files)
    })
  })

  describe('graceful failure', () => {
    it.each([
      [
        'prefetchKnowledgeBases',
        prefetchKnowledgeBases,
        knowledgeKeys.list(WORKSPACE_ID, 'active'),
      ],
      ['prefetchTables', prefetchTables, tableKeys.list(WORKSPACE_ID, 'active')],
      ['prefetchHomeLists', prefetchHomeLists, folderKeys.list(WORKSPACE_ID, 'active')],
      [
        'prefetchFilesBrowser',
        prefetchFilesBrowser,
        workspaceFilesKeys.list(WORKSPACE_ID, 'active'),
      ],
    ] as const)(
      '%s does not throw when the fetcher rejects (page still renders, client refetches)',
      async (_name, prefetch, queryKey) => {
        mockPrefetchInternalJson.mockRejectedValue(new Error('500'))
        const client = makeClient()

        await expect(prefetch(client, WORKSPACE_ID)).resolves.toBeUndefined()
        expect(client.getQueryData(queryKey)).toBeUndefined()
      }
    )
  })
})
