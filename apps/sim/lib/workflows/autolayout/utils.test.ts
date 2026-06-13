/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VERTICAL_SPACING } from '@/lib/workflows/autolayout/constants'
import { getBlockMetrics, resolveNoteOverlaps } from '@/lib/workflows/autolayout/utils'
import type { getBlock } from '@/blocks'
import type { BlockState } from '@/stores/workflows/workflow/types'

const { mockGetBlock } = vi.hoisted(() => ({
  mockGetBlock: vi.fn(),
}))

vi.mock('@/blocks', () => ({
  getBlock: mockGetBlock,
}))

function createBlock(
  id: string,
  type: string,
  position: { x: number; y: number },
  overrides: Partial<BlockState> = {}
): BlockState {
  return {
    id,
    type,
    name: id,
    position,
    subBlocks: {},
    outputs: {},
    enabled: true,
    layout: { measuredWidth: 250, measuredHeight: 120 },
    ...overrides,
  } as BlockState
}

beforeEach(() => {
  mockGetBlock.mockReturnValue(null)
})

describe('resolveNoteOverlaps', () => {
  it('relocates a note that overlaps a laid-out block', () => {
    const blocks: Record<string, BlockState> = {
      a: createBlock('a', 'agent', { x: 150, y: 150 }),
      note: createBlock(
        'note',
        'note',
        { x: 160, y: 160 },
        {
          height: 120,
          layout: { measuredHeight: 120 },
        }
      ),
    }

    resolveNoteOverlaps(blocks, DEFAULT_VERTICAL_SPACING)

    // Block is untouched; note is pushed below the block's bottom edge.
    expect(blocks.a.position).toEqual({ x: 150, y: 150 })
    expect(blocks.note.position.x).toBe(150)
    expect(blocks.note.position.y).toBeGreaterThanOrEqual(150 + 120 + DEFAULT_VERTICAL_SPACING - 1)
  })

  it('leaves a note that does not overlap any block in place', () => {
    const blocks: Record<string, BlockState> = {
      a: createBlock('a', 'agent', { x: 150, y: 150 }),
      note: createBlock(
        'note',
        'note',
        { x: 2000, y: 2000 },
        {
          height: 120,
          layout: { measuredHeight: 120 },
        }
      ),
    }

    resolveNoteOverlaps(blocks, DEFAULT_VERTICAL_SPACING)

    expect(blocks.note.position).toEqual({ x: 2000, y: 2000 })
  })

  it('stacks multiple overlapping notes without overlapping each other', () => {
    const blocks: Record<string, BlockState> = {
      a: createBlock('a', 'agent', { x: 150, y: 150 }),
      note1: createBlock(
        'note1',
        'note',
        { x: 150, y: 150 },
        {
          height: 100,
          layout: { measuredHeight: 100 },
        }
      ),
      note2: createBlock(
        'note2',
        'note',
        { x: 200, y: 200 },
        {
          height: 100,
          layout: { measuredHeight: 100 },
        }
      ),
    }

    resolveNoteOverlaps(blocks, DEFAULT_VERTICAL_SPACING)

    const n1 = blocks.note1.position
    const n2 = blocks.note2.position
    // Both relocated, stacked in reading order with no vertical overlap.
    expect(n2.y).toBeGreaterThanOrEqual(n1.y + 100)
  })

  it('does nothing when there are no notes', () => {
    const blocks: Record<string, BlockState> = {
      a: createBlock('a', 'agent', { x: 150, y: 150 }),
      b: createBlock('b', 'agent', { x: 500, y: 150 }),
    }

    resolveNoteOverlaps(blocks, DEFAULT_VERTICAL_SPACING)

    expect(blocks.a.position).toEqual({ x: 150, y: 150 })
    expect(blocks.b.position).toEqual({ x: 500, y: 150 })
  })

  it('never produces non-finite coordinates when a block has a NaN position', () => {
    const blocks: Record<string, BlockState> = {
      bad: createBlock('bad', 'agent', { x: Number.NaN, y: Number.NaN }),
      a: createBlock('a', 'agent', { x: 150, y: 150 }),
      note: createBlock(
        'note',
        'note',
        { x: 150, y: 150 },
        {
          height: 120,
          layout: { measuredHeight: 120 },
        }
      ),
    }

    resolveNoteOverlaps(blocks, DEFAULT_VERTICAL_SPACING)

    // The corrupted block is ignored; the note still relocates off block "a"
    // using only finite coordinates.
    expect(Number.isFinite(blocks.note.position.x)).toBe(true)
    expect(Number.isFinite(blocks.note.position.y)).toBe(true)
    expect(blocks.note.position.x).toBe(150)
    expect(blocks.note.position.y).toBeGreaterThan(150)
  })

  describe('targeted mode (previousBlocks)', () => {
    it('relocates a note when a block was moved onto it', () => {
      const previousBlocks: Record<string, BlockState> = {
        a: createBlock('a', 'agent', { x: 2000, y: 2000 }),
        note: createBlock(
          'note',
          'note',
          { x: 150, y: 150 },
          {
            height: 120,
            layout: { measuredHeight: 120 },
          }
        ),
      }
      // Block "a" has been shifted onto the note by the layout pass.
      const blocks: Record<string, BlockState> = {
        a: createBlock('a', 'agent', { x: 150, y: 150 }),
        note: createBlock(
          'note',
          'note',
          { x: 150, y: 150 },
          {
            height: 120,
            layout: { measuredHeight: 120 },
          }
        ),
      }

      resolveNoteOverlaps(blocks, DEFAULT_VERTICAL_SPACING, { previousBlocks })

      expect(blocks.note.position.x).toBe(150)
      expect(blocks.note.position.y).toBeGreaterThan(150)
    })

    it('preserves a pre-existing overlap not introduced by this pass', () => {
      // The note already overlapped block "a" before the pass; "a" did not move.
      const previousBlocks: Record<string, BlockState> = {
        a: createBlock('a', 'agent', { x: 150, y: 150 }),
        note: createBlock(
          'note',
          'note',
          { x: 160, y: 160 },
          {
            height: 120,
            layout: { measuredHeight: 120 },
          }
        ),
      }
      const blocks: Record<string, BlockState> = {
        a: createBlock('a', 'agent', { x: 150, y: 150 }),
        note: createBlock(
          'note',
          'note',
          { x: 160, y: 160 },
          {
            height: 120,
            layout: { measuredHeight: 120 },
          }
        ),
      }

      resolveNoteOverlaps(blocks, DEFAULT_VERTICAL_SPACING, { previousBlocks })

      expect(blocks.note.position).toEqual({ x: 160, y: 160 })
    })

    it('relocates when a newly added block (no prior position) lands on a note', () => {
      const previousBlocks: Record<string, BlockState> = {
        note: createBlock(
          'note',
          'note',
          { x: 150, y: 150 },
          {
            height: 120,
            layout: { measuredHeight: 120 },
          }
        ),
      }
      const blocks: Record<string, BlockState> = {
        a: createBlock('a', 'agent', { x: 150, y: 150 }),
        note: createBlock(
          'note',
          'note',
          { x: 150, y: 150 },
          {
            height: 120,
            layout: { measuredHeight: 120 },
          }
        ),
      }

      resolveNoteOverlaps(blocks, DEFAULT_VERTICAL_SPACING, { previousBlocks })

      expect(blocks.note.position.y).toBeGreaterThan(150)
    })
  })
})

