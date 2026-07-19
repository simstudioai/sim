/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormField, InterfaceLayout, InterfaceModule } from '@/lib/interfaces/types'

const { mockGetTableById } = vi.hoisted(() => ({ mockGetTableById: vi.fn() }))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/lib/table', () => ({ getTableById: mockGetTableById }))

import { INTERFACE_LAYOUT_LIMITS, RESERVED_FORM_FIELD_NAMES } from '@/lib/interfaces/constants'
import {
  InterfaceLayoutError,
  InvalidModuleReferenceError,
  validateLayout,
} from '@/lib/interfaces/validation'

const WORKSPACE_ID = 'ws-1'

function chatModule(overrides?: Partial<InterfaceModule>): InterfaceModule {
  return {
    id: 'mod-chat',
    type: 'chat',
    placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
    config: { workflowId: null, outputConfigs: [], showThinking: false, welcomeMessage: '' },
    ...overrides,
  } as InterfaceModule
}

function formField(overrides?: Partial<FormField>): FormField {
  return {
    id: 'field-1',
    name: 'email',
    label: 'Email',
    type: 'short-text',
    required: false,
    ...overrides,
  }
}

function formModule(fields: FormField[], overrides?: Partial<InterfaceModule>): InterfaceModule {
  return {
    id: 'mod-form',
    type: 'form',
    placement: { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
    config: { workflowId: null, fields, submitLabel: 'Submit' },
    ...overrides,
  } as InterfaceModule
}

function layoutOf(modules: InterfaceModule[]): InterfaceLayout {
  return { version: 1, grid: { rows: 2, cols: 2 }, modules }
}

describe('validateLayout — structural invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a full valid layout with null references', async () => {
    const layout = layoutOf([
      chatModule({ id: 'a', placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 } }),
      {
        id: 'b',
        type: 'table',
        placement: { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
        config: { tableId: null },
      },
      {
        id: 'c',
        type: 'file',
        placement: { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
        config: { fileId: null },
      },
      formModule([formField()], { id: 'd', placement: { row: 1, col: 1, rowSpan: 1, colSpan: 1 } }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).resolves.toBeUndefined()
  })

  /**
   * How many modules fit is decided by geometry, not by a hard-coded count:
   * a fifth module on a full 2x2 grid has nowhere to go, so it necessarily
   * overlaps one that is already there.
   */
  it('rejects a fifth module on a full 2x2 grid', async () => {
    const layout = layoutOf([
      chatModule({ id: 'a', placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 } }),
      chatModule({ id: 'b', placement: { row: 0, col: 1, rowSpan: 1, colSpan: 1 } }),
      chatModule({ id: 'c', placement: { row: 1, col: 0, rowSpan: 1, colSpan: 1 } }),
      chatModule({ id: 'd', placement: { row: 1, col: 1, rowSpan: 1, colSpan: 1 } }),
      chatModule({ id: 'e', placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 } }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(InterfaceLayoutError)
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(
      /Module "e" .* overlaps module "a"/
    )
  })

  it('rejects more modules than the absolute payload cap allows', async () => {
    const layout = layoutOf(
      Array.from({ length: INTERFACE_LAYOUT_LIMITS.MAX_MODULES + 1 }, (_unused, index) =>
        chatModule({ id: `m${index}`, placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 } })
      )
    )
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(
      new RegExp(`at most ${INTERFACE_LAYOUT_LIMITS.MAX_MODULES} modules`)
    )
  })

  it('rejects duplicate module ids', async () => {
    const layout = layoutOf([
      chatModule({ id: 'dup', placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 } }),
      chatModule({ id: 'dup', placement: { row: 0, col: 1, rowSpan: 1, colSpan: 1 } }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(
      /Module id "dup" is already used/
    )
  })

  it('rejects two modules on the same cell', async () => {
    const layout = layoutOf([
      chatModule({ id: 'a', placement: { row: 1, col: 1, rowSpan: 1, colSpan: 1 } }),
      chatModule({ id: 'b', placement: { row: 1, col: 1, rowSpan: 1, colSpan: 1 } }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(
      /Module "b" at \(row 1, col 1\) overlaps module "a" at \(row 1, col 1\)/
    )
  })

  it('rejects modules whose spans overlap without sharing a corner', async () => {
    const layout = layoutOf([
      chatModule({ id: 'wide', placement: { row: 0, col: 0, rowSpan: 1, colSpan: 2 } }),
      chatModule({ id: 'tall', placement: { row: 0, col: 1, rowSpan: 2, colSpan: 1 } }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(
      /Module "tall" at \(rows 0-1, col 1\) overlaps module "wide" at \(row 0, cols 0-1\)/
    )
  })

  it('rejects a placement outside the layout grid', async () => {
    const layout = layoutOf([
      chatModule({ id: 'a', placement: { row: 2, col: 0, rowSpan: 1, colSpan: 1 } }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(
      /Module "a" at \(row 2, col 0\) does not fit the 2x2 grid/
    )
  })

  it('rejects a span that runs off the layout grid', async () => {
    const layout = layoutOf([
      chatModule({ id: 'a', placement: { row: 0, col: 1, rowSpan: 1, colSpan: 2 } }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(
      /Module "a" at \(row 0, cols 1-2\) does not fit the 2x2 grid/
    )
  })

  it('accepts a module spanning several tracks of its own grid', async () => {
    const layout = layoutOf([
      chatModule({ id: 'a', placement: { row: 0, col: 0, rowSpan: 2, colSpan: 2 } }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).resolves.toBeUndefined()
  })

  it('accepts a placement that only a wider declared grid makes legal', async () => {
    const layout = {
      ...layoutOf([chatModule({ id: 'a', placement: { row: 3, col: 3, rowSpan: 1, colSpan: 1 } })]),
      grid: { rows: 4, cols: 4 },
    }
    await expect(validateLayout(WORKSPACE_ID, layout)).resolves.toBeUndefined()
  })

  it('rejects an unsupported layout version', async () => {
    const layout = { version: 2, modules: [] } as unknown as InterfaceLayout
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(/Unsupported layout version/)
  })

  it('rejects a welcome message over 500 characters', async () => {
    const layout = layoutOf([
      chatModule({
        config: {
          workflowId: null,
          outputConfigs: [],
          showThinking: false,
          welcomeMessage: 'x'.repeat(501),
        },
      }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(/Welcome message must be/)
  })

  it('rejects a module id longer than the id bound', async () => {
    const layout = layoutOf([
      chatModule({ id: 'x'.repeat(INTERFACE_LAYOUT_LIMITS.MAX_ID_LENGTH + 1) }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(/Module id must be/)
  })

  it.each([
    ['an empty submit label', ''],
    ['a whitespace-only submit label', '   '],
  ])('rejects %s the contract would refuse to accept back', async (_label, submitLabel) => {
    const layout = layoutOf([
      formModule([], { config: { workflowId: null, fields: [], submitLabel } }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(/Submit label is required/)
  })

  it('rejects a submit label over the length bound', async () => {
    const layout = layoutOf([
      formModule([], {
        config: {
          workflowId: null,
          fields: [],
          submitLabel: 'x'.repeat(INTERFACE_LAYOUT_LIMITS.MAX_SUBMIT_LABEL_LENGTH + 1),
        },
      }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(/Submit label must be/)
  })

  it('rejects a chat output config with an empty blockId', async () => {
    const layout = layoutOf([
      chatModule({
        config: {
          workflowId: null,
          outputConfigs: [{ blockId: '', path: 'content' }],
          showThinking: false,
          welcomeMessage: '',
        },
      }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(
      /Output blockId cannot be empty/
    )
  })

  it('rejects a chat output path over the length bound', async () => {
    const layout = layoutOf([
      chatModule({
        config: {
          workflowId: null,
          outputConfigs: [
            {
              blockId: 'block-1',
              path: 'x'.repeat(INTERFACE_LAYOUT_LIMITS.MAX_OUTPUT_PATH_LENGTH + 1),
            },
          ],
          showThinking: false,
          welcomeMessage: '',
        },
      }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(/Output path must be/)
  })
})

describe('validateLayout — form field rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    'error',
    'selectedOption',
    'selectedRoute',
    '_pauseMetadata',
    'metadata',
    'input',
    'conversationId',
    'files',
  ])('rejects reserved field name "%s"', async (reserved) => {
    expect(RESERVED_FORM_FIELD_NAMES).toContain(reserved)
    const layout = layoutOf([formModule([formField({ name: reserved })])])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(/is reserved/)
  })

  it('rejects duplicate field names case-insensitively', async () => {
    const layout = layoutOf([
      formModule([formField({ id: 'f1', name: 'Email' }), formField({ id: 'f2', name: 'email' })]),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(
      /Field name "email" is already used/
    )
  })

  it('rejects duplicate field ids', async () => {
    const layout = layoutOf([
      formModule([formField({ id: 'same', name: 'a' }), formField({ id: 'same', name: 'b' })]),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(
      /Field id "same" is already used/
    )
  })

  it.each(['9starts_with_digit', 'has space', 'has-dash', ''])(
    'rejects invalid field name "%s"',
    async (name) => {
      const layout = layoutOf([formModule([formField({ name })])])
      await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(
        /Field name must be a valid identifier|Field name is required/
      )
    }
  )

  it('rejects a dropdown field without options', async () => {
    const layout = layoutOf([formModule([formField({ type: 'dropdown' })])])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(/at least one option/)
  })

  it('accepts a dropdown field with options', async () => {
    const layout = layoutOf([
      formModule([formField({ type: 'dropdown', options: ['low', 'high'] })]),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).resolves.toBeUndefined()
  })

  it('rejects a field id longer than the id bound', async () => {
    const layout = layoutOf([
      formModule([formField({ id: 'x'.repeat(INTERFACE_LAYOUT_LIMITS.MAX_ID_LENGTH + 1) })]),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(/Field id must be/)
  })

  it('rejects a default value over the length bound', async () => {
    const layout = layoutOf([
      formModule([
        formField({
          defaultValue: 'x'.repeat(INTERFACE_LAYOUT_LIMITS.MAX_DEFAULT_VALUE_LENGTH + 1),
        }),
      ]),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(/defaultValue/)
  })

  it('rejects a default value that is neither a string nor a boolean', async () => {
    const layout = layoutOf([formModule([formField({ defaultValue: 42 as unknown as string })])])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(/defaultValue/)
  })

  it('accepts a boolean default value on a switch field', async () => {
    const layout = layoutOf([formModule([formField({ type: 'switch', defaultValue: true })])])
    await expect(validateLayout(WORKSPACE_ID, layout)).resolves.toBeUndefined()
  })

  it('rejects an unknown field type', async () => {
    const layout = layoutOf([formModule([formField({ type: 'rating' as 'short-text' })])])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(/type/)
  })

  it('rejects more than 30 fields', async () => {
    const fields = Array.from({ length: 31 }, (_, i) =>
      formField({ id: `f-${i}`, name: `field_${i}` })
    )
    const layout = layoutOf([formModule(fields)])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(/at most 30 fields/)
  })
})

describe('validateLayout — same-workspace references', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a workflow reference in the same workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'wf-1', workspaceId: WORKSPACE_ID }])
    const layout = layoutOf([
      chatModule({
        config: { workflowId: 'wf-1', outputConfigs: [], showThinking: false, welcomeMessage: '' },
      }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).resolves.toBeUndefined()
  })

  it('rejects a workflow reference from another workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'wf-1', workspaceId: 'other-workspace' }])
    const layout = layoutOf([
      chatModule({
        config: { workflowId: 'wf-1', outputConfigs: [], showThinking: false, welcomeMessage: '' },
      }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(InvalidModuleReferenceError)
  })

  it('rejects a missing workflow reference on a form module', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    const layout = layoutOf([
      formModule([], {
        config: { workflowId: 'wf-gone', fields: [], submitLabel: 'Submit' },
      }),
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(InvalidModuleReferenceError)
  })

  it('rejects a table reference from another workspace', async () => {
    mockGetTableById.mockResolvedValueOnce({ id: 'tbl-1', workspaceId: 'other-workspace' })
    const layout = layoutOf([
      {
        id: 'm',
        type: 'table',
        placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        config: { tableId: 'tbl-1' },
      },
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(InvalidModuleReferenceError)
    expect(mockGetTableById).toHaveBeenCalledWith('tbl-1', { tx: dbChainMock.db })
  })

  it('accepts a table reference in the same workspace', async () => {
    mockGetTableById.mockResolvedValueOnce({ id: 'tbl-1', workspaceId: WORKSPACE_ID })
    const layout = layoutOf([
      {
        id: 'm',
        type: 'table',
        placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        config: { tableId: 'tbl-1' },
      },
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).resolves.toBeUndefined()
  })

  it('rejects a file reference that does not resolve in the workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    const layout = layoutOf([
      {
        id: 'm',
        type: 'file',
        placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        config: { fileId: 'file-1' },
      },
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).rejects.toThrow(InvalidModuleReferenceError)
  })

  it('accepts a file reference in the workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'file-1' }])
    const layout = layoutOf([
      {
        id: 'm',
        type: 'file',
        placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        config: { fileId: 'file-1' },
      },
    ])
    await expect(validateLayout(WORKSPACE_ID, layout)).resolves.toBeUndefined()
  })

  it('skips a reference that the previous layout already contained', async () => {
    const layout = layoutOf([
      {
        id: 'm',
        type: 'table',
        placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        config: { tableId: 'tbl-archived' },
      },
    ])
    await expect(validateLayout(WORKSPACE_ID, layout, layout)).resolves.toBeUndefined()
    expect(mockGetTableById).not.toHaveBeenCalled()
  })

  it('keeps an interface editable after its referenced table is archived', async () => {
    const previous = layoutOf([
      {
        id: 'm',
        type: 'table',
        placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        config: { tableId: 'tbl-archived' },
      },
    ])
    const next = layoutOf([
      {
        id: 'm',
        type: 'table',
        placement: { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
        config: { tableId: 'tbl-archived' },
      },
      chatModule({ id: 'c', placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 } }),
    ])

    await expect(validateLayout(WORKSPACE_ID, next, previous)).resolves.toBeUndefined()
    expect(mockGetTableById).not.toHaveBeenCalled()
  })

  it('still checks a reference the previous layout did not contain', async () => {
    const previous = layoutOf([
      {
        id: 'm',
        type: 'table',
        placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        config: { tableId: 'tbl-old' },
      },
    ])
    const next = layoutOf([
      {
        id: 'm',
        type: 'table',
        placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        config: { tableId: 'tbl-new' },
      },
    ])
    mockGetTableById.mockResolvedValueOnce({ id: 'tbl-new', workspaceId: 'other-workspace' })

    await expect(validateLayout(WORKSPACE_ID, next, previous)).rejects.toThrow(
      InvalidModuleReferenceError
    )
    expect(mockGetTableById).toHaveBeenCalledWith('tbl-new', { tx: dbChainMock.db })
  })

  it('does not grandfather a reference across resource types', async () => {
    const previous = layoutOf([
      {
        id: 'm',
        type: 'table',
        placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        config: { tableId: 'shared-id' },
      },
    ])
    const next = layoutOf([
      {
        id: 'm',
        type: 'file',
        placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        config: { fileId: 'shared-id' },
      },
    ])
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(validateLayout(WORKSPACE_ID, next, previous)).rejects.toThrow(
      InvalidModuleReferenceError
    )
  })

  it('carries the module and reference identifiers on the error', async () => {
    mockGetTableById.mockResolvedValueOnce(null)
    const layout = layoutOf([
      {
        id: 'mod-x',
        type: 'table',
        placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        config: { tableId: 'tbl-x' },
      },
    ])
    try {
      await validateLayout(WORKSPACE_ID, layout)
      expect.unreachable('validateLayout should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidModuleReferenceError)
      const refError = error as InvalidModuleReferenceError
      expect(refError.moduleId).toBe('mod-x')
      expect(refError.refType).toBe('table')
      expect(refError.refId).toBe('tbl-x')
    }
  })
})

/**
 * Callers validate while holding a row lock, so every reference lookup has to
 * run on the handle they pass in. Anything that reaches for the global pool
 * instead checks out a second connection behind an open transaction.
 */
describe('validateLayout — executor threading', () => {
  function fakeExecutor() {
    return { select: vi.fn(() => ({ from: dbChainMockFns.from })) }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards the executor to the table lookup', async () => {
    const executor = fakeExecutor()
    mockGetTableById.mockResolvedValueOnce({ id: 'tbl-1', workspaceId: WORKSPACE_ID })
    const layout = layoutOf([
      {
        id: 'm',
        type: 'table',
        placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        config: { tableId: 'tbl-1' },
      },
    ])

    await expect(
      validateLayout(WORKSPACE_ID, layout, undefined, executor as never)
    ).resolves.toBeUndefined()
    expect(mockGetTableById.mock.calls[0][1]?.tx).toBe(executor)
  })

  it('runs the workflow and file lookups on the executor, not the global pool', async () => {
    const executor = fakeExecutor()
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: 'wf-1', workspaceId: WORKSPACE_ID }])
      .mockResolvedValueOnce([{ id: 'file-1' }])
    const layout = layoutOf([
      chatModule({
        config: { workflowId: 'wf-1', outputConfigs: [], showThinking: false, welcomeMessage: '' },
      }),
      {
        id: 'm-file',
        type: 'file',
        placement: { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
        config: { fileId: 'file-1' },
      },
    ])

    await expect(
      validateLayout(WORKSPACE_ID, layout, undefined, executor as never)
    ).resolves.toBeUndefined()
    expect(executor.select).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('falls back to the global pool when no executor is supplied', async () => {
    mockGetTableById.mockResolvedValueOnce({ id: 'tbl-1', workspaceId: WORKSPACE_ID })
    const layout = layoutOf([
      {
        id: 'm',
        type: 'table',
        placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        config: { tableId: 'tbl-1' },
      },
    ])

    await expect(validateLayout(WORKSPACE_ID, layout)).resolves.toBeUndefined()
    expect(mockGetTableById.mock.calls[0][1]?.tx).toBe(dbChainMock.db)
  })

  it('stops at the first bad reference instead of fanning out concurrent queries', async () => {
    const executor = fakeExecutor()
    mockGetTableById.mockResolvedValueOnce(null)
    const layout = layoutOf([
      {
        id: 'm-table',
        type: 'table',
        placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        config: { tableId: 'tbl-bad' },
      },
      {
        id: 'm-file',
        type: 'file',
        placement: { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
        config: { fileId: 'file-1' },
      },
    ])

    await expect(
      validateLayout(WORKSPACE_ID, layout, undefined, executor as never)
    ).rejects.toThrow(InvalidModuleReferenceError)
    expect(executor.select).not.toHaveBeenCalled()
  })
})
