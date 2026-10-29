/**
 * @vitest-environment node
 */
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  findCachedWorkspaceFile,
  indexCachedWorkspaceFiles,
  invalidateWorkspaceFileReads,
  isWorkspaceFileRecordKey,
  snapshotWorkspaceFileReads,
  updateCachedWorkspaceFile,
} from '@/hooks/queries/utils/workspace-file-cache'
import {
  type WorkspaceFileListPage,
  workspaceFileListParams,
  workspaceFilesKeys,
} from '@/hooks/queries/utils/workspace-file-keys'

function file(id: string, overrides: Partial<WorkspaceFileRecord> = {}): WorkspaceFileRecord {
  return {
    id,
    workspaceId: 'ws-1',
    name: `${id}.md`,
    key: `workspace/ws-1/${id}.md`,
    path: `/api/files/serve/${id}`,
    size: 1,
    type: 'text/markdown',
    uploadedBy: 'user-1',
    folderId: null,
    uploadedAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  } as WorkspaceFileRecord
}

const pages = (...files: WorkspaceFileRecord[][]) => ({
  pages: files.map(
    (page, index): WorkspaceFileListPage => ({
      files: page,
      nextCursor: index < files.length - 1 ? `c${index + 1}` : null,
    })
  ),
  pageParams: files.map((_, index) => (index === 0 ? null : `c${index}`)),
})

const liveKey = workspaceFilesKeys.list(
  'ws-1',
  workspaceFileListParams({ folderId: null, sortBy: 'name', sortOrder: 'asc' })
)
const archivedKey = workspaceFilesKeys.list(
  'ws-1',
  workspaceFileListParams({ scope: 'archived', folderId: null, sortBy: 'name', sortOrder: 'asc' })
)

const listIds = (client: QueryClient, key: readonly unknown[]) =>
  client
    .getQueryData<ReturnType<typeof pages>>(key)
    ?.pages.flatMap((page) => page.files.map((entry) => entry.id))

describe('invalidateWorkspaceFileReads', () => {
  it('cuts an unobserved list to its first page but leaves a mounted one whole', async () => {
    const client = new QueryClient()
    const mountedKey = workspaceFilesKeys.list(
      'ws-1',
      workspaceFileListParams({ folderId: null, sortBy: 'size', sortOrder: 'asc' })
    )
    client.setQueryData(liveKey, pages([file('a')], [file('b')]))
    client.setQueryData(mountedKey, pages([file('a')], [file('b')]))
    const observer = new QueryObserver(client, { queryKey: mountedKey, enabled: false })
    const unsubscribe = observer.subscribe(() => {})
    const before = client.getQueryState(liveKey)?.dataUpdatedAt

    await invalidateWorkspaceFileReads(client, 'ws-1')

    expect(listIds(client, liveKey)).toEqual(['a'])
    expect(client.getQueryState(liveKey)?.dataUpdatedAt).toBe(before)
    expect(client.getQueryState(liveKey)?.isInvalidated).toBe(true)
    expect(listIds(client, mountedKey)).toEqual(['a', 'b'])
    unsubscribe()
  })

  it('invalidates folder sizes with the rest of the workspace metadata, and no other workspace', async () => {
    const client = new QueryClient()
    const stats = workspaceFilesKeys.folderStat('ws-1', ['root'])
    const other = workspaceFilesKeys.folderStat('ws-2', ['root'])
    client.setQueryData(stats, new Map())
    client.setQueryData(other, new Map())
    await invalidateWorkspaceFileReads(client, 'ws-1')
    expect(client.getQueryState(stats)?.isInvalidated).toBe(true)
    expect(client.getQueryState(other)?.isInvalidated).toBe(false)
  })
})

describe('updateCachedWorkspaceFile', () => {
  it('drops a deleted file from live reads only: an archived list is where it now belongs', () => {
    const client = new QueryClient()
    client.setQueryData(liveKey, pages([file('a'), file('b')]))
    client.setQueryData(archivedKey, pages([file('a', { deletedAt: new Date() })]))
    const snapshot = snapshotWorkspaceFileReads(client, 'ws-1', ['list'])

    updateCachedWorkspaceFile(client, 'ws-1', 'a', () => null, ['list'])

    expect(listIds(client, liveKey)).toEqual(['b'])
    expect(listIds(client, archivedKey)).toEqual(['a'])
    expect(snapshot.map(([key]) => key)).toEqual([liveKey])
  })

  it('patches only the reads named, so a rename leaves lists and name references to refetch', () => {
    const client = new QueryClient()
    const byId = workspaceFilesKeys.lookup('ws-1', 'id', 'a')
    const byName = workspaceFilesKeys.lookup('ws-1', 'reference', 'a.md')
    client.setQueryData(liveKey, pages([file('a')]))
    client.setQueryData(byId, file('a'))
    client.setQueryData(byName, file('a'))
    client.setQueryData(workspaceFilesKeys.record('ws-1', 'a'), file('a'))

    updateCachedWorkspaceFile(client, 'ws-1', 'a', (entry) => ({ ...entry, name: 'z.md' }), [
      'identityLookup',
      'record',
    ])

    const name = (key: readonly unknown[]) => client.getQueryData<WorkspaceFileRecord>(key)?.name
    expect(name(byId)).toBe('z.md')
    expect(name(workspaceFilesKeys.record('ws-1', 'a'))).toBe('z.md')
    expect(name(byName)).toBe('a.md')
    expect(client.getQueryData<ReturnType<typeof pages>>(liveKey)?.pages[0].files[0].name).toBe(
      'a.md'
    )
  })
})

describe('cached file seeds', () => {
  it('finds the freshest copy across reads, by one scan for a batch', () => {
    const client = new QueryClient()
    client.setQueryData(liveKey, pages([file('a', { name: 'old.md' })]), { updatedAt: 1 })
    client.setQueryData(workspaceFilesKeys.record('ws-1', 'a'), file('a', { name: 'new.md' }), {
      updatedAt: 2,
    })
    client.setQueryData(archivedKey, pages([file('gone')]), { updatedAt: 3 })

    const index = indexCachedWorkspaceFiles(client, 'ws-1', 'id')
    expect(index.get('a')).toEqual({
      file: expect.objectContaining({ name: 'new.md' }),
      updatedAt: 2,
    })
    expect(index.has('gone')).toBe(false)
    expect(findCachedWorkspaceFile(client, 'ws-1', (entry) => entry.id === 'a')).toEqual(
      index.get('a')
    )
  })

  it('names file-holding reads of any workspace when no workspace is given', () => {
    expect(isWorkspaceFileRecordKey(workspaceFilesKeys.record('ws-9', 'a'))).toBe(true)
    expect(isWorkspaceFileRecordKey(workspaceFilesKeys.record('ws-9', 'a'), 'ws-1')).toBe(false)
    expect(isWorkspaceFileRecordKey(workspaceFilesKeys.folderStat('ws-9', ['root']))).toBe(false)
  })
})