describe('getBlockMetrics preview row estimation', () => {
  /**
   * Mirrors a block that spreads a trigger's subBlocks after its own,
   * producing duplicate canonical pair entries with trigger/trigger-advanced
   * modes (e.g. the Table block spreading the table_new_row trigger).
   */
  const tableLikeConfig = {
    category: 'blocks',
    subBlocks: [
      { id: 'operation', title: 'Operation', type: 'dropdown' },
      {
        id: 'tableSelector',
        title: 'Table',
        type: 'table-selector',
        mode: 'basic',
        canonicalParamId: 'tableId',
      },
      {
        id: 'manualTableId',
        title: 'Table ID',
        type: 'short-input',
        mode: 'advanced',
        canonicalParamId: 'tableId',
      },
      { id: 'data', title: 'Row Data (JSON)', type: 'code' },
      {
        id: 'tableSelector',
        title: 'Table',
        type: 'table-selector',
        mode: 'trigger',
        canonicalParamId: 'tableId',
      },
      {
        id: 'manualTableId',
        title: 'Table ID',
        type: 'short-input',
        mode: 'trigger-advanced',
        canonicalParamId: 'tableId',
      },
      { id: 'eventType', title: 'Event', type: 'dropdown', mode: 'trigger' },
    ],
  } as unknown as ReturnType<typeof getBlock>

  function createTableBlock(canonicalMode: 'basic' | 'advanced'): BlockState {
    return {
      id: 'table-1',
      type: 'table',
      name: 'Table 1',
      position: { x: 0, y: 0 },
      subBlocks: {
        operation: { id: 'operation', type: 'dropdown', value: 'insert_row' },
        tableSelector: { id: 'tableSelector', type: 'table-selector', value: 'tbl_1' },
        manualTableId: { id: 'manualTableId', type: 'short-input', value: 'tbl_1' },
      },
      outputs: {},
      enabled: true,
      data: { canonicalModes: { tableId: canonicalMode } },
    } as unknown as BlockState
  }

  it('renders one row per canonical pair regardless of basic/advanced mode', () => {
    mockGetBlock.mockReturnValue(tableLikeConfig)

    const basic = getBlockMetrics(createTableBlock('basic'))
    const advanced = getBlockMetrics(createTableBlock('advanced'))

    expect(advanced.height).toBe(basic.height)
  })
})
