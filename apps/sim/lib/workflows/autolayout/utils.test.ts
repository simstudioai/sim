/**
 * @vitest-environment node
 */
import { BLOCK_DIMENSIONS } from '@sim/workflow-renderer'
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

  it('counts a canonical pair once even when a trigger spread duplicates it', () => {
    /*
     * The duplicate `tableSelector`/`manualTableId` entries carry trigger-only
     * modes, so exactly one member of the pair is ever visible. Counting the
     * spread copies too would reserve a phantom row of height.
     */
    const withoutTriggerSpread = {
      ...tableLikeConfig,
      subBlocks: (
        tableLikeConfig as unknown as { subBlocks: { mode?: string }[] }
      ).subBlocks.filter(
        (subBlock) => subBlock.mode !== 'trigger' && subBlock.mode !== 'trigger-advanced'
      ),
    } as unknown as ReturnType<typeof getBlock>

    mockGetBlock.mockReturnValue(tableLikeConfig)
    const spread = getBlockMetrics(createTableBlock('basic'))

    mockGetBlock.mockReturnValue(withoutTriggerSpread)
    const plain = getBlockMetrics(createTableBlock('basic'))

    expect(spread.height).toBe(plain.height)
  })

  it('never estimates a card shorter than the rows it can actually paint', () => {
    /*
     * The estimate only runs for a block that has never mounted, and on the
     * row path it cannot model `mcp-dynamic-args` row expansion. Erring high
     * opens a gap; erring low overlaps the next card — so a partially
     * configured block must still reserve room for every visible field plus
     * the permanent error row.
     */
    mockGetBlock.mockReturnValue(tableLikeConfig)

    const { height } = getBlockMetrics({
      ...createTableBlock('basic'),
      height: undefined,
      layout: undefined,
    } as unknown as BlockState)

    const visibleRows = 3
    expect(height).toBeGreaterThanOrEqual(
      BLOCK_DIMENSIONS.HEADER_HEIGHT +
        BLOCK_DIMENSIONS.WORKFLOW_CONTENT_PADDING +
        visibleRows * BLOCK_DIMENSIONS.WORKFLOW_ROW_HEIGHT +
        BLOCK_DIMENSIONS.WORKFLOW_ERROR_ROW_HEIGHT
    )
  })
})

describe('getBlockMetrics sentence estimation', () => {
  /**
   * A block whose card replaces its field rows with one line of prose. The
   * estimator has to reproduce that exactly rather than counting rows — a
   * sentence is one section where the rows were four, so the row-counting
   * slack would reserve most of a card of empty space under every one.
   */
  const sentencedConfig = {
    category: 'blocks',
    canvasPresentation: {
      defaultTitle: 'Notify',
      sentences: {
        default: [
          { text: 'Posts', field: 'message', core: true },
          { text: 'to', field: 'channel' },
          { text: ', as', field: 'username' },
        ],
      },
    },
    subBlocks: [
      { id: 'message', title: 'Message', type: 'long-input' },
      { id: 'channel', title: 'Channel', type: 'short-input' },
      { id: 'username', title: 'Username', type: 'short-input' },
      { id: 'iconEmoji', title: 'Icon', type: 'short-input' },
    ],
  } as unknown as ReturnType<typeof getBlock>

  function createUnmountedBlock(values: Record<string, string>): BlockState {
    return {
      id: 'notify-1',
      type: 'notify',
      name: 'Notify 1',
      position: { x: 0, y: 0 },
      subBlocks: Object.fromEntries(
        Object.entries(values).map(([id, value]) => [id, { id, type: 'short-input', value }])
      ),
      outputs: {},
      enabled: true,
      height: undefined,
      layout: undefined,
    } as unknown as BlockState
  }

  it('reserves one sentence line, not one row per configured field', () => {
    mockGetBlock.mockReturnValue(sentencedConfig)

    /* "Posts ⟨Hi⟩ to ⟨#a⟩" — comfortably inside the 234px wrap width. */
    const { height } = getBlockMetrics(createUnmountedBlock({ message: 'Hi', channel: '#a' }))

    /* Header + padding + one sentence line + gap + the permanent error row. */
    expect(height).toBe(
      BLOCK_DIMENSIONS.HEADER_HEIGHT +
        BLOCK_DIMENSIONS.WORKFLOW_CONTENT_PADDING +
        BLOCK_DIMENSIONS.WORKFLOW_SENTENCE_LINE_HEIGHT +
        BLOCK_DIMENSIONS.WORKFLOW_CONTENT_GAP +
        BLOCK_DIMENSIONS.WORKFLOW_ERROR_ROW_HEIGHT
    )
  })

  it('grows by a line when the sentence wraps', () => {
    mockGetBlock.mockReturnValue(sentencedConfig)

    const oneLine = getBlockMetrics(createUnmountedBlock({ message: 'Hi', channel: '#a' }))
    const twoLines = getBlockMetrics(
      createUnmountedBlock({ message: 'Deploy finished', channel: '#eng', username: 'bot' })
    )

    expect(twoLines.height - oneLine.height).toBe(BLOCK_DIMENSIONS.WORKFLOW_SENTENCE_LINE_HEIGHT)
  })

  it('estimates a sentenced card shorter than the same card as rows', () => {
    mockGetBlock.mockReturnValue(sentencedConfig)
    const withSentence = getBlockMetrics(
      createUnmountedBlock({ message: 'Deploy finished', channel: '#eng', username: 'bot' })
    )

    mockGetBlock.mockReturnValue({
      ...(sentencedConfig as object),
      canvasPresentation: undefined,
    } as unknown as ReturnType<typeof getBlock>)
    const asRows = getBlockMetrics(
      createUnmountedBlock({ message: 'Deploy finished', channel: '#eng', username: 'bot' })
    )

    expect(withSentence.height).toBeLessThan(asRows.height)
  })

  it('falls back to rows when the required anchor has no value', () => {
    /* A freshly pasted block has nothing filled, so the card paints rows. */
    mockGetBlock.mockReturnValue(sentencedConfig)

    const { height } = getBlockMetrics(createUnmountedBlock({ channel: '#eng' }))

    expect(height).toBeGreaterThanOrEqual(
      BLOCK_DIMENSIONS.HEADER_HEIGHT +
        BLOCK_DIMENSIONS.WORKFLOW_CONTENT_PADDING +
        BLOCK_DIMENSIONS.WORKFLOW_ROW_HEIGHT +
        BLOCK_DIMENSIONS.WORKFLOW_ERROR_ROW_HEIGHT
    )
  })
})
