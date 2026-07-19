/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterfaceLayout, InterfaceModule } from '@/lib/interfaces/types'

const { mockGetTableById } = vi.hoisted(() => ({ mockGetTableById: vi.fn() }))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@sim/db/schema', () => ({
  workspaceInterface: {
    id: 'id',
    workspaceId: 'workspaceId',
    name: 'name',
    description: 'description',
    layout: 'layout',
    archivedAt: 'archivedAt',
    createdBy: 'createdBy',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  workflow: {
    id: 'id',
    workspaceId: 'workspaceId',
    archivedAt: 'archivedAt',
  },
  workspaceFiles: {
    id: 'id',
    workspaceId: 'workspaceId',
    context: 'context',
    deletedAt: 'deletedAt',
  },
}))

vi.mock('@/lib/table', () => ({ getTableById: mockGetTableById }))

import { DEFAULT_MODULE_CONFIGS } from '@/lib/interfaces/constants'
import {
  addModule,
  createInterface,
  deleteInterface,
  getInterfaceById,
  InterfaceConflictError,
  InterfaceStaleWriteError,
  moveModule,
  removeModule,
  updateInterfaceLayout,
  updateModuleConfig,
} from '@/lib/interfaces/service'
import { InterfaceLayoutError, InvalidModuleReferenceError } from '@/lib/interfaces/validation'

const WORKSPACE_ID = 'ws-1'

function chatModule(id: string, row: 0 | 1, col: 0 | 1): InterfaceModule {
  return {
    id,
    type: 'chat',
    cell: { row, col },
    config: { workflowId: null, outputConfigs: [], showThinking: false, welcomeMessage: '' },
  }
}

function makeRow(overrides?: Record<string, unknown>) {
  return {
    id: 'iface-1',
    workspaceId: WORKSPACE_ID,
    name: 'Support',
    description: null,
    layout: { version: 1, modules: [] } satisfies InterfaceLayout,
    archivedAt: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  }
}

function lastCallArg(fn: { mock: { calls: unknown[][] } }): unknown {
  const calls = fn.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][0]
}

function lastWrittenLayout(): InterfaceLayout {
  return (lastCallArg(dbChainMockFns.set) as { layout: InterfaceLayout }).layout
}

