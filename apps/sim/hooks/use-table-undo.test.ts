/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Passthrough React hooks so the hook can run outside a React root.
vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void) => fn(),
  useRef: (init: unknown) => ({ current: init }),
}))

const mockMutate = vi.fn()
const mockMutateAsync = vi.fn()

vi.mock('@/hooks/queries/tables', () => ({
  useUpdateTableRow: vi.fn(() => ({ mutate: mockMutate })),
  useCreateTableRow: vi.fn(() => ({ mutate: mockMutate })),
  useBatchCreateTableRows: vi.fn(() => ({ mutate: mockMutate, mutateAsync: mockMutateAsync })),
  useBatchUpdateTableRows: vi.fn(() => ({ mutate: mockMutate, mutateAsync: mockMutateAsync })),
  useDeleteTableRow: vi.fn(() => ({ mutate: mockMutate })),
  useDeleteTableRows: vi.fn(() => ({ mutate: mockMutate })),
  useAddTableColumn: vi.fn(() => ({ mutate: mockMutate })),
  useUpdateColumn: vi.fn(() => ({ mutate: mockMutate })),
  useDeleteColumn: vi.fn(() => ({ mutate: mockMutate })),
  useRenameTable: vi.fn(() => ({ mutate: mockMutate })),
  useUpdateTableMetadata: vi.fn(() => ({ mutate: mockMutate })),
}))

vi.mock('@/lib/table/constants', () => ({
  TABLE_LIMITS: { MAX_BULK_OPERATION_SIZE: 3 }, // small limit so tests don't need 1000 items
}))

const mockPopUndo = vi.fn()
const mockPopRedo = vi.fn()
const mockPush = vi.fn()
const mockPatchRedoRowId = vi.fn()
const mockPatchUndoRowId = vi.fn()
const mockClear = vi.fn()

const storeState = {
  stacks: {},
  push: mockPush,
  popUndo: mockPopUndo,
  popRedo: mockPopRedo,
  patchRedoRowId: mockPatchRedoRowId,
  patchUndoRowId: mockPatchUndoRowId,
  clear: mockClear,
}

vi.mock('@/stores/table/store', () => ({
  useTableUndoStore: vi.fn((selector: (s: typeof storeState) => unknown) => selector(storeState)),
  runWithoutRecording: (fn: () => unknown) => Promise.resolve(fn()),
}))

import { useTableUndo } from '@/hooks/use-table-undo'
import type { TableUndoAction } from '@/stores/table/types'

const WORKSPACE_ID = 'ws-1'
const TABLE_ID = 'tbl-1'

function makeHook() {
  return useTableUndo({ workspaceId: WORKSPACE_ID, tableId: TABLE_ID })
}

function makeEntry(action: TableUndoAction) {
  return { id: 'e1', action, timestamp: Date.now() }
}

function makeCellsForClear(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    rowId: `row-${i}`,
    data: { col: `val-${i}` },
  }))
}

