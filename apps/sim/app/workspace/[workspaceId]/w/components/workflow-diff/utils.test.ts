/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowDiffSummary } from '@/lib/workflows/comparison'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'
import {
  classifyChange,
  describeListItems,
  listBlockChanges,
  listOneSidedFields,
  maskSecretParams,
  omitPresentationChanges,
  pairListItems,
  splitEnvironmentBindings,
} from './utils'

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

describe('classifyChange', () => {
  it('reads the block definition first and falls back to the value shapes', () => {
    declareSubBlocks({
      agent: [
        { id: 'apiKey', type: 'short-input', password: true },
        { id: 'messages', type: 'messages-input' },
        { id: 'tools', type: 'tool-input' },
        { id: 'systemPrompt', type: 'long-input' },
      ],
    })
    const messages = [{ role: 'user', content: 'hi' }]

    expect(classifyChange('agent', 'apiKey', 'a', 'b')).toBe('secret')
    expect(classifyChange('agent', 'messages', 'x', 'y')).toBe('messages')
    expect(classifyChange('agent', 'tools', null, null)).toBe('list')
    expect(classifyChange('agent', 'systemPrompt', 'a', 'b')).toBe('text')
    /* Undeclared fields classify by what the values look like. */
    expect(classifyChange('agent', 'unknown', messages, null)).toBe('messages')
    expect(classifyChange('agent', 'unknown', '[1]', [2])).toBe('list')
    expect(classifyChange('agent', 'unknown', false, true)).toBe('toggle')
    expect(classifyChange('agent', 'unknown', 'one\ntwo', 'one')).toBe('text')
    expect(classifyChange('agent', 'unknown', 'x'.repeat(61), 'y')).toBe('text')
    expect(classifyChange('agent', 'unknown', null, { a: 1 })).toBe('json')
    expect(classifyChange('agent', 'unknown', 'gpt-4o', 'gpt-4.1')).toBe('scalar')
    expect(classifyChange('agent', 'unknown', 1, 2)).toBe('scalar')
  })

  it('treats a checkbox group that persists a record of flags as json, not as a list', () => {
    declareSubBlocks({ jina: [{ id: 'options', type: 'checkbox-list' }] })

    expect(classifyChange('jina', 'options', { noCache: false }, { noCache: true })).toBe('json')
    expect(classifyChange('jina', 'options', null, ['a'])).toBe('list')
  })
})

