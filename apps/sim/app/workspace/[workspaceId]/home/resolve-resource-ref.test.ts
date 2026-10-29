import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import {
  lookupWorkspaceFilesContract,
  searchWorkspaceFilesContract,
} from '@/lib/api/contracts/workspace-files'
import type { WorkspaceResourceRef } from '@/lib/mothership/resources/types'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  fetchWorkspaceResourceRef,
  resolveWorkspaceResourceRef,
} from '@/app/workspace/[workspaceId]/home/resolve-resource-ref'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

function file(overrides: Partial<WorkspaceFileRecord> & { id: string; name: string }) {
  return {
    workspaceId: 'ws-1',
    key: `k/${overrides.id}`,
    path: `/api/files/serve/${overrides.id}`,
    size: 1,
    type: 'text/plain',
    uploadedBy: 'user-1',
    uploadedAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as WorkspaceFileRecord
}

function ref(overrides: Partial<WorkspaceResourceRef> = {}): WorkspaceResourceRef {
  return { type: 'file', title: 'notes.md', ...overrides }
}

describe('resolveWorkspaceResourceRef', () => {
  it('refuses an id no file answers to, rather than opening a tab pointing at nothing', () => {
    expect(resolveWorkspaceResourceRef(ref({ id: 'wf_gone' }), [])).toBeNull()
  })

  it('refuses an ambiguous title rather than opening the wrong file', () => {
    const files = [
      file({ id: 'wf_a', name: 'notes.md', folderPath: 'a' }),
      file({ id: 'wf_b', name: 'notes.md', folderPath: 'b' }),
    ]
    expect(resolveWorkspaceResourceRef(ref(), files)).toBeNull()
  })

  it('refuses a file it cannot identify, instead of inventing an empty id', () => {
    expect(resolveWorkspaceResourceRef(ref(), [])).toBeNull()
    expect(resolveWorkspaceResourceRef(ref({ path: 'files/gone.md' }), [])).toBeNull()
  })

  it('only ever returns resources that can be addressed', () => {
    const cases: WorkspaceResourceRef[] = [
      ref(),
      ref({ id: '' }),
      ref({ path: '' }),
      ref({ title: '' }),
      ref({ type: 'workflow', title: '' }),
    ]
    for (const candidate of cases) {
      const resolved = resolveWorkspaceResourceRef(candidate, [])
      expect(resolved === null || resolved.id.trim().length > 0).toBe(true)
    }
  })
})

describe('fetchWorkspaceResourceRef', () => {
  /**
   * A workspace answering lookups and name searches over `files` the way the server does: a
   * reference resolves by id, then canonical path, then the first file with that name.
   */
  function serveWorkspace(files: WorkspaceFileRecord[]) {
    apiClientRequestMockFns.mockRequestJson.mockImplementation(async (contract, input) => {
      if (contract === searchWorkspaceFilesContract) {
        const { q } = (input as { query: { q: string } }).query
        return { success: true, files: files.filter((entry) => entry.name.includes(q)) }
      }
      if (contract !== lookupWorkspaceFilesContract) throw new Error('unexpected request')
      const body = (input as { body: { ids?: string[]; references?: string[] } }).body
      const references = (body.references ?? []).map((reference) => ({
        reference,
        fileId:
          files.find((entry) => entry.id === reference || entry.name === reference)?.id ?? null,
      }))
      return {
        success: true,
        files: files.filter(
          (entry) =>
            body.ids?.includes(entry.id) ||
            references.some((resolved) => resolved.fileId === entry.id)
        ),
        references,
      }
    })
  }

  it('still refuses a name two files share, though the server lookup picks one of them', async () => {
    serveWorkspace([
      file({ id: 'wf_a', name: 'notes.md', folderPath: 'a' }),
      file({ id: 'wf_b', name: 'notes.md', folderPath: 'b' }),
    ])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await expect(fetchWorkspaceResourceRef(client, 'ws-1', ref())).resolves.toBeNull()
    await expect(
      fetchWorkspaceResourceRef(client, 'ws-1', ref({ id: 'wf_b' }))
    ).resolves.toMatchObject({ type: 'file', id: 'wf_b', path: 'files/b/notes.md' })
  })

  it('still refuses a name two files share when it is longer than a search query may be', async () => {
    const long = `${'quarterly report '.repeat(15)}final.md`
    serveWorkspace([
      file({ id: 'wf_a', name: long, folderPath: 'a' }),
      file({ id: 'wf_b', name: long, folderPath: 'b' }),
    ])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await expect(
      fetchWorkspaceResourceRef(client, 'ws-1', ref({ title: long }))
    ).resolves.toBeNull()
    for (const [contract, input] of apiClientRequestMockFns.mockRequestJson.mock.calls) {
      if (contract !== searchWorkspaceFilesContract) continue
      expect((input as { query: { q: string } }).query.q.length).toBeLessThanOrEqual(200)
    }
  })

  it('asks for each candidate once, as a reference, which already answers an exact id', async () => {
    serveWorkspace([file({ id: 'wf_a', name: 'notes.md' })])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await expect(
      fetchWorkspaceResourceRef(client, 'ws-1', ref({ id: 'wf_a' }))
    ).resolves.toMatchObject({ id: 'wf_a' })
    const lookups = apiClientRequestMockFns.mockRequestJson.mock.calls.filter(
      ([contract]) => contract === lookupWorkspaceFilesContract
    )
    expect(lookups).toHaveLength(1)
    const body = (lookups[0][1] as { body: Record<string, unknown> }).body
    expect(body.ids ?? []).toEqual([])
    expect(body.references).toEqual(expect.arrayContaining(['wf_a']))
  })
})
