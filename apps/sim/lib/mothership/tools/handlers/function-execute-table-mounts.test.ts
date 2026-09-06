/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolExecutionContext } from '@/lib/mothership/tool-executor/types'
import type { TableDefinition } from '@/lib/table/types'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  permission: vi.fn(),
  workspace: vi.fn(),
  table: vi.fn(),
  tables: vi.fn(),
  named: vi.fn(),
  folders: vi.fn(),
  snapshot: vi.fn(),
  safety: vi.fn(),
  cloud: vi.fn(),
  download: vi.fn(),
  presign: vi.fn(),
}))

vi.mock('@/tools', () => ({ executeTool: mocks.execute }))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === 'write' || (actual === 'read' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.workspace,
}))
vi.mock('@/lib/table/service', () => ({
  getTableById: mocks.table,
  listTables: mocks.tables,
  findActiveTablesByExactName: mocks.named,
  deleteTable: vi.fn(),
  renameTable: vi.fn(),
  moveTableToFolder: vi.fn(),
}))
vi.mock('@/lib/table', () => ({ getTableById: mocks.table }))
vi.mock('@/lib/folders/queries', () => ({ listFoldersForWorkspace: mocks.folders }))
vi.mock('@/lib/folders/orchestration', () => ({
  createFolderAtPath: vi.fn(),
  deleteFolderByPath: vi.fn(),
  relocateFolderByPath: vi.fn(),
}))
vi.mock('@/lib/table/snapshot-cache', () => ({
  getOrCreateTableSnapshot: mocks.snapshot,
  SNAPSHOT_MAX_BYTES: 500 * 1024 * 1024,
  TableSnapshotTooLargeError: class extends Error {},
}))
vi.mock('@/lib/table/rows/secret-provenance', () => ({
  getTableSnapshotModelMountSafety: mocks.safety,
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  hasCloudStorage: mocks.cloud,
  downloadFile: mocks.download,
  generatePresignedDownloadUrl: mocks.presign,
}))
vi.mock('@/executor/utils/code-secret-references', () => ({
  extractCodeSecretNames: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/secrets/usage/record', () => ({ recordSecretUsage: vi.fn() }))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceTablesChanged: vi.fn() }))

import { executeRunCode } from '@/lib/mothership/tools/handlers/run-code'
import { readTableSnapshot } from '@/lib/table/application/read-table-snapshot'
import { TableSnapshotTooLargeError } from '@/lib/table/snapshot-cache'

const context: ToolExecutionContext = {
  userId: 'actor',
  workspaceId: 'workspace',
  chatId: 'chat',
  toolCallId: 'mount-call',
  copilotToolExecution: true,
  sandboxProfile: 'mothership',
}
const table: TableDefinition = {
  id: 'table-orders',
  name: 'Orders',
  folderId: 'folder-finance',
  workspaceId: 'workspace',
  schema: { columns: [{ id: 'col_amount', name: 'amount', type: 'number' }] },
  rowCount: 2,
  maxRows: 100,
  description: null,
  metadata: null,
  createdBy: 'owner',
  archivedAt: null,
  createdAt: new Date('2026-09-01'),
  updatedAt: new Date('2026-09-01'),
}
const csv = Buffer.from('amount\n12\n30\n')

function run(reference: string, overrides: Partial<ToolExecutionContext> = {}) {
  return executeRunCode(
    {
      code: 'print("ready")',
      language: 'python',
      inputs: { tables: [{ path: reference, sandboxPath: '/tmp/orders.csv' }] },
    },
    { ...context, ...overrides }
  )
}

describe('Mothership table mounts through code calls', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.execute.mockResolvedValue({ success: true, output: {} })
    mocks.permission.mockResolvedValue('read')
    mocks.workspace.mockResolvedValue({
      workspaceId: 'workspace',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner',
    })
    mocks.table.mockResolvedValue(table)
    mocks.tables.mockResolvedValue([table])
    mocks.named.mockResolvedValue([table])
    mocks.folders.mockResolvedValue([{ id: 'folder-finance', name: 'Finance', parentId: null }])
    mocks.snapshot.mockResolvedValue({ key: 'snapshot.csv', size: csv.length, version: 1 })
    mocks.safety.mockResolvedValue('safe')
    mocks.cloud.mockReturnValue(false)
    mocks.download.mockResolvedValue(csv)
    mocks.presign.mockResolvedValue('https://storage.invalid/snapshot')
  })

  it.each(['table-orders', 'tables/Orders/meta.json', 'tables/Finance/Orders'])(
    'mounts the named table as CSV at the requested path: %s',
    async (reference) => {
      expect((await run(reference)).success).toBe(true)
      expect(mocks.execute.mock.calls[0][1]._sandboxFiles).toEqual([
        { path: '/tmp/orders.csv', content: csv.toString('utf8') },
      ])
    }
  )

  it('does not ignore a stale folder in a table reference', async () => {
    await expect(run('tables/Old/Orders/meta.json')).rejects.toThrow()
    expect(mocks.snapshot).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('reauthorizes the actor before snapshot or storage access', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(run('table-orders')).rejects.toThrow('permissions')
    expect(mocks.snapshot).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('requires a trusted tool context for table-only mounts', async () => {
    await expect(run('table-orders', { copilotToolExecution: false })).rejects.toThrow()
    expect(mocks.snapshot).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('decodes full folder paths and keeps explicit table IDs independent of folder moves', async () => {
    mocks.folders.mockResolvedValue([
      { id: 'folder-finance', name: 'Finance / July', parentId: null },
    ])
    await run('tables/Finance%20%2F%20July/Orders/meta.json')
    expect(mocks.snapshot).toHaveBeenCalledWith(table, 'copilot-fn-exec')
    expect(mocks.permission).toHaveBeenCalledWith('actor', 'workspace', null, undefined, {
      forUpdate: undefined,
    })
    mocks.folders.mockResolvedValue([])
    await run('table-orders')
    expect(mocks.execute).toHaveBeenCalledTimes(2)
  })

  it.each(['missing', 'foreign'] as const)(
    'conceals %s IDs before materialization',
    async (mode) => {
      mocks.table.mockResolvedValue(mode === 'missing' ? null : { ...table, workspaceId: 'other' })
      await expect(run('table-orders')).rejects.toThrow('not found')
      expect(mocks.snapshot).not.toHaveBeenCalled()
      expect(mocks.download).not.toHaveBeenCalled()
    }
  )

  it.each(['snapshot', 'safety', 'download', 'presign'] as const)(
    'keeps %s infrastructure failures out of model errors',
    async (stage) => {
      mocks.cloud.mockReturnValue(stage === 'presign')
      mocks[stage].mockRejectedValue(new Error('private database query and storage credentials'))
      await expect(run('table-orders')).rejects.toThrow(
        'Table input could not be read. Retry the mount.'
      )
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )

  it('keeps snapshot size failures actionable', async () => {
    mocks.snapshot.mockRejectedValue(
      new TableSnapshotTooLargeError('Table exceeds the mount limit.')
    )
    await expect(run('table-orders')).rejects.toThrow('exceeds the mount limit')
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it.each(['snapshot', 'safety'] as const)('stops after cancellation during %s', async (stage) => {
    const controller = new AbortController()
    mocks[stage].mockImplementation(async () => {
      controller.abort(new Error('Stopped'))
      return stage === 'snapshot' ? { key: 'snapshot.csv', size: csv.length, version: 1 } : 'safe'
    })
    await expect(run('table-orders', { abortSignal: controller.signal })).rejects.toThrow('Stopped')
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.presign).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('retains snapshot provenance refusal and cloud transport without buffering', async () => {
    mocks.safety.mockResolvedValueOnce('stale')
    await expect(run('table-orders')).rejects.toThrow('changed while preparing')
    expect(mocks.presign).not.toHaveBeenCalled()
    mocks.cloud.mockReturnValue(true)
    mocks.safety.mockResolvedValue('unsafe-provenance')
    await run('table-orders')
    const params = mocks.execute.mock.calls[0][1]
    expect(params._sandboxFiles).toEqual([
      {
        type: 'url',
        path: '/tmp/orders.csv',
        url: 'https://storage.invalid/snapshot',
        maxBytes: 500 * 1024 * 1024,
      },
    ])
    expect(mocks.presign).toHaveBeenCalledWith('snapshot.csv', 'execution', 1800)
    expect(mocks.download).not.toHaveBeenCalled()
    expect(
      mocks.execute.mock.calls[0][2].resolvedSecretTraceRegistry.exportProvenance().complete
    ).toBe(false)
  })

  it.each(['local', 'cloud'] as const)(
    'retains the %s mount budget across multiple tables',
    async (transport) => {
      mocks.cloud.mockReturnValue(transport === 'cloud')
      const size = (transport === 'cloud' ? 500 : 10) * 1024 * 1024
      mocks.snapshot.mockResolvedValue({ key: 'snapshot.csv', size, version: 1 })
      mocks.download.mockResolvedValue(Buffer.alloc(size))
      await expect(
        executeRunCode(
          {
            code: 'print(1)',
            language: 'python',
            inputs: { tables: Array.from({ length: 6 }, () => ({ tableId: 'table-orders' })) },
          },
          context
        )
      ).rejects.toThrow('total mount limit')
      expect(transport === 'cloud' ? mocks.presign : mocks.download).toHaveBeenCalledTimes(
        transport === 'cloud' ? 4 : 5
      )
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )

  it('refuses an expired or differently scoped snapshot delegation before table reads', async () => {
    for (const mode of ['expired', 'scope', 'audience', 'workspace'] as const) {
      await expect(
        readTableSnapshot.execute({
          principal: {
            kind: 'delegated',
            serviceId: 'copilot',
            subjectUserId: 'actor',
            workspaceId: mode === 'workspace' ? 'other' : 'workspace',
            delegationId: 'call',
            audience: mode === 'audience' ? 'sim:files' : 'sim:tables',
            issuedAt: new Date(Date.now() - 1000),
            expiresAt: new Date(Date.now() + (mode === 'expired' ? -1 : 60000)),
            resourceScope: mode === 'scope' ? { tableId: 'other' } : {},
          },
          input: {
            workspaceId: 'workspace',
            reference: 'table-orders',
            budget: { buffered: 0, url: 0 },
          },
        })
      ).rejects.toThrow('no longer valid')
    }
    expect(mocks.table).not.toHaveBeenCalled()
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })
})