describe('describeListItems', () => {
  it('labels conditions and routes by position and everything else by name', () => {
    declareSubBlocks({
      condition: [{ id: 'conditions', type: 'condition-input' }],
      router_v2: [{ id: 'routes', type: 'router-input' }],
      starter: [{ id: 'inputFormat', type: 'input-format' }],
    })

    expect(
      describeListItems('condition', 'conditions', [
        { id: 'c-if', value: 'a' },
        { id: 'c-elif', value: 'b' },
        { value: 'c' },
      ])
    ).toEqual([
      { key: 'c-if', label: 'if', text: 'a' },
      { key: 'c-elif', label: 'else if', text: 'b' },
      { key: 'cond-2', label: 'else', text: 'c' },
    ])
    expect(describeListItems('router_v2', 'routes', [{ id: 'r1', value: 'go left' }])).toEqual([
      { key: 'r1', label: 'Route 1', text: 'go left' },
    ])
    expect(
      describeListItems('starter', 'inputFormat', [
        { name: 'email', type: 'string', description: 'Address' },
        { type: 'number' },
      ])
    ).toEqual([
      { key: 'email', label: 'email', text: 'string · Address' },
      { key: 'Field 2', label: 'Field 2', text: 'number' },
    ])
    expect(describeListItems('other', 'tags', ['a', 42, { title: 'T', extra: 1 }, {}])).toEqual([
      { key: 'a', label: 'a', text: '' },
      { key: '42', label: '42', text: '' },
      { key: 'T', label: 'T', text: JSON.stringify({ extra: 1 }, null, 2) },
      { key: 'Item 4', label: 'Item 4', text: '' },
    ])
  })

  it('names tools by server tool, custom tool or type, and masks secret params', () => {
    declareSubBlocks({ agent: [{ id: 'tools', type: 'tool-input' }] })

    const items = describeListItems('agent', 'tools', [
      {
        type: 'mcp',
        title: 'ignored',
        params: { serverId: 's1', toolName: 'search_docs', query: 'x', apiToken: 'sk-1' },
      },
      { type: 'custom-tool', schema: { function: { name: 'lookup' } }, params: {} },
      { type: 'slack', toolId: 'slack_send', title: 'Slack' },
    ])

    expect(items[0]).toEqual({
      key: 'search_docs',
      label: 'search_docs',
      text: JSON.stringify({ params: { query: 'x', apiToken: '•••' } }, null, 2),
    })
    /* A custom tool's schema is its implementation, so it stays in the comparable body. */
    expect(items[1]).toEqual({
      key: 'lookup',
      label: 'lookup',
      text: JSON.stringify({ schema: { function: { name: 'lookup' } } }, null, 2),
    })
    expect(items[2]).toEqual({ key: 'slack_send', label: 'Slack', text: '' })
  })

  it('keeps what a tool may do in its body so a permission change is not an order change', () => {
    declareSubBlocks({ agent: [{ id: 'tools', type: 'tool-input' }] })
    const tool = (usageControl: string) => ({
      type: 'slack',
      toolId: 'slack_send',
      title: 'Slack',
      usageControl,
      isExpanded: true,
    })

    const [before] = describeListItems('agent', 'tools', [tool('none')])
    const [after] = describeListItems('agent', 'tools', [tool('auto')])

    expect(before.text).toBe(JSON.stringify({ usageControl: 'none' }, null, 2))
    expect(pairListItems([before], [after], false)).toEqual([
      expect.objectContaining({ kind: 'changed', label: 'Slack' }),
    ])
  })

  it('includes an input field default so a changed default is visible', () => {
    declareSubBlocks({ starter: [{ id: 'inputFormat', type: 'input-format' }] })

    expect(
      describeListItems('starter', 'inputFormat', [{ name: 'limit', type: 'number', value: 10 }])
    ).toEqual([{ key: 'limit', label: 'limit', text: 'number · default 10' }])
  })
})

describe('pairListItems', () => {
  const item = (key: string, label: string, text: string) => ({ key, label, text })

  it('pairs by key, then by identical body, then by position for branch lists', () => {
    expect(pairListItems([item('a', 'Route 1', 'x')], [item('b', 'Route 1', 'x')], true)).toEqual(
      []
    )
    expect(pairListItems([item('a', 'if', '1')], [item('b', 'if', '2')], true)).toEqual([
      { kind: 'changed', label: 'if', oldText: '1', newText: '2' },
    ])
    expect(pairListItems([item('a', 'T', '1')], [item('b', 'T', '2')], false)).toEqual([
      { kind: 'added', label: 'T', oldText: '', newText: '2' },
      { kind: 'removed', label: 'T', oldText: '1', newText: '' },
    ])
    expect(pairListItems([item('a', 'else if', 'x')], [item('a', 'else', 'x')], true)).toEqual([
      { kind: 'changed', label: 'else', oldLabel: 'else if', oldText: 'x', newText: 'x' },
    ])
  })
})

describe('maskSecretParams', () => {
  it('masks keys that end in a secret noun and leaves ids, counts and limits readable', () => {
    expect(
      maskSecretParams({
        apiKey: 'k',
        api_key: 'k',
        accessToken: 'k',
        clientSecret: 'k',
        password: 'p',
        privateKey: 'p',
        credential: 'c',
        credentialId: 'c',
        maxTokens: 1000,
        tokenLimit: 5,
        emptyToken: '',
        nullSecret: null,
        query: 'keep',
        count: 2,
      })
    ).toEqual({
      apiKey: '•••',
      api_key: '•••',
      accessToken: '•••',
      clientSecret: '•••',
      password: '•••',
      privateKey: '•••',
      credential: '•••',
      credentialId: 'c',
      maxTokens: 1000,
      tokenLimit: 5,
      emptyToken: '',
      nullSecret: null,
      query: 'keep',
      count: 2,
    })
  })
})

