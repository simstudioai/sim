/**
 * @vitest-environment node
 */
import {
  generateLoopBlocks,
  generateParallelBlocks,
} from '@sim/workflow-persistence/subflow-helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateWorkflowDiffSummary, type WorkflowDiffSummary } from '@/lib/workflows/comparison'
import {
  classifyChange,
  listBlockChanges,
  listOneSidedFields,
  maskSecretsDeep,
  toDiffText,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/utils'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

/** The global registry mock returns no sub-blocks; tests declare the ones they need per block type. */
function declareSubBlocks(byType: Record<string, Partial<SubBlockConfig>[]>) {
  vi.mocked(getBlock).mockImplementation(
    (type: string) =>
      ({
        name: type,
        description: '',
        icon: () => null,
        subBlocks: byType[type] ?? [],
        outputs: {},
      }) as never
  )
}

function block(id: string, overrides: Partial<BlockState> = {}): BlockState {
  return {
    id,
    type: 'function',
    name: id,
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    ...overrides,
  } as BlockState
}

function summary(overrides: Partial<WorkflowDiffSummary> = {}): WorkflowDiffSummary {
  return {
    addedBlocks: [],
    removedBlocks: [],
    modifiedBlocks: [],
    edgeChanges: { added: 0, removed: 0, addedDetails: [], removedDetails: [] },
    loopChanges: { added: 0, removed: 0, modified: 0 },
    parallelChanges: { added: 0, removed: 0, modified: 0 },
    containerChanges: [],
    variableChanges: {
      added: 0,
      removed: 0,
      modified: 0,
      addedNames: [],
      removedNames: [],
      modifiedNames: [],
    },
    hasChanges: false,
    ...overrides,
  }
}

beforeEach(() => {
  declareSubBlocks({})
})

describe('structured field rendering', () => {
  it('shows a declared secret-access policy while masking actual password values', () => {
    declareSubBlocks({
      function: [
        {
          id: 'secretAccess',
          type: 'dropdown',
          options: [
            { id: 'none', label: 'None' },
            { id: 'all', label: 'All' },
          ],
        },
        { id: 'deployKey', type: 'short-input', password: true },
      ],
    })
    expect(classifyChange('function', 'secretAccess', 'none', 'all')).toBe('scalar')
    expect(classifyChange('function', 'deployKey', 'private-before', 'private-after')).toBe(
      'secret'
    )
  })

  it('keeps order, scalar types and all fields when an ordered list is reordered and edited', () => {
    const before = [
      { id: 'a', model: 'one', temperature: 0 },
      { id: 'b', model: 'two' },
    ]
    const after = [
      { id: 'b', model: 'two' },
      { id: 'a', model: 'one', temperature: 1 },
    ]
    expect(classifyChange('agent', 'fallbackModels', before, after)).toBe('json')
    expect(JSON.parse(toDiffText(before))).toEqual(before)
    expect(JSON.parse(toDiffText(after))).toEqual(after)
    expect(toDiffText([1])).not.toBe(toDiffText(['1']))
  })

  it.each([false, true])(
    'masks declared tool passwords without discarding other params (encoded: %s)',
    (encoded) => {
      declareSubBlocks({
        convex: [
          { id: 'deployKey', type: 'short-input', password: true },
          { id: 'secretAccess', type: 'dropdown' },
        ],
      })
      const stored = (params: Record<string, unknown>) =>
        encoded ? JSON.stringify(params) : params
      const tools = [
        {
          type: 'convex',
          customToolId: 'tool-a',
          params: stored({ deployKey: 'private', secretAccess: 'none', query: 'ok' }),
        },
      ]
      const rendered = toDiffText(tools, 'agent', 'tools')
      expect(rendered).not.toContain('private')
      expect(JSON.parse(rendered)).toEqual([
        {
          type: 'convex',
          customToolId: 'tool-a',
          params: stored({ deployKey: '•••', secretAccess: 'none', query: 'ok' }),
        },
      ])
    }
  )

  it('masks nested secrets in objects, encoded JSON and table cells', () => {
    const value = {
      Authorization: 'private',
      nested: [{ client_secret: 'private' }],
      headers: [
        { cells: { Key: 'Authorization', Value: 'private' }, metadata: { token: 'private' } },
      ],
    }
    expect(toDiffText(value)).not.toContain('private')
    expect(toDiffText(JSON.stringify(value))).not.toContain('private')
    expect(maskSecretsDeep({ maxTokens: 10, credentialId: 'ref' })).toEqual({
      maxTokens: 10,
      credentialId: 'ref',
    })
  })

  it('masks secret mapping values and human-readable credential column labels', () => {
    const presentation = [
      { cells: { Field: 'accessToken', Value: 'private-mapping' } },
      { cells: { 'API key': 'private-key', Model: 'model-a' } },
    ]
    expect(maskSecretsDeep(presentation)).toEqual([
      { cells: { Field: 'accessToken', Value: '•••' } },
      { cells: { 'API key': '•••', Model: 'model-a' } },
    ])
  })
})

describe('listOneSidedFields', () => {
  it('keeps block settings separate from same-named integration inputs on either side', () => {
    declareSubBlocks({ function: [{ id: 'enabled', type: 'switch' }] })
    const state = block('node', {
      enabled: false,
      advancedMode: true,
      retry: { enabled: false, maxTries: 3, waitBetweenTriesMs: 100 },
      data: { canonicalModes: { document: 'basic' } },
      subBlocks: { enabled: { id: 'enabled', type: 'switch', value: true } },
    })
    for (const side of ['added', 'removed'] as const) {
      const fields = listOneSidedFields(state, side)
      const valueKey = side === 'added' ? 'newValue' : 'oldValue'
      expect(fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ scope: 'block', field: 'enabled', [valueKey]: false }),
          expect.objectContaining({ scope: 'subblock', field: 'enabled', [valueKey]: true }),
          expect.objectContaining({ scope: 'block', field: 'advancedMode', [valueKey]: true }),
          expect.objectContaining({ scope: 'block', field: 'retry', [valueKey]: state.retry }),
          expect.objectContaining({
            scope: 'block',
            field: 'data.canonicalModes',
            [valueKey]: { document: 'basic' },
          }),
        ])
      )
    }
  })

  it('excludes synthetic tool editor values from added and removed blocks', () => {
    const state = block('agent', {
      type: 'agent',
      subBlocks: {
        'tools-tool-0-deployKey': {
          id: 'tools-tool-0-deployKey',
          type: 'short-input',
          value: 'private-key',
        },
      },
    })
    expect(listOneSidedFields(state, 'added')).toEqual([])
    expect(listOneSidedFields(state, 'removed')).toEqual([])
  })

  it('lists declared fields first, skips blanks, keeps a declared secret and drops an undeclared one', () => {
    declareSubBlocks({
      agent: [
        { id: 'model', type: 'dropdown' },
        { id: 'apiKey', type: 'short-input', password: true },
        { id: 'prompt', type: 'long-input' },
      ],
    })
    const state = block('a1', {
      type: 'agent',
      subBlocks: {
        prompt: { id: 'prompt', type: 'long-input', value: 'hello' },
        model: { id: 'model', type: 'dropdown', value: 'gpt' },
        apiKey: { id: 'apiKey', type: 'short-input', value: 'sk' },
        temperature: { id: 'temperature', type: 'slider', value: 0 },
        emptyList: { id: 'emptyList', type: 'tool-input', value: [] },
        emptyObject: { id: 'emptyObject', type: 'code', value: {} },
        blank: { id: 'blank', type: 'short-input', value: '' },
        botToken: { id: 'botToken', type: 'short-input', value: 'xoxb' },
      },
    })

    expect(listOneSidedFields(state, 'added')).toEqual([
      { scope: 'subblock', field: 'model', oldValue: undefined, newValue: 'gpt' },
      { scope: 'subblock', field: 'apiKey', oldValue: undefined, newValue: 'sk' },
      { scope: 'subblock', field: 'prompt', oldValue: undefined, newValue: 'hello' },
      { scope: 'subblock', field: 'temperature', oldValue: undefined, newValue: 0 },
    ])
    expect(listOneSidedFields(state, 'removed')[0]).toEqual({
      scope: 'subblock',
      field: 'model',
      oldValue: 'gpt',
      newValue: undefined,
    })
  })
})