describe('interface service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getInterfaceById', () => {
    it('maps timestamps to ISO strings', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([makeRow()])
      const definition = await getInterfaceById('iface-1')
      expect(definition).toMatchObject({
        id: 'iface-1',
        workspaceId: WORKSPACE_ID,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        archivedAt: null,
      })
    })

    it('returns null when the interface does not exist', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([])
      await expect(getInterfaceById('missing')).resolves.toBeNull()
    })
  })

  describe('createInterface', () => {
    it('creates with an empty versioned layout', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow()])
      const definition = await createInterface({
        workspaceId: WORKSPACE_ID,
        name: 'Support',
        createdBy: 'user-1',
      })
      expect(definition.name).toBe('Support')
      const inserted = lastCallArg(dbChainMockFns.values) as Record<string, unknown>
      expect(inserted.layout).toEqual({ version: 1, modules: [] })
      expect(inserted.id).toEqual(expect.any(String))
    })

    it('maps a unique violation to InterfaceConflictError', async () => {
      dbChainMockFns.returning.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' })
      )
      await expect(
        createInterface({ workspaceId: WORKSPACE_ID, name: 'Support', createdBy: 'user-1' })
      ).rejects.toThrow(InterfaceConflictError)
    })

    it('rejects an empty name without touching the database', async () => {
      await expect(
        createInterface({ workspaceId: WORKSPACE_ID, name: '   ', createdBy: 'user-1' })
      ).rejects.toThrow('Interface name is required')
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    })
  })

  describe('addModule', () => {
    it('adds a module with the default config and returns its id', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([makeRow()])
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow()])

      const { moduleId } = await addModule('iface-1', {
        type: 'chat',
        cell: { row: 0, col: 1 },
      })

      const layout = lastWrittenLayout()
      expect(layout.modules).toHaveLength(1)
      expect(layout.modules[0]).toEqual({
        id: moduleId,
        type: 'chat',
        cell: { row: 0, col: 1 },
        config: DEFAULT_MODULE_CONFIGS.chat(),
      })
    })

    it('rejects adding onto an occupied cell', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([
        makeRow({ layout: { version: 1, modules: [chatModule('existing', 0, 0)] } }),
      ])

      await expect(
        addModule('iface-1', { type: 'table', cell: { row: 0, col: 0 } })
      ).rejects.toThrow(InterfaceLayoutError)
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('throws when the interface does not exist', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([])
      await expect(
        addModule('missing', { type: 'chat', cell: { row: 0, col: 0 } })
      ).rejects.toThrow('Interface not found')
    })
  })

  describe('moveModule', () => {
    it('swaps cells when the target cell is occupied', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([
        makeRow({
          layout: { version: 1, modules: [chatModule('a', 0, 0), chatModule('b', 1, 1)] },
        }),
      ])
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow()])

      await moveModule('iface-1', 'a', { row: 1, col: 1 })

      const layout = lastWrittenLayout()
      const byId = new Map(layout.modules.map((m) => [m.id, m]))
      expect(byId.get('a')?.cell).toEqual({ row: 1, col: 1 })
      expect(byId.get('b')?.cell).toEqual({ row: 0, col: 0 })
    })

    it('moves onto an empty cell without touching other modules', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([
        makeRow({
          layout: { version: 1, modules: [chatModule('a', 0, 0), chatModule('b', 1, 1)] },
        }),
      ])
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow()])

      await moveModule('iface-1', 'a', { row: 0, col: 1 })

      const layout = lastWrittenLayout()
      const byId = new Map(layout.modules.map((m) => [m.id, m]))
      expect(byId.get('a')?.cell).toEqual({ row: 0, col: 1 })
      expect(byId.get('b')?.cell).toEqual({ row: 1, col: 1 })
    })

    it('throws when the module does not exist', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([makeRow()])
      await expect(moveModule('iface-1', 'ghost', { row: 0, col: 0 })).rejects.toThrow(
        'Module not found'
      )
    })
  })

  describe('updateModuleConfig', () => {
    it('fully replaces the module config', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([
        makeRow({ layout: { version: 1, modules: [chatModule('a', 0, 0)] } }),
      ])
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow()])

      await updateModuleConfig('iface-1', 'a', {
        workflowId: null,
        outputConfigs: [],
        showThinking: true,
        welcomeMessage: 'Hi there',
      })

      const layout = lastWrittenLayout()
      expect(layout.modules[0].config).toEqual({
        workflowId: null,
        outputConfigs: [],
        showThinking: true,
        welcomeMessage: 'Hi there',
      })
    })

    it('rejects a config whose shape does not match the module type', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([
        makeRow({ layout: { version: 1, modules: [chatModule('a', 0, 0)] } }),
      ])

      await expect(updateModuleConfig('iface-1', 'a', { tableId: 'tbl-1' })).rejects.toThrow(
        InterfaceLayoutError
      )
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })
  })

  describe('removeModule', () => {
    it('removes the module from the layout', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([
        makeRow({
          layout: { version: 1, modules: [chatModule('a', 0, 0), chatModule('b', 0, 1)] },
        }),
      ])
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow()])

      await removeModule('iface-1', 'a')

      const layout = lastWrittenLayout()
      expect(layout.modules.map((m) => m.id)).toEqual(['b'])
    })

    it('throws when the module does not exist', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([makeRow()])
      await expect(removeModule('iface-1', 'ghost')).rejects.toThrow('Module not found')
    })
  })

  describe('updateInterfaceLayout', () => {
    it('rejects an invalid layout before writing', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([makeRow()])
      const layout: InterfaceLayout = {
        version: 1,
        modules: [chatModule('a', 0, 0), chatModule('b', 0, 0)],
      }
      await expect(updateInterfaceLayout('iface-1', layout)).rejects.toThrow(InterfaceLayoutError)
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('persists a valid layout', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([makeRow()])
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow()])
      const layout: InterfaceLayout = {
        version: 1,
        modules: [chatModule('a', 0, 0)],
      }
      await updateInterfaceLayout('iface-1', layout)
      expect(lastWrittenLayout()).toEqual(layout)
    })

    it('rejects a write whose expectedUpdatedAt is stale', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([makeRow()])
      const layout: InterfaceLayout = { version: 1, modules: [chatModule('a', 0, 0)] }

      await expect(
        updateInterfaceLayout('iface-1', layout, {
          expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
        })
      ).rejects.toThrow(InterfaceStaleWriteError)
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('accepts a write whose expectedUpdatedAt matches the stored row', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([makeRow()])
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow()])
      const layout: InterfaceLayout = { version: 1, modules: [chatModule('a', 0, 0)] }

      await updateInterfaceLayout('iface-1', layout, {
        expectedUpdatedAt: '2026-01-02T00:00:00.000Z',
      })
      expect(lastWrittenLayout()).toEqual(layout)
    })
  })

  describe('locked read-modify-write', () => {
    it('takes a row lock and re-reads inside the transaction before mutating', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([makeRow()])
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow()])

      await addModule('iface-1', { type: 'chat', cell: { row: 0, col: 0 } })

      expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.execute).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.select).toHaveBeenCalled()
    })

    it('builds the next layout from the committed row, not a caller snapshot', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([
        makeRow({ layout: { version: 1, modules: [chatModule('committed', 0, 0)] } }),
      ])
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow()])

      const { moduleId } = await addModule('iface-1', { type: 'table', cell: { row: 1, col: 1 } })

      expect(lastWrittenLayout().modules.map((m) => m.id)).toEqual(['committed', moduleId])
    })

    it('does not write when the interface disappears before the lock is taken', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([])

      await expect(removeModule('iface-1', 'a')).rejects.toThrow('Interface not found')
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })
  })

  /**
   * A layout write holds a pooled connection and a row lock for the whole
   * transaction, so nothing inside it may query the global pool — a second
   * checkout deadlocks the pool at saturation, and the `db.transaction`
   * tripwire rejects it outright outside production. That was a live 500:
   * connecting a table ran the reference check on the global handle.
   *
   * The shared mock hands the transaction callback the very object it exports
   * as `db`, so `tx` and the global pool are indistinguishable by construction
   * and no assertion can tell the two apart. These tests hand out a separate
   * handle instead, which makes the distinction observable: the global chain
   * entry points must record zero calls for the entire write.
   */
  describe('transaction executor discipline', () => {
    function makeTxHandle() {
      return {
        select: vi.fn(() => ({ from: dbChainMockFns.from })),
        update: vi.fn(() => ({ set: dbChainMockFns.set })),
        execute: vi.fn(async () => []),
      }
    }

    function tableModule(id: string, tableId: string | null): InterfaceModule {
      return { id, type: 'table', cell: { row: 0, col: 1 }, config: { tableId } }
    }

    it('resolves every reference on the transaction handle, never the global pool', async () => {
      const tx = makeTxHandle()
      dbChainMockFns.transaction.mockImplementationOnce(async (cb: (handle: unknown) => unknown) =>
        cb(tx)
      )
      dbChainMockFns.limit
        .mockResolvedValueOnce([makeRow()])
        .mockResolvedValueOnce([{ id: 'wf-1', workspaceId: WORKSPACE_ID }])
        .mockResolvedValueOnce([{ id: 'file-1' }])
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow()])
      mockGetTableById.mockResolvedValueOnce({ id: 'tbl-1', workspaceId: WORKSPACE_ID })

      await updateInterfaceLayout('iface-1', {
        version: 1,
        modules: [
          {
            id: 'c',
            type: 'chat',
            cell: { row: 0, col: 0 },
            config: {
              workflowId: 'wf-1',
              outputConfigs: [],
              showThinking: false,
              welcomeMessage: '',
            },
          },
          tableModule('t', 'tbl-1'),
          { id: 'f', type: 'file', cell: { row: 1, col: 0 }, config: { fileId: 'file-1' } },
        ],
      })

      expect(mockGetTableById).toHaveBeenCalledTimes(1)
      expect(mockGetTableById.mock.calls[0][1]?.tx).toBe(tx)

      expect(dbChainMockFns.select).not.toHaveBeenCalled()
      expect(dbChainMockFns.execute).not.toHaveBeenCalled()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(tx.execute).toHaveBeenCalledTimes(1)
      expect(tx.select.mock.calls.length).toBe(3)
      expect(tx.update).toHaveBeenCalledTimes(1)
    })

    it('keeps the global pool idle on a granular module operation', async () => {
      const tx = makeTxHandle()
      dbChainMockFns.transaction.mockImplementationOnce(async (cb: (handle: unknown) => unknown) =>
        cb(tx)
      )
      dbChainMockFns.limit.mockResolvedValueOnce([
        makeRow({ layout: { version: 1, modules: [tableModule('t', null)] } }),
      ])
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow()])
      mockGetTableById.mockResolvedValueOnce({ id: 'tbl-1', workspaceId: WORKSPACE_ID })

      await updateModuleConfig('iface-1', 't', { tableId: 'tbl-1' })

      expect(mockGetTableById.mock.calls[0][1]?.tx).toBe(tx)
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
      expect(dbChainMockFns.execute).not.toHaveBeenCalled()
    })

    it('still rejects a cross-workspace reference resolved through the transaction', async () => {
      const tx = makeTxHandle()
      dbChainMockFns.transaction.mockImplementationOnce(async (cb: (handle: unknown) => unknown) =>
        cb(tx)
      )
      dbChainMockFns.limit.mockResolvedValueOnce([makeRow()])
      mockGetTableById.mockResolvedValueOnce({ id: 'tbl-1', workspaceId: 'other-workspace' })

      await expect(
        updateInterfaceLayout('iface-1', { version: 1, modules: [tableModule('t', 'tbl-1')] })
      ).rejects.toThrow(InvalidModuleReferenceError)

      expect(mockGetTableById.mock.calls[0][1]?.tx).toBe(tx)
      expect(tx.update).not.toHaveBeenCalled()
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    })

    it('grandfathers a stored reference without querying at all', async () => {
      const tx = makeTxHandle()
      dbChainMockFns.transaction.mockImplementationOnce(async (cb: (handle: unknown) => unknown) =>
        cb(tx)
      )
      const stored = { version: 1, modules: [tableModule('t', 'tbl-archived')] } as InterfaceLayout
      dbChainMockFns.limit.mockResolvedValueOnce([makeRow({ layout: stored })])
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow()])

      await moveModule('iface-1', 't', { row: 1, col: 1 })

      expect(mockGetTableById).not.toHaveBeenCalled()
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    })
  })

  describe('deleteInterface', () => {
    it('archives by setting archivedAt', async () => {
      await deleteInterface('iface-1')
      const patch = lastCallArg(dbChainMockFns.set) as Record<string, unknown>
      expect(patch.archivedAt).toBeInstanceOf(Date)
      expect(patch.updatedAt).toBeInstanceOf(Date)
    })
  })
})