describe('splitEnvironmentBindings', () => {
  it('sets workspace-bound fields apart by name, password flag or selector type', () => {
    declareSubBlocks({
      slack: [
        { id: 'channel', type: 'channel-selector' },
        { id: 'token', type: 'short-input', password: true },
        { id: 'message', type: 'long-input' },
      ],
    })
    const changes = [
      { field: 'credential' },
      { field: 'webhookPath' },
      { field: 'channel' },
      { field: 'token' },
      { field: 'message' },
      { field: 'undeclared' },
    ]

    expect(splitEnvironmentBindings('slack', changes)).toEqual({
      logic: [{ field: 'message' }, { field: 'undeclared' }],
      bindings: [
        { field: 'credential' },
        { field: 'webhookPath' },
        { field: 'channel' },
        { field: 'token' },
      ],
    })
  })
})

describe('listOneSidedFields', () => {
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
      { field: 'model', oldValue: undefined, newValue: 'gpt' },
      { field: 'apiKey', oldValue: undefined, newValue: 'sk' },
      { field: 'prompt', oldValue: undefined, newValue: 'hello' },
      { field: 'temperature', oldValue: undefined, newValue: 0 },
    ])
    expect(listOneSidedFields(state, 'removed')[0]).toEqual({
      field: 'model',
      oldValue: 'gpt',
      newValue: undefined,
    })
  })
})

describe('omitPresentationChanges', () => {
  it('hides presentation-only rows, drops blocks left empty and recomputes hasChanges', () => {
    const only = summary({
      modifiedBlocks: [
        {
          id: 'a',
          type: 'function',
          name: 'a',
          changes: [
            { field: 'horizontalHandles', oldValue: true, newValue: false },
            { field: 'tools.properties', oldValue: {}, newValue: {} },
          ],
        },
        {
          id: 'b',
          type: 'function',
          name: 'b',
          changes: [
            { field: 'horizontalHandles', oldValue: true, newValue: false },
            { field: 'code', oldValue: 'x', newValue: 'y' },
          ],
        },
      ],
      hasChanges: true,
    })

    const next = omitPresentationChanges(only)

    expect(next.modifiedBlocks).toEqual([
      {
        id: 'b',
        type: 'function',
        name: 'b',
        changes: [{ field: 'code', oldValue: 'x', newValue: 'y' }],
      },
    ])
    expect(next.hasChanges).toBe(true)

    /* The basic/advanced mode decides which stored value executes, so it is never hidden. */
    const modeOnly = summary({
      modifiedBlocks: [
        {
          id: 'c',
          type: 'slack',
          name: 'c',
          changes: [
            { field: 'data.canonicalModes', oldValue: {}, newValue: { channel: 'advanced' } },
          ],
        },
      ],
      hasChanges: true,
    })
    expect(omitPresentationChanges(modeOnly).modifiedBlocks).toHaveLength(1)

    const presentationOnly = summary({
      modifiedBlocks: [only.modifiedBlocks[0]],
      hasChanges: true,
    })
    expect(omitPresentationChanges(presentationOnly)).toMatchObject({
      modifiedBlocks: [],
      hasChanges: false,
    })
    expect(
      omitPresentationChanges(
        summary({
          modifiedBlocks: [only.modifiedBlocks[0]],
          edgeChanges: { added: 1, removed: 0, addedDetails: [], removedDetails: [] },
          hasChanges: true,
        })
      ).hasChanges
    ).toBe(true)
  })
})

describe('listBlockChanges', () => {
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
      /* Survived the diff but now sits inside the new container. */
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
          changes: [{ field: 'code', oldValue: 'a', newValue: 'b' }],
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
