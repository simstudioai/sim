/** @vitest-environment node */
import { runEmbeddedCli } from 'sim/embed'
import { describe, expect, it, vi } from 'vitest'
import { createResourceEffectTransport } from '@/lib/mothership/agent-cli/resource-effects'
import type { ResourceChange } from '@/lib/mothership/generated/resources'

const endpoint = 'https://sim.test'
const table = {
  id: 'tbl_resource_audit',
  name: 'Audit',
  webUrl: `${endpoint}/tables/tbl_resource_audit`,
  description: null,
  ownerEmail: 'audit@example.com',
  schema: { columns: [] },
  rowCount: 0,
  maxRows: 100,
  folderPath: '/',
  job: null,
  locks: { schemaLocked: false, insertLocked: false, updateLocked: false, deleteLocked: false },
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
}

async function effectsFor(path: string, method: string, data: unknown = {}, status = 200) {
  const effects: ResourceChange[] = []
  const response = Response.json({ data }, { status })
  const fetcher = vi.fn(async () => response)
  const transport = createResourceEffectTransport(endpoint, fetcher, effects)
  const returned = await transport(`${endpoint}/api/v2/${path}`, { method })
  expect(returned).toBe(response)
  expect(fetcher).toHaveBeenCalledTimes(1)
  return effects
}