/** Drain the microtask queue so all async chunks in executeAction finish. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMutateAsync.mockResolvedValue({})
})

describe('useTableUndo – clear-cells chunking (via undo)', () => {
  it('sends a single mutateAsync call when cells fit in one chunk', async () => {
    const cells = makeCellsForClear(2)
    mockPopUndo.mockReturnValueOnce(makeEntry({ type: 'clear-cells', cells }))
    const { undo } = makeHook()
    ;(undo as () => void)()
    await flush()
    expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockMutateAsync.mock.calls[0][0].updates).toHaveLength(2)
  })

  it('splits into multiple chunks when cells exceed the limit', async () => {
    const cells = makeCellsForClear(7) // limit=3 → [3,3,1]
    mockPopUndo.mockReturnValueOnce(makeEntry({ type: 'clear-cells', cells }))
    const { undo } = makeHook()
    ;(undo as () => void)()
    await flush()
    expect(mockMutateAsync).toHaveBeenCalledTimes(3)
    expect(mockMutateAsync.mock.calls[0][0].updates).toHaveLength(3)
    expect(mockMutateAsync.mock.calls[1][0].updates).toHaveLength(3)
    expect(mockMutateAsync.mock.calls[2][0].updates).toHaveLength(1)
  })

  it('sends original data values for undo direction', async () => {
    const cells = makeCellsForClear(1)
    mockPopUndo.mockReturnValueOnce(makeEntry({ type: 'clear-cells', cells }))
    const { undo } = makeHook()
    ;(undo as () => void)()
    await flush()
    expect(mockMutateAsync.mock.calls[0][0].updates[0].data.col).toBe('val-0')
  })

  it('sends null values for redo direction', async () => {
    const cells = makeCellsForClear(1)
    mockPopRedo.mockReturnValueOnce(makeEntry({ type: 'clear-cells', cells }))
    const { redo } = makeHook()
    ;(redo as () => void)()
    await flush()
    expect(mockMutateAsync.mock.calls[0][0].updates[0].data.col).toBeNull()
  })

  it('does not call mutateAsync when cells is empty', async () => {
    mockPopUndo.mockReturnValueOnce(makeEntry({ type: 'clear-cells', cells: [] }))
    const { undo } = makeHook()
    ;(undo as () => void)()
    await flush()
    expect(mockMutateAsync).not.toHaveBeenCalled()
  })

  it('stops processing after the first failing chunk', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Network error'))
    const cells = makeCellsForClear(5) // limit=3 → would be [3,2] but stops at chunk 1
    mockPopUndo.mockReturnValueOnce(makeEntry({ type: 'clear-cells', cells }))
    const { undo } = makeHook()
    // executeAction catches the error internally via logger — undo itself doesn't re-throw.
    ;(undo as () => void)()
    await flush()
    expect(mockMutateAsync).toHaveBeenCalledTimes(1)
  })
})

describe('useTableUndo – update-cells chunking (via undo)', () => {
  function makeCellsForUpdate(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      rowId: `row-${i}`,
      oldData: { col: `old-${i}` },
      newData: { col: `new-${i}` },
    }))
  }

  it('sends a single call when cells fit within limit', async () => {
    const cells = makeCellsForUpdate(2)
    mockPopUndo.mockReturnValueOnce(makeEntry({ type: 'update-cells', cells }))
    const { undo } = makeHook()
    ;(undo as () => void)()
    await flush()
    expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockMutateAsync.mock.calls[0][0].updates[0].data.col).toBe('old-0')
  })

  it('chunks across multiple calls and picks the correct direction data', async () => {
    const cells = makeCellsForUpdate(8) // limit=3 → [3,3,2]
    mockPopRedo.mockReturnValueOnce(makeEntry({ type: 'update-cells', cells }))
    const { redo } = makeHook()
    ;(redo as () => void)()
    await flush()
    expect(mockMutateAsync).toHaveBeenCalledTimes(3)
    const lastChunk = mockMutateAsync.mock.calls[2][0].updates
    expect(lastChunk).toHaveLength(2)
    // redo direction → newData
    expect(lastChunk[0].data.col).toBe('new-6')
  })
})

describe('useTableUndo – delete-column undo cell restore chunking', () => {
  const baseAction: TableUndoAction = {
    type: 'delete-column',
    columnName: 'col',
    columnType: 'string' as const,
    columnPosition: 0,
    columnUnique: false,
    columnRequired: false,
    cellData: [],
    previousOrder: null,
    previousWidth: null,
  }

  it('does not call mutateAsync when cellData is empty', async () => {
    mockPopUndo.mockReturnValueOnce(makeEntry(baseAction))
    const { undo } = makeHook()
    ;(undo as () => void)()
    await flush()
    // addColumnMutation.mutate fires but the cell-restore block should not.
    expect(mockMutateAsync).not.toHaveBeenCalled()
  })

  it('fires chunked mutateAsync calls via the onSuccess IIFE when cellData exceeds limit', async () => {
    const cellData = Array.from({ length: 5 }, (_, i) => ({ rowId: `row-${i}`, value: i }))
    const action: TableUndoAction = { ...baseAction, cellData }
    mockPopUndo.mockReturnValueOnce(makeEntry(action))

    // addColumnMutation.mutate is the first mockMutate call.
    // Capture its onSuccess and invoke it to simulate column creation completing.
    let capturedOnSuccess: (() => void) | undefined
    mockMutate.mockImplementationOnce((_: unknown, opts: { onSuccess?: () => void }) => {
      capturedOnSuccess = opts?.onSuccess
    })

    const { undo } = makeHook()
    ;(undo as () => void)()
    await flush()

    // At this point executeAction has returned, but the restore happens in the
    // addColumn onSuccess callback — fire it now.
    capturedOnSuccess?.()
    // Allow the void IIFE's microtasks to drain.
    await new Promise((r) => setTimeout(r, 0))

    // limit=3 → [3, 2]
    expect(mockMutateAsync).toHaveBeenCalledTimes(2)
    expect(mockMutateAsync.mock.calls[0][0].updates).toHaveLength(3)
    expect(mockMutateAsync.mock.calls[1][0].updates).toHaveLength(2)
  })
})
