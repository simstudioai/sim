/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowDiffSummary } from '@/lib/workflows/comparison'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import {
  classifyChange,
  describeListItems,
  formatScalar,
  listBlockChanges,
  listOneSidedFields,
  listOrderChanged,
  maskSecretsDeep,
  pairListItems,
  splitEnvironmentBindings,
  toDiffText,
  toItemList,
  toMessageList,
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

  it('hides a secret-looking field by name when the block definition is unknown', () => {
    declareSubBlocks({})

    expect(classifyChange('vanished', 'apiKey', 'a', 'b')).toBe('secret')
    expect(classifyChange('vanished', 'maxTokens', 1, 2)).toBe('scalar')
  })

  it('reads a definition re-registered under the same type name', () => {
    declareSubBlocks({ agent: [{ id: 'tools', type: 'tool-input' }] })
    expect(classifyChange('agent', 'tools', null, null)).toBe('list')

    declareSubBlocks({ agent: [{ id: 'tools', type: 'long-input' }] })
    expect(classifyChange('agent', 'tools', 'a', 'b')).toBe('text')
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
      {
        key: 'T',
        label: 'T',
        text: JSON.stringify({ extra: 1 }, null, 2),
        signature: JSON.stringify({ extra: 1 }),
      },
      { key: 'Item 4', label: 'Item 4', text: '', signature: '' },
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
      text: JSON.stringify({ server: 's1', params: { query: 'x', apiToken: '•••' } }, null, 2),
      signature: JSON.stringify({ server: 's1', params: { query: 'x', apiToken: 'sk-1' } }),
    })
    /* A custom tool's schema is its implementation, so it stays in the comparable body. */
    expect(items[1]).toMatchObject({
      key: 'lookup',
      label: 'lookup',
      text: JSON.stringify({ schema: { function: { name: 'lookup' } } }, null, 2),
    })
    expect(items[2]).toMatchObject({ key: 'slack_send', label: 'Slack', text: '' })
  })

  it('reports a change to a secret alone without showing either value', () => {
    declareSubBlocks({ agent: [{ id: 'tools', type: 'tool-input' }] })
    const tool = (apiKey: string) => ({ type: 'http', toolId: 'http_call', params: { apiKey } })

    const [before] = describeListItems('agent', 'tools', [tool('old')])
    const [after] = describeListItems('agent', 'tools', [tool('new')])

    expect(before.text).toBe(after.text)
    expect(pairListItems([before], [after], false)).toEqual([
      expect.objectContaining({ kind: 'changed', secretChanged: true }),
    ])
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

describe('maskSecretsDeep', () => {
  it("masks a block tool's params that its block marks as password fields, whatever their name", () => {
    declareSubBlocks({
      agent: [{ id: 'tools', type: 'tool-input' }],
      athena: [
        { id: 'awsAccessKeyId', type: 'short-input', password: true },
        { id: 'awsSecretAccessKey', type: 'short-input', password: true },
        { id: 'region', type: 'short-input' },
      ],
    })
    const [tool] = describeListItems('agent', 'tools', [
      {
        type: 'athena',
        title: 'Athena',
        params: { awsAccessKeyId: 'AKIAEXAMPLE', awsSecretAccessKey: 'shh', region: 'us-east-1' },
      },
    ])

    expect(tool.text).not.toContain('AKIAEXAMPLE')
    expect(tool.text).not.toContain('shh')
    expect(tool.text).toContain('us-east-1')
    expect(tool.signature).toContain('AKIAEXAMPLE')
  })

  it('masks keys that end in a secret noun and leaves ids, counts and limits readable', () => {
    expect(
      maskSecretsDeep({
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

  it('reaches nested objects, arrays and key/value table rows', () => {
    expect(
      maskSecretsDeep({
        headers: { Authorization: 'Bearer x', Accept: 'json' },
        rows: [
          { cells: { Key: 'X-Api-Key', Value: 'k' } },
          { cells: { Key: 'Accept', Value: 'json' } },
        ],
        nested: [{ auth: { token: 't' } }],
      })
    ).toEqual({
      headers: { Authorization: '•••', Accept: 'json' },
      rows: [
        { cells: { Key: 'X-Api-Key', Value: '•••' } },
        { cells: { Key: 'Accept', Value: 'json' } },
      ],
      nested: [{ auth: '•••' }],
    })
    expect(toDiffText({ password: 'p', name: 'n' })).toBe(
      JSON.stringify({ password: '•••', name: 'n' }, null, 2)
    )
  })

  it('masks inside a JSON-encoded string the way tool params are stored', () => {
    const encoded = JSON.stringify({ Authorization: 'Bearer x', Accept: 'json' })
    expect(maskSecretsDeep({ headers: encoded })).toEqual({
      headers: JSON.stringify({ Authorization: '•••', Accept: 'json' }),
    })
    expect(maskSecretsDeep('plain text')).toBe('plain text')
    expect(maskSecretsDeep('{not json')).toBe('{not json')
  })
})

describe('value readers and labels', () => {
  it('reads lists and messages from their stored forms and rejects the rest', () => {
    expect(toItemList([1])).toEqual([1])
    expect(toItemList('[1, 2]')).toEqual([1, 2])
    expect(toItemList('[not json')).toBeNull()
    expect(toItemList('{"a":1}')).toBeNull()
    expect(toMessageList([{ role: 'user', content: 'hi' }])).toEqual([
      { role: 'user', content: 'hi' },
    ])
    expect(toMessageList('[{"role":"system","content":"s"}]')).toEqual([
      { role: 'system', content: 's' },
    ])
    expect(toMessageList('{oops')).toEqual([])
    expect(toMessageList([{ role: 'user' }])).toEqual([])
    expect(toDiffText(null)).toBe('')
    expect(toDiffText('plain')).toBe('plain')
  })

  it('resolves dropdown ids to their labels from static and function options', () => {
    declareSubBlocks({
      agent: [
        { id: 'model', type: 'dropdown', options: [{ id: 'gpt', label: 'GPT' }] },
        { id: 'mode', type: 'dropdown', options: () => [{ id: 'fast', label: 'Fast' }] },
        { id: 'temp', type: 'slider' },
      ],
    })

    expect(formatScalar('agent', 'model', 'gpt')).toBe('GPT')
    expect(formatScalar('agent', 'mode', 'fast')).toBe('Fast')
    expect(formatScalar('agent', 'model', 'unknown')).toBe('unknown')
    expect(formatScalar('agent', 'temp', 0.5)).toBe('0.5')
    /* A comparison never truncates a string, and never prints a nested secret. */
    const long = 'x'.repeat(58)
    expect(formatScalar('agent', 'temp', long)).toBe(long)
    expect(formatScalar('agent', 'temp', { apiKey: 'k' })).toBe('{"apiKey":"•••"}')
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

describe('masked values in text and list fields', () => {
  it('masks secrets inside a JSON-encoded string field', () => {
    const stored = JSON.stringify({ Authorization: 'Bearer live-key', Accept: 'json' })

    expect(toDiffText(stored)).not.toContain('live-key')
    expect(formatScalar('function', 'headers', stored)).not.toContain('live-key')
    expect(toDiffText('plain')).toBe('plain')
  })

  it('reports an input default that changed only inside a secret as a masked change', () => {
    declareSubBlocks({ starter: [{ id: 'inputFormat', type: 'input-format' }] })
    const field = (token: string) =>
      describeListItems('starter', 'inputFormat', [
        { id: 'f', name: 'headers', type: 'object', value: { Authorization: token } },
      ])

    const [old] = field('Bearer a')
    const [next] = field('Bearer b')

    expect(old.text).toBe(next.text)
    expect(pairListItems([old], [next], false)).toMatchObject([
      { kind: 'changed', secretChanged: true },
    ])
  })

  it('tells a reordered list apart from the same items stored differently', () => {
    const a = { key: 'a', label: 'a', text: '1' }
    const b = { key: 'b', label: 'b', text: '2' }

    expect(listOrderChanged([a, b], [b, a])).toBe(true)
    expect(listOrderChanged([a, b], [a, b])).toBe(false)
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
              { field: 'zzz', oldValue: 1, newValue: 2 },
              { field: 'code', oldValue: 'a', newValue: 'b' },
              { field: 'language', oldValue: 'js', newValue: 'py' },
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
      { field: 'loopType', oldValue: null, newValue: 'for' },
      { field: 'iterations', oldValue: null, newValue: 4 },
    ])
  })
})