describe('listBlockChanges', () => {
  it("uses each version's names for moved members and added or removed containers", () => {
    const baseBlocks = {
      source: block('source', { type: 'loop', name: 'Original source' }),
      destination: block('destination', { type: 'parallel', name: 'Original destination' }),
      mover: block('mover', { name: 'Original member', data: { parentId: 'source' } }),
      removedWrapper: block('removedWrapper', { type: 'loop', name: 'Removed wrapper' }),
      survivor: block('survivor', {
        name: 'Original survivor',
        data: { parentId: 'removedWrapper' },
      }),
    }
    const targetBlocks = {
      source: block('source', { type: 'loop', name: 'Renamed source' }),
      destination: block('destination', { type: 'parallel', name: 'Renamed destination' }),
      mover: block('mover', { name: 'Renamed member', data: { parentId: 'destination' } }),
      addedWrapper: block('addedWrapper', { type: 'parallel', name: 'Added wrapper' }),
      survivor: block('survivor', { name: 'Renamed survivor', data: { parentId: 'addedWrapper' } }),
    }
    const base: WorkflowState = {
      blocks: baseBlocks,
      edges: [],
      loops: generateLoopBlocks(baseBlocks),
      parallels: generateParallelBlocks(baseBlocks),
    }
    const target: WorkflowState = {
      blocks: targetBlocks,
      edges: [],
      loops: generateLoopBlocks(targetBlocks),
      parallels: generateParallelBlocks(targetBlocks),
    }
    const entries = listBlockChanges(
      generateWorkflowDiffSummary(target, base),
      baseBlocks,
      targetBlocks,
      { base, target }
    )
    const byId = new Map(entries.map((entry) => [entry.id, entry]))
    expect(byId.get('mover')?.moved).toEqual({
      outOf: 'Original source',
      into: 'Renamed destination',
    })
    expect(byId.get('source')?.membership?.removed).toEqual([
      { name: 'Original member', moved: true },
    ])
    expect(byId.get('destination')?.membership?.added).toEqual([
      { name: 'Renamed member', moved: true },
    ])
    expect(byId.get('removedWrapper')?.membership?.removed).toEqual([
      { name: 'Original survivor', moved: true },
    ])
    expect(byId.get('addedWrapper')?.membership?.added).toEqual([
      { name: 'Renamed survivor', moved: true },
    ])
  })

  it('orders modified, added, removed and nests children under an added or removed container', () => {
    const baseBlocks = {
      keep: block('keep', { subBlocks: { code: { id: 'code', type: 'code', value: 'a' } } }),
      oldLoop: block('oldLoop', { type: 'loop', name: 'Old Loop' }),
      oldChild: block('oldChild', { data: { parentId: 'oldLoop' } }),
    }
    const targetBlocks = {
      keep: block('keep', { subBlocks: { code: { id: 'code', type: 'code', value: 'b' } } }),
      newPar: block('newPar', { type: 'parallel', name: 'New Par' }),
      newChild: block('newChild', { data: { parentId: 'newPar' } }),
      mover: block('mover', { data: { parentId: 'newPar' } }),
    }
    const diff = summary({
      addedBlocks: [
        { id: 'newChild', type: 'function', name: 'newChild' },
        { id: 'newPar', type: 'parallel', name: 'New Par' },
        { id: 'mover', type: 'function', name: 'mover' },
      ],
      removedBlocks: [
        { id: 'oldLoop', type: 'loop', name: 'Old Loop' },
        { id: 'oldChild', type: 'function', name: 'oldChild' },
      ],
      modifiedBlocks: [
        {
          id: 'keep',
          type: 'function',
          name: '',
          changes: [{ scope: 'subblock', field: 'code', oldValue: 'a', newValue: 'b' }],
        },
      ],
      hasChanges: true,
    })

    const entries = listBlockChanges(diff, baseBlocks, targetBlocks)

    expect(entries.map((entry) => [entry.id, entry.status])).toEqual([
      ['keep', 'modified'],
      ['newPar', 'added'],
      ['oldLoop', 'removed'],
    ])
    expect(entries[0].name).toBe('function')
    /* Field rows follow the definition order; fields it never declared trail. */
    declareSubBlocks({
      function: [
        { id: 'language', type: 'dropdown' },
        { id: 'code', type: 'code' },
      ],
    })
    const ordered = listBlockChanges(
      summary({
        modifiedBlocks: [
          {
            id: 'keep',
            type: 'function',
            name: 'keep',
            changes: [
              { scope: 'subblock', field: 'zzz', oldValue: 1, newValue: 2 },
              { scope: 'subblock', field: 'code', oldValue: 'a', newValue: 'b' },
              { scope: 'subblock', field: 'language', oldValue: 'js', newValue: 'py' },
            ],
          },
        ],
        hasChanges: true,
      }),
      baseBlocks,
      targetBlocks
    )
    expect(ordered[0].changes.map((change) => change.field)).toEqual(['language', 'code', 'zzz'])
    expect(entries[1].children.map((child) => child.id).sort()).toEqual(['mover', 'newChild'])
    expect(entries[1].membership).toBeUndefined()
    expect(entries[2].children.map((child) => child.id)).toEqual(['oldChild'])
  })

  it('reads a moved block and container membership from the sides, flagging survivors', () => {
    const baseBlocks = {
      loop1: block('loop1', { type: 'loop', name: 'Loop' }),
      inside: block('inside', { data: { parentId: 'loop1' } }),
      outside: block('outside'),
      gone: block('gone', { name: 'Gone', data: { parentId: 'loop1' } }),
    }
    const targetBlocks = {
      loop1: block('loop1', { type: 'loop', name: 'Loop' }),
      inside: block('inside'),
      outside: block('outside', { data: { parentId: 'loop1' } }),
      fresh: block('fresh', { name: 'Fresh', data: { parentId: 'loop1' } }),
      wrapper: block('wrapper', { type: 'parallel', name: 'Wrapper' }),
      survivor: block('survivor', { name: 'Survivor', data: { parentId: 'wrapper' } }),
    }
    const diff = summary({
      addedBlocks: [
        { id: 'fresh', type: 'function', name: 'Fresh' },
        { id: 'wrapper', type: 'parallel', name: 'Wrapper' },
      ],
      removedBlocks: [{ id: 'gone', type: 'function', name: 'Gone' }],
      containerChanges: [
        {
          id: 'loop1',
          kind: 'loop',
          name: 'Loop',
          changes: [{ field: 'iterations', oldValue: 1, newValue: 2 }],
          nodesAdded: ['outside', 'fresh'],
          nodesRemoved: ['inside', 'gone'],
        },
        /* An added container's own change is folded into its added entry, not listed twice. */
        {
          id: 'wrapper',
          kind: 'parallel',
          changes: [],
          nodesAdded: ['survivor'],
          nodesRemoved: [],
        },
      ],
      hasChanges: true,
    })

    const entries = listBlockChanges(diff, baseBlocks, targetBlocks)
    const byId = new Map(entries.map((entry) => [entry.id, entry]))

    expect([...byId.keys()]).toEqual(['inside', 'outside', 'loop1', 'fresh', 'wrapper', 'gone'])
    expect(byId.get('inside')).toMatchObject({ status: 'modified', moved: { outOf: 'Loop' } })
    expect(byId.get('outside')).toMatchObject({ status: 'modified', moved: { into: 'Loop' } })
    expect(byId.get('loop1')).toMatchObject({
      status: 'modified',
      changes: [{ field: 'iterations', oldValue: 1, newValue: 2 }],
      membership: {
        added: [
          { name: 'outside', moved: true },
          { name: 'Fresh', moved: false },
        ],
        removed: [
          { name: 'inside', moved: true },
          { name: 'Gone', moved: false },
        ],
      },
    })
    expect(byId.get('wrapper')).toMatchObject({
      status: 'added',
      changes: [],
      children: [],
      membership: { added: [{ name: 'Survivor', moved: true }], removed: [] },
    })
    /* The survivor is not itself in the diff, so it only appears under its wrapper. */
    expect(byId.has('survivor')).toBe(false)
  })
})

describe('listBlockChanges container settings', () => {
  it("gives an added loop's card its iteration settings from the loop config", () => {
    const target = { loop1: block('loop1', { type: 'loop' }) }
    const containers = {
      base: { loops: {}, parallels: {} },
      target: {
        loops: { loop1: { id: 'loop1', nodes: [], loopType: 'for', iterations: 4 } },
        parallels: {},
      },
    } as unknown as {
      base: Pick<WorkflowState, 'loops' | 'parallels'>
      target: Pick<WorkflowState, 'loops' | 'parallels'>
    }

    const [entry] = listBlockChanges(
      summary({ addedBlocks: [{ id: 'loop1', type: 'loop', name: 'loop1' }], hasChanges: true }),
      {},
      target,
      containers
    )

    expect(entry.changes).toEqual([
      { scope: 'container', field: 'loopType', oldValue: null, newValue: 'for' },
      { scope: 'container', field: 'iterations', oldValue: null, newValue: 4 },
    ])
  })
})