describe('confirmed CLI resource effects', () => {
  it.each([
    ['/', 'Report (final).md', 'files/Report%20(final).md'],
    ['/A%2FB/100%25', 'notes.md', 'files/A%2FB/100%25/notes.md'],
  ])(
    'converts public file folder path %s into a usable resource address',
    async (folderPath, name, path) => {
      const file = {
        id: 'file',
        webUrl: `${endpoint}/files/file`,
        name,
        size: 20,
        type: 'text/markdown',
        key: 'workspace/file',
        folderPath,
        uploadedByEmail: 'audit@example.com',
        uploadedAt: table.createdAt,
        updatedAt: table.updatedAt,
        deletedAt: null,
      }
      expect(await effectsFor('files/file', 'PATCH', file)).toEqual([
        { op: 'upsert', resource: { type: 'file', id: 'file', title: name, path } },
      ])
    }
  )

  it('captures committed identity through the real public CLI transport', async () => {
    const effects: ResourceChange[] = []
    const transport = createResourceEffectTransport(
      endpoint,
      async () => Response.json({ data: table }),
      effects
    )
    const result = await runEmbeddedCli(
      [
        '--output',
        'text',
        'tables',
        'create',
        '--name',
        'Audit',
        '--schema',
        '{"columns":[{"name":"name","type":"string"}]}',
      ],
      {
        endpoint,
        apiKey: 'fixture',
        workspaceId: '6fc7631d-88cd-46f8-9f0a-d4764daef7f8',
        transport,
      }
    )
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ id: table.id })
    expect(effects).toEqual([
      { op: 'upsert', resource: { type: 'table', id: table.id, title: 'Audit' } },
    ])
  })

  it.each([
    ['tables/t/rows', 'POST', 'table', 't'],
    ['tables/t/rows/r', 'PATCH', 'table', 't'],
    ['tables/t/columns', 'DELETE', 'table', 't'],
    ['tables/t/groups', 'PATCH', 'table', 't'],
    ['tables/t/dispatches/d', 'DELETE', 'table', 't'],
    ['knowledge/k/documents/d', 'PATCH', 'knowledgebase', 'k'],
    ['knowledge/k/connectors/c/sync', 'POST', 'knowledgebase', 'k'],
    ['workflows/w/versions/2/revert', 'POST', 'workflow', 'w'],
  ])('refreshes the parent of %s', async (path, method, type, id) => {
    expect(await effectsFor(path, method)).toEqual([{ op: 'refresh', resource: { type, id } }])
  })

  it('preserves the saved view identity without renaming the table to the view', async () => {
    const view = {
      id: 'view',
      tableId: table.id,
      name: 'Active',
      config: {},
      isDefault: false,
      createdByEmail: 'audit@example.com',
      createdAt: table.createdAt,
      updatedAt: table.updatedAt,
    }
    expect(await effectsFor(`tables/${table.id}/views`, 'POST', view)).toEqual([
      { op: 'upsert', resource: { type: 'table', id: table.id, viewId: 'view' } },
    ])
  })

  it('does not confuse extraction destinations, folders, or jobs with panel IDs', async () => {
    expect(
      await effectsFor('files/archive/unzip', 'POST', {
        folderPath: '/unpacked',
        extractedFileCount: 2,
        skippedFileCount: 0,
      })
    ).toEqual([
      { op: 'refresh', resource: { type: 'file' } },
      { op: 'refresh', resource: { type: 'filefolder' } },
    ])
    expect(await effectsFor('tables/folders', 'POST')).toEqual([
      { op: 'refresh', resource: { type: 'table' } },
      { op: 'refresh', resource: { type: 'folder' } },
    ])
    expect(await effectsFor('files/uploads', 'POST')).toEqual([])
    expect(await effectsFor('tables/imports/job/parts', 'POST')).toEqual([])
  })

  it('closes only confirmed successes from a partial bulk table deletion', async () => {
    const item = { kind: 'table', id: 'deleted', name: 'Deleted' }
    const effects = await effectsFor('tables/bulk-delete', 'POST', {
      deleted: [item],
      failed: [{ ...item, id: 'retained', reason: 'locked' }],
      skipped: [],
      notFound: [],
      deletedItems: { tables: 1, folders: 0 },
    })
    expect(effects[0]).toEqual({ op: 'remove', resource: { type: 'table', id: 'deleted' } })
    expect(JSON.stringify(effects)).not.toContain('retained')
  })

  it.each([
    ['workflows', 'workflow', 'folder'],
    ['tables', 'table', 'folder'],
    ['knowledge', 'knowledgebase', 'folder'],
    ['files', 'file', 'filefolder'],
  ])(
    'keeps %s folder mutations distinct from resource mutations',
    async (domain, type, folderType) => {
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        expect(await effectsFor(`${domain}/folders`, method, { path: '/renamed' })).toEqual([
          { op: 'refresh', resource: { type } },
          { op: 'refresh', resource: { type: folderType } },
        ])
      }
    }
  )

  it('restores a file folder without parsing its acknowledgement as a file', async () => {
    expect(
      await effectsFor('files/folders/restore', 'POST', { folder: { path: '/restored' } })
    ).toEqual([
      { op: 'refresh', resource: { type: 'file' } },
      { op: 'refresh', resource: { type: 'filefolder' } },
    ])
  })

  it.each(['workflows', 'files'])(
    'returns a successful %s folder rename through the real CLI',
    async (domain) => {
      const effects: ResourceChange[] = []
      const transport = createResourceEffectTransport(
        endpoint,
        async () => Response.json({ data: { path: '/renamed', name: 'renamed', parentPath: '/' } }),
        effects
      )
      const result = await runEmbeddedCli([domain, 'folders', 'move', '/before', '/renamed'], {
        endpoint,
        apiKey: 'fixture',
        workspaceId: '6fc7631d-88cd-46f8-9f0a-d4764daef7f8',
        transport,
      })
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ path: '/renamed' })
      expect(effects).toHaveLength(2)
    }
  )

  it('ignores failures, read-only POST queries, and external provider calls', async () => {
    expect(await effectsFor('tables/t/rows', 'POST', {}, 403)).toEqual([])
    expect(await effectsFor('tables/t/query', 'POST')).toEqual([])
    expect(await effectsFor('tables/t/query/count', 'POST')).toEqual([])
    expect(await effectsFor('knowledge/search', 'POST')).toEqual([])
    const effects: ResourceChange[] = []
    const transport = createResourceEffectTransport(
      endpoint,
      async () => Response.json({ data: table }),
      effects
    )
    await transport('https://provider.test/api/v2/tables', { method: 'POST' })
    expect(effects).toEqual([])
  })

  it('carries all file IDs after an atomic bulk delete, including a Request body', async () => {
    const effects: ResourceChange[] = []
    const transport = createResourceEffectTransport(
      endpoint,
      async (request) => {
        if (!(request instanceof Request)) throw new Error('Expected Request')
        expect(await request.json()).toMatchObject({ fileIds: ['first', 'second'] })
        return Response.json({ data: { deletedItems: { files: 2 } } })
      },
      effects
    )
    await transport(
      new Request(`${endpoint}/api/v2/files/bulk-delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: '6fc7631d-88cd-46f8-9f0a-d4764daef7f8',
          fileIds: ['first', 'second'],
        }),
      })
    )
    expect(effects).toEqual(
      ['first', 'second'].map((id) => ({ op: 'remove', resource: { type: 'file', id } }))
    )
  })

  it('addresses a deleted view without closing its table', async () => {
    expect(await effectsFor('tables/t/views/v', 'DELETE', { id: 'v', deleted: true })).toEqual([
      { op: 'clear_view', resource: { type: 'table', id: 't', viewId: 'v' } },
    ])
  })
})
