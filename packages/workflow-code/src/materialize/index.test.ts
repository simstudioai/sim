import { omit } from '@sim/utils/object'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { canonicalEquals } from '../equivalence'
import type { WorkflowLockV1 } from '../lock'
import type { CanonicalWorkflow } from '../model'
import type { MaterializeOptions } from '.'
import { materialize } from '.'
import {
  blockState,
  CATALOG,
  canonical,
  draftOf,
  edge,
  fixtureHooks,
  lockFor,
  RESOURCES,
  workflowState,
} from './fixtures.test-helpers'
import { QUIRK_STATES } from './quirks.test-helpers'

function run(
  workflow: CanonicalWorkflow,
  lock: WorkflowLockV1 | null,
  options: Partial<MaterializeOptions> = {}
) {
  return materialize(workflow, lock, {
    catalog: CATALOG,
    hooks: fixtureHooks(),
    resources: RESOURCES,
    lockFreshness: lock ? 'fresh' : 'none',
    ...options,
  })
}

function codes(result: { diagnostics: Array<{ code: string }> }): string[] {
  return result.diagnostics.map((d) => d.code)
}

function subBlockValue(state: WorkflowState, blockId: string, subBlockId: string): unknown {
  return state.blocks[blockId]?.subBlocks[subBlockId]?.value
}

function edit(workflow: CanonicalWorkflow, change: (draft: CanonicalWorkflow) => void) {
  const draft: CanonicalWorkflow = draftOf(workflow)
  change(draft)
  return draft
}

describe('materialize O1: a no-op round trip writes prev back exactly', () => {
  for (const [name, state] of QUIRK_STATES) {
    it(`lockless, quirk ${name}`, () => {
      const result = run(canonical(state).workflow, null, { prev: state })
      expect(result.state).toStrictEqual(state)
      expect(result.entries.every((entry) => entry.status === 'matched')).toBe(true)
      expect(codes(result)).toEqual([])
    })

    it(`with a fresh lock, quirk ${name}`, () => {
      const lock = lockFor(state)
      const result = run(canonical(state, lock).workflow, lock, { prev: state })
      expect(result.state).toStrictEqual(state)
      expect(result.identity).toStrictEqual(canonical(state, lock).identity)
    })
  }

  it('returns prev block objects by reference when nothing changed', () => {
    const [, state] = QUIRK_STATES[3]
    const result = run(canonical(state).workflow, null, { prev: state })
    for (const [id, stored] of Object.entries(state.blocks)) {
      expect(result.state.blocks[id]).toBe(stored)
    }
    expect(result.state.edges.every((stored, i) => stored === state.edges[i])).toBe(true)
  })
})

describe('materialize O3: canonicalize(materialize(c)) equals c', () => {
  for (const [name, state] of QUIRK_STATES) {
    it(`with no prev (every block new), quirk ${name}`, () => {
      const c = canonical(state).workflow
      const result = run(c, null)
      expect(canonicalEquals(canonical(result.state).workflow, c)).toBe(true)
    })
  }

  it('holds after edits to params, modes, tools, branches, subflows and edges', () => {
    const state = workflowState(
      [
        blockState('start', 'start_trigger', 'Start', {
          inputFormat: [{ id: 'f-q', name: 'question', type: 'string' }],
        }),
        blockState('a1', 'agent', 'Agent', {
          tools: JSON.stringify([{ type: 'slack', params: { channel: 'C1' } }]),
        }),
        blockState('c1', 'condition', 'Gate', {
          conditions: JSON.stringify([
            { id: 'c1-if', title: 'if', value: 'a' },
            { id: 'c1-else', title: 'else', value: '' },
          ]),
        }),
        blockState('l1', 'loop', 'Each', {}, { data: { loopType: 'for', count: 2 } }),
        blockState(
          'f1',
          'function',
          'Work',
          { code: 'x' },
          { data: { parentId: 'l1', extent: 'parent' } }
        ),
      ],
      {
        edges: [
          edge('e1', 'start', 'a1'),
          edge('e2', 'a1', 'c1'),
          edge('e3', 'c1', 'l1', 'condition-c1-if'),
        ],
        loops: { l1: { id: 'l1', nodes: ['f1'], iterations: 2, loopType: 'for', enabled: true } },
      }
    )
    const base = canonical(state).workflow
    const target = edit(base, (draft) => {
      draft.blocks.start.params.inputFormat = {
        kind: 'value',
        value: [
          { name: 'question', type: 'string' },
          { name: 'topic', type: 'string' },
        ],
      }
      const tools = draft.blocks.agent.params.tools
      if (tools.kind === 'tools') {
        tools.tools[0].params.manualChannel = 'C2'
        tools.tools[0].modes.channel = 'advanced'
        tools.tools.push({
          type: 'slack',
          params: { notify: true },
          modes: { channel: 'advanced', oauthCredential: 'basic' },
        })
      }
      draft.blocks.gate.branches = {
        kind: 'condition',
        rows: [
          { key: 'if', value: 'a' },
          { key: 'urgent', value: 'b', titleOverride: 'urgent' },
          { key: 'else', value: '' },
        ],
      }
      draft.blocks.each.subflow = {
        kind: 'loop',
        loopType: 'forEach',
        iterations: 2,
        forEachItems: [1, 2],
      }
      draft.blocks.work.parent = null
      draft.edges.push({ from: 'gate', port: { kind: 'branch', key: 'urgent' }, to: 'work' })
    })
    const result = run(target, null, { prev: state })
    expect(canonicalEquals(canonical(result.state).workflow, target)).toBe(true)
    expect(result.state.loops.l1.nodes).toEqual([])
    expect(result.state.loops.l1.forEachItems).toEqual([1, 2])
    expect(result.state.blocks.l1.data?.collection).toEqual([1, 2])
  })
})

describe('materialize: params keep prev bytes unless they changed', () => {
  it('re-encodes only the changed param, in prev raw encoding', () => {
    const state = workflowState([
      blockState('k1', 'knowledge', 'KB', {
        tagFilters: ' [ {"tagName":"a"} ] ',
        knowledgeBaseIds: ['kb-1'],
      }),
      blockState('k2', 'knowledge', 'KB2', { tagFilters: [{ tagName: 'a' }] }),
    ])
    const target = edit(canonical(state).workflow, (draft) => {
      draft.blocks.kb.params.tagFilters = { kind: 'value', value: [{ tagName: 'b' }] }
      draft.blocks.kb2.params.tagFilters = { kind: 'value', value: [{ tagName: 'b' }] }
    })
    const result = run(target, null, { prev: state })
    expect(subBlockValue(result.state, 'k1', 'tagFilters')).toBe('[{"tagName":"b"}]')
    expect(subBlockValue(result.state, 'k2', 'tagFilters')).toEqual([{ tagName: 'b' }])
    expect(result.state.blocks.k1.subBlocks.knowledgeBaseIds).toBe(
      state.blocks.k1.subBlocks.knowledgeBaseIds
    )
  })

  it('uses catalog storage for a param prev never stored, and writes a removed param as null', () => {
    const state = workflowState([blockState('k1', 'knowledge', 'KB', { knowledgeBaseIds: 'kb-1' })])
    const target = edit(canonical(state).workflow, (draft) => {
      draft.blocks.kb.params.tagFilters = { kind: 'value', value: [{ tagName: 'b' }] }
      draft.blocks.kb.params = omit(draft.blocks.kb.params, ['knowledgeBaseIds'])
    })
    const result = run(target, null, { prev: state })
    expect(subBlockValue(result.state, 'k1', 'tagFilters')).toBe('[{"tagName":"b"}]')
    expect(result.state.blocks.k1.subBlocks.knowledgeBaseIds).toEqual({
      id: 'knowledgeBaseIds',
      type: 'knowledge-base-selector',
      value: null,
    })
  })

  it('writes resource keys back as ids and reports a key the workspace does not have', () => {
    const state = workflowState([blockState('k1', 'knowledge', 'KB', { knowledgeBaseIds: 'kb-1' })])
    const target = edit(canonical(state).workflow, (draft) => {
      draft.blocks.kb.params.knowledgeBaseIds = {
        kind: 'value',
        value: [
          { $sim: 'resource', kind: 'knowledge-base', key: 'knowledge-base:kb-2' },
          { $sim: 'resource', kind: 'knowledge-base', key: 'nope' },
        ],
      }
    })
    const result = run(target, null, { prev: state })
    expect(subBlockValue(result.state, 'k1', 'knowledgeBaseIds')).toEqual(['kb-2', 'nope'])
    expect(codes(result)).toEqual(['E_MAT_UNKNOWN_RESOURCE'])
  })

  it('recomputes stored outputs when an edit changes what they derive from', () => {
    const state = workflowState([
      blockState('g1', 'gmail', 'Mail', { operation: 'send' }, { outputs: {} }),
    ])
    const target = edit(canonical(state).workflow, (draft) => {
      draft.blocks.mail.triggerMode = true
    })
    const result = run(target, null, { prev: state })
    expect(result.state.blocks.g1.outputs).toEqual({
      computed: { type: 'string', description: 'gmail:true' },
    })
  })

  it('writes a mode entry only where one existed or inference would differ', () => {
    const state = workflowState([
      blockState(
        's1',
        'slack',
        'Explicit',
        { operation: 'send', channel: 'C1' },
        {
          data: { canonicalModes: { channel: 'basic' } },
        }
      ),
      blockState('s2', 'slack', 'Bare', { operation: 'send', channel: 'C1' }),
    ])
    const target = edit(canonical(state).workflow, (draft) => {
      draft.blocks.explicit.params.manualChannel = { kind: 'value', value: '<start.channel>' }
      draft.blocks.explicit.modes.channel = 'advanced'
      draft.blocks.bare.params.manualChannel = { kind: 'value', value: 'C2' }
      draft.blocks.bare.params.threadTs = { kind: 'value', value: '1' }
    })
    const result = run(target, null, { prev: state })
    expect(result.state.blocks.s1.data?.canonicalModes).toEqual({ channel: 'advanced' })
    expect(result.state.blocks.s2.data?.canonicalModes).toBeUndefined()
  })

  it('pins a mode on a new block when the written values would infer the other one', () => {
    const state = workflowState([
      blockState('s2', 'slack', 'Bare', { operation: 'send', channel: 'C1' }),
    ])
    const target = edit(canonical(state).workflow, (draft) => {
      draft.blocks.bare.params = omit(draft.blocks.bare.params, ['channel'])
      draft.blocks.bare.params.manualChannel = { kind: 'value', value: 'C2' }
      draft.blocks.bare.modes.channel = 'basic'
    })
    const result = run(target, null)
    const written = Object.values(result.state.blocks)[0]
    expect(written.subBlocks.manualChannel?.value).toBe('C2')
    expect(written.data?.canonicalModes).toEqual({ channel: 'basic' })
  })

  it('re-indexes tool modes by position and drops the legacy type key when a tool list changes', () => {
    const [, state] = QUIRK_STATES[2]
    const target = edit(canonical(state).workflow, (draft) => {
      const tools = draft.blocks.agent.params.tools
      if (tools.kind === 'tools') tools.tools.splice(0, 1)
    })
    const result = run(target, null, { prev: state })
    const modes = result.state.blocks.a1.data?.canonicalModes ?? {}
    expect(Object.keys(modes).some((key) => key.startsWith('slack:'))).toBe(false)
    expect(modes['0:channel']).toBe('advanced')
    expect(canonicalEquals(canonical(result.state).workflow, target)).toBe(true)
    const stored = JSON.parse(String(subBlockValue(result.state, 'a1', 'tools')))
    expect(stored[0].isExpanded).toBe(false)
  })
})

describe('materialize: tool params', () => {
  it('stores a changed tool param as the text decodeToolParamValue reads back, else natively', () => {
    const state = workflowState([blockState('a1', 'agent', 'Agent', { model: 'gpt-4o' })])
    const target = edit(canonical(state).workflow, (draft) => {
      draft.blocks.agent.params.tools = {
        kind: 'tools',
        tools: [
          {
            type: 'slack',
            toolId: 'slack_message',
            params: { limit: 5, notify: true, channel: 'C1', manualChannel: null },
            modes: { channel: 'basic', oauthCredential: 'basic' },
          },
        ],
      }
    })
    const result = run(target, null, { prev: state })
    const stored = JSON.parse(String(subBlockValue(result.state, 'a1', 'tools')))
    expect(stored[0].params).toEqual({
      limit: 5,
      notify: 'true',
      channel: 'C1',
      manualChannel: null,
    })
    expect(canonicalEquals(canonical(result.state).workflow, target)).toBe(true)
  })
})

describe('materialize: MCP tool binding', () => {
  const pickerTool = (toolId: string) => ({
    type: 'mcp',
    title: 'search',
    toolId,
    params: { serverId: 's1', toolName: 'search', serverName: 'Docs' },
    usageControl: 'auto',
  })

  it('binds the server by key and derives the stored toolId back from it', () => {
    const state = workflowState([
      blockState('a1', 'agent', 'Agent', {
        model: 'gpt-4o',
        tools: JSON.stringify([pickerTool('mcp-s1-search')]),
      }),
    ])
    const c = canonical(state).workflow
    const tools = c.blocks.agent.params.tools
    expect(tools.kind === 'tools' && tools.tools[0]).toMatchObject({
      params: { serverId: { $sim: 'resource', kind: 'mcp-server', key: 'mcp-server:s1' } },
    })
    expect(tools.kind === 'tools' && tools.tools[0].toolId).toBeUndefined()
    const written = Object.values(run(c, null).state.blocks)[0]
    const stored = JSON.parse(String(written.subBlocks.tools?.value))
    expect(stored[0]).toMatchObject({ toolId: 'mcp-s1-search', params: { serverId: 's1' } })
  })

  it('keeps a toolId the binding does not derive', () => {
    const state = workflowState([
      blockState('a1', 'agent', 'Agent', {
        model: 'gpt-4o',
        tools: JSON.stringify([pickerTool('legacy-id')]),
      }),
    ])
    const tools = canonical(state).workflow.blocks.agent.params.tools
    expect(tools.kind === 'tools' && tools.tools[0].toolId).toBe('legacy-id')
  })
})

describe('materialize: branches', () => {
  const state = () => QUIRK_STATES[3][1]

  it('keeps row ids by key across a reorder, and gives a new row a block-prefixed id', () => {
    const target = edit(canonical(state()).workflow, (draft) => {
      const rows = draft.blocks.gate.branches?.rows ?? []
      draft.blocks.gate.branches = {
        kind: 'condition',
        rows: [rows[1], rows[0], { key: 'late', value: 'z' }, rows[3]],
      }
    })
    const result = run(target, null, { prev: state() })
    const stored = JSON.parse(String(subBlockValue(result.state, 'c1', 'conditions')))
    expect(stored.map((row: { id: string }) => row.id)).toEqual([
      'c1-else-if-1700000000',
      'c1-if',
      'c1-new-1',
      'c1-cond-3',
    ])
    expect(stored.map((row: { title?: string }) => row.title)).toEqual([
      'Otherwise if',
      'else if',
      'else if',
      'else',
    ])
    expect(stored[0].key).toBe('elseIf0')
    expect(stored[1].key).toBe('if')
    expect(result.state.edges.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4'])
    expect(canonicalEquals(canonical(result.state).workflow, target)).toBe(true)
  })

  it('stores rows as text even when prev stored an array, and omits a missing title', () => {
    const prev = workflowState([
      blockState('c1', 'condition', 'Gate', {
        conditions: [
          { id: 'c1-if', value: 'a' },
          { id: 'c1-else', title: 'else', value: '' },
        ],
      }),
    ])
    const target = edit(canonical(prev).workflow, (draft) => {
      const rows = draft.blocks.gate.branches?.rows ?? []
      rows[0].value = 'b'
    })
    const result = run(target, null, { prev })
    const raw = subBlockValue(result.state, 'c1', 'conditions')
    expect(typeof raw).toBe('string')
    expect(JSON.parse(String(raw))[0]).toEqual({ id: 'c1-if', value: 'b' })
  })

  it('keeps never-persisted rows null and routes edges to the implicit ids', () => {
    const [, prev] = QUIRK_STATES[4]
    const target = edit(canonical(prev).workflow, (draft) => {
      draft.edges.push({ from: 'gate', port: { kind: 'branch', key: 'else' }, to: 'next' })
    })
    const result = run(target, null, { prev })
    expect(subBlockValue(result.state, 'c1', 'conditions')).toBeUndefined()
    expect(result.state.edges.map((e) => e.sourceHandle)).toEqual([
      'condition-c1-if',
      'condition-c1-else',
    ])
  })
})

describe('materialize: identity', () => {
  const base = () =>
    workflowState(
      [
        blockState('start', 'start_trigger', 'Start', {
          inputFormat: [{ id: 'f-q', name: 'question', type: 'string' }],
        }),
        blockState('a1', 'function', 'Fetch', { code: 'return 1' }),
        blockState('a2', 'function', 'Report', { code: 'return <fetch.result> + <Fetch.x>' }),
      ],
      {
        edges: [edge('e1', 'start', 'a1'), edge('e2', 'a1', 'a2')],
        variables: { 'var-1': { id: 'var-1', name: 'Count', type: 'number', value: 1 } },
      }
    )

  function renameFetch(workflow: CanonicalWorkflow, to = 'Load') {
    return edit(workflow, (draft) => {
      const key = to.toLowerCase()
      draft.blocks[key] = { ...draft.blocks.fetch, key, name: to }
      draft.blocks = omit(draft.blocks, ['fetch'])
      draft.edges = draft.edges.map((e) => ({
        ...e,
        from: e.from === 'fetch' ? key : e.from,
        to: e.to === 'fetch' ? key : e.to,
      }))
    })
  }

  it('keeps the id across a rename matched by lock ident and rewrites <oldkey. references', () => {
    const prev = base()
    const lock = lockFor(prev)
    const target = renameFetch(canonical(prev, lock).workflow)
    const result = run(target, lock, {
      prev,
      compiledIdents: { load: lock.blocks.fetch.ident },
    })
    expect(result.entries).toContainEqual({
      status: 'matched',
      key: 'load',
      id: 'a1',
      via: 'lock-ident',
      renamedFrom: 'Fetch',
    })
    expect(result.state.blocks.a1.name).toBe('Load')
    expect(result.state.blocks.a1.outputs).toBe(prev.blocks.a1.outputs)
    expect(subBlockValue(result.state, 'a2', 'code')).toBe('return <load.result> + <load.x>')
    expect(result.state.edges.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(result.identity.blocks.load.id).toBe('a1')
  })

  it('infers a lockless rename from type, parent and agreeing neighbours, flagged', () => {
    const prev = base()
    const result = run(renameFetch(canonical(prev).workflow), null, { prev })
    expect(result.entries).toContainEqual(
      expect.objectContaining({ status: 'matched', key: 'load', id: 'a1', via: 'inferred' })
    )
    expect(codes(result)).toEqual(['W_MAT_INFERRED_RENAME'])
  })

  it('does not infer a rename when neighbours disagree, or when turned off', () => {
    const prev = base()
    const moved = edit(renameFetch(canonical(prev).workflow), (draft) => {
      draft.edges = draft.edges.filter((e) => e.from !== 'start')
    })
    const disagreeing = run(moved, null, { prev })
    expect(disagreeing.entries).toContainEqual({
      status: 'created',
      key: 'load',
      id: 'new-1',
      idSource: 'minted',
    })
    expect(disagreeing.entries).toContainEqual({ status: 'deleted', key: 'fetch', id: 'a1' })
    const off = run(renameFetch(canonical(prev).workflow), null, { prev, inferRenames: false })
    expect(off.entries).toContainEqual(expect.objectContaining({ status: 'created', key: 'load' }))
  })

  it('treats two renames of one type and parent as ambiguous: delete plus create', () => {
    const prev = workflowState([
      blockState('a1', 'function', 'One', { code: '1' }),
      blockState('a2', 'function', 'Two', { code: '2' }),
    ])
    const target = edit(canonical(prev).workflow, (draft) => {
      draft.blocks.uno = { ...draft.blocks.one, key: 'uno', name: 'Uno' }
      draft.blocks.dos = { ...draft.blocks.two, key: 'dos', name: 'Dos' }
      draft.blocks = omit(draft.blocks, ['one'])
      draft.blocks = omit(draft.blocks, ['two'])
    })
    const result = run(target, null, { prev })
    expect(result.entries.map((entry) => entry.status).sort()).toEqual([
      'created',
      'created',
      'deleted',
      'deleted',
    ])
    expect(codes(result)).not.toContain('W_MAT_INFERRED_RENAME')
  })

  it('never infers a rename under a fresh lock', () => {
    const prev = base()
    const lock = lockFor(prev)
    const result = run(renameFetch(canonical(prev, lock).workflow), lock, { prev })
    expect(result.entries).toContainEqual(
      expect.objectContaining({ status: 'created', key: 'load' })
    )
  })

  it('deletes and creates on a removed block plus an added one', () => {
    const prev = base()
    const target = edit(canonical(prev).workflow, (draft) => {
      draft.blocks = omit(draft.blocks, ['report'])
      draft.edges = draft.edges.filter((e) => e.to !== 'report')
      draft.blocks.notify = {
        key: 'notify',
        name: 'Notify',
        type: 'slack',
        parent: null,
        enabled: true,
        locked: false,
        triggerMode: false,
        advancedMode: false,
        errorPort: false,
        retry: null,
        params: {
          operation: { kind: 'value', value: 'send' },
          text: { kind: 'value', value: '<fetch.result>' },
        },
        modes: { oauthCredential: 'basic', channel: 'basic' },
      }
      draft.edges.push({ from: 'fetch', port: { kind: 'out' }, to: 'notify' })
    })
    const result = run(target, null, { prev })
    expect(result.entries).toContainEqual({ status: 'deleted', key: 'report', id: 'a2' })
    expect(result.entries).toContainEqual({
      status: 'created',
      key: 'notify',
      id: 'new-1',
      idSource: 'minted',
    })
    expect(result.state.blocks.a2).toBeUndefined()
    expect(result.state.blocks['new-1'].subBlocks.text.value).toBe('<fetch.result>')
    expect(result.state.blocks['new-1'].subBlocks.channel.value).toBeNull()
    expect(result.state.edges.map((e) => [e.source, e.target])).toEqual([
      ['start', 'a1'],
      ['a1', 'new-1'],
    ])
    expect(result.needsLayout).toEqual(['notify'])
    expect(codes(result)).toContain('I_MAT_NEEDS_LAYOUT')
  })

  it('recreates a block whose type changed under the same key, with a warning', () => {
    const prev = base()
    const target = edit(canonical(prev).workflow, (draft) => {
      draft.blocks.fetch = {
        ...draft.blocks.fetch,
        type: 'api',
        params: { url: { kind: 'value', value: 'https://x' } },
      }
    })
    const result = run(target, lockFor(prev), { prev })
    expect(result.entries).toContainEqual({ status: 'deleted', key: 'fetch', id: 'a1' })
    expect(result.entries).toContainEqual({
      status: 'created',
      key: 'fetch',
      id: 'new-1',
      idSource: 'minted',
    })
    expect(codes(result)).toContain('W_MAT_RETYPE_RECREATED')
    expect(result.state.edges.map((e) => e.id)).toEqual(['new-2', 'new-3'])
  })

  it('keeps the id across a catalog sunset replacedBy retype', () => {
    const prev = workflowState([blockState('o1', 'function_v0', 'Old', { code: 'x' })])
    const target = edit(canonical(prev).workflow, (draft) => {
      draft.blocks.old.type = 'function'
    })
    const result = run(target, null, { prev })
    expect(result.entries).toEqual([
      { status: 'matched', key: 'old', id: 'o1', via: 'db-name', retypedFrom: 'function_v0' },
    ])
    expect(result.state.blocks.o1.type).toBe('function')
    expect(codes(result)).toEqual([])
  })

  it('re-creates a stale lock entry whose id left prev, with a warning', () => {
    const pulled = base()
    const lock = lockFor(pulled)
    const prev = workflowState([pulled.blocks.start, pulled.blocks.a2], {
      edges: [],
      variables: pulled.variables,
    })
    const result = run(canonical(pulled, lock).workflow, lock, { prev, lockFreshness: 'stale' })
    expect(codes(result)).toContain('W_MAT_DELETED_SINCE_PULL')
    expect(result.entries).toContainEqual({
      status: 'created',
      key: 'fetch',
      id: 'new-1',
      idSource: 'minted',
    })
    expect(result.entries).toContainEqual(
      expect.objectContaining({ status: 'matched', key: 'report', id: 'a2' })
    )
  })

  it('reuses an unclaimed lock id for a new workflow and reports duplicate lock ids', () => {
    const pulled = base()
    const lock = lockFor(pulled)
    const fresh = run(canonical(pulled, lock).workflow, lock, { lockFreshness: 'fresh' })
    expect(fresh.entries).toContainEqual({
      status: 'created',
      key: 'fetch',
      id: 'a1',
      idSource: 'lock',
    })
    expect(Object.keys(fresh.state.blocks).sort()).toEqual(['a1', 'a2', 'start'])
    expect(fresh.state.blocks.a1.position).toEqual({ x: 10, y: 20 })
    expect(fresh.needsLayout).toEqual([])

    const broken: WorkflowLockV1 = {
      ...lock,
      blocks: { ...lock.blocks, report: { ...lock.blocks.report, id: 'a1' } },
    }
    const result = run(canonical(pulled).workflow, broken, { prev: pulled })
    expect(codes(result)).toContain('E_MAT_DUPLICATE_LOCK_ID')
    expect(result.identity.blocks.fetch.id).toBe('a1')
    expect(result.identity.blocks.report.id).toBe('a2')
  })

  it('keeps variable ids by lock key and inputFormat item ids by lock items', () => {
    const pulled = base()
    const lock = lockFor(pulled)
    const c = canonical(pulled, lock).workflow
    const result = run(c, lock, { lockFreshness: 'fresh' })
    expect(Object.keys(result.state.variables ?? {})).toEqual(['var-1'])
    expect(subBlockValue(result.state, 'start', 'inputFormat')).toEqual([
      { id: 'f-q', name: 'question', type: 'string' },
    ])
    expect(result.identity.blocks.start.items).toEqual({
      inputFormat: [{ name: 'question', id: 'f-q' }],
    })
  })

  it('keeps every block-id foreign key stable across an edit elsewhere', () => {
    const prev = workflowState(
      [
        blockState(
          'trig',
          'slack',
          'Slack Trigger',
          {
            botToken: 't',
            webhookId: 'wh-1',
            triggerPath: 'custom/path',
            triggerConfig: { botToken: 't' },
            triggerId: 'slack_webhook',
          },
          { triggerMode: true }
        ),
        blockState('sched', 'schedule', 'Nightly', {
          scheduleType: 'cron',
          cronExpression: '0 0 * * *',
        }),
        blockState('gate', 'condition', 'Gate', {
          conditions: JSON.stringify([
            { id: 'gate-if', title: 'if', value: 'x' },
            { id: 'gate-else', title: 'else', value: '' },
          ]),
        }),
        blockState('out', 'function', 'Answer', { code: 'return 1' }),
      ],
      { edges: [edge('e1', 'trig', 'gate'), edge('e2', 'gate', 'out', 'condition-gate-if')] }
    )
    const target = edit(canonical(prev).workflow, (draft) => {
      draft.blocks.reply = { ...draft.blocks.answer, key: 'reply', name: 'Reply' }
      draft.blocks = omit(draft.blocks, ['answer'])
      draft.edges = draft.edges.map((e) => (e.to === 'answer' ? { ...e, to: 'reply' } : e))
      draft.blocks.reply.params.code = { kind: 'value', value: 'return 2' }
      const rows = draft.blocks.gate.branches?.rows ?? []
      rows[0].value = 'y'
    })
    const result = run(target, lockFor(prev), {
      prev,
      lockFreshness: 'fresh',
      compiledIdents: { reply: 'b_answer' },
    })
    expect(Object.keys(result.state.blocks).sort()).toEqual(['gate', 'out', 'sched', 'trig'])
    expect(result.state.blocks.trig).toBe(prev.blocks.trig)
    expect(result.state.blocks.sched).toBe(prev.blocks.sched)
    for (const id of ['webhookId', 'triggerPath', 'triggerConfig', 'triggerId']) {
      expect(result.state.blocks.trig.subBlocks[id]).toBe(prev.blocks.trig.subBlocks[id])
    }
    const rows = JSON.parse(String(subBlockValue(result.state, 'gate', 'conditions')))
    expect(rows.map((row: { id: string }) => row.id)).toEqual(['gate-if', 'gate-else'])
    expect(result.state.edges).toStrictEqual(prev.edges)
  })
})

describe('materialize: positions and server-owned fields', () => {
  it('uses prev positions, the lock layout for new blocks, or flags autolayout', () => {
    const prev = workflowState([
      blockState('f1', 'function', 'One', { code: 'a' }, { position: { x: 5, y: 6 } }),
    ])
    const target = edit(canonical(prev).workflow, (draft) => {
      draft.blocks.one.params.code = { kind: 'value', value: 'b' }
      draft.blocks.two = { ...draft.blocks.one, key: 'two', name: 'Two' }
      draft.blocks.three = { ...draft.blocks.one, key: 'three', name: 'Three' }
    })
    const lock: WorkflowLockV1 = {
      version: 1,
      variables: {},
      blocks: {
        one: { id: 'f1', parent: null, ident: 'one', order: 0, layout: { x: 99, y: 99 } },
        two: {
          id: 'f2',
          parent: null,
          ident: 'two',
          order: 1,
          layout: { x: 1, y: 2, w: 300, height: 80 },
        },
      },
    }
    const result = run(target, lock, { prev, lockFreshness: 'stale', inferRenames: false })
    expect(result.state.blocks.f1.position).toEqual({ x: 5, y: 6 })
    const two = result.state.blocks[result.identity.blocks.two.id]
    expect(two.position).toEqual({ x: 1, y: 2 })
    expect(two.height).toBe(80)
    expect(two.data?.width).toBe(300)
    expect(result.needsLayout).toEqual(['three'])
  })

  it('writes a new block from initBlock and nulls editor seeds the model does not hold', () => {
    const c = canonical(workflowState([blockState('c1', 'condition', 'Gate')])).workflow
    const result = run(c, null)
    const created = Object.values(result.state.blocks)[0] as BlockState
    expect(created.subBlocks.conditions.value).toBeNull()
    expect(created.outputs).toEqual({
      computed: { type: 'string', description: 'condition:false' },
    })
  })

  it('makes the error port effective through errorEnabled when no error edge carries it', () => {
    const prev = workflowState([blockState('f1', 'function', 'One', { code: 'a' })])
    const target = edit(canonical(prev).workflow, (draft) => {
      draft.blocks.one.errorPort = true
    })
    expect(run(target, null, { prev }).state.blocks.f1.errorEnabled).toBe(true)
  })
})

describe('materialize: preserved UI state comes from prev', () => {
  /** What compile makes of a lean print: a plain id lands in the advanced member. */
  function leanPair(draft: CanonicalWorkflow, key: string, id: string) {
    const block = draft.blocks[key]
    block.params = omit(block.params, ['channel', 'manualChannel'])
    block.params.manualChannel = { kind: 'value', value: id }
    block.modes.channel = 'advanced'
  }

  it('keeps the selector member when source changes a plain id', () => {
    const state = workflowState([
      blockState('s1', 'slack', 'Post', { operation: 'send', channel: 'C1', manualChannel: 'M' }),
    ])
    const target = edit(canonical(state).workflow, (draft) => leanPair(draft, 'post', 'C2'))
    const result = run(target, null, { prev: state })
    expect(subBlockValue(result.state, 's1', 'channel')).toBe('C2')
    expect(subBlockValue(result.state, 's1', 'manualChannel')).toBe('M')
    expect(result.state.blocks.s1.data?.canonicalModes).toBeUndefined()
  })

  it('writes prev back untouched when lean source runs the same as it', () => {
    const state = workflowState([
      blockState('s1', 'slack', 'Post', {
        operation: 'read',
        channel: 'C1',
        manualChannel: 'M',
        text: 'stale message',
      }),
    ])
    const target = edit(canonical(state).workflow, (draft) => {
      leanPair(draft, 'post', 'C1')
      draft.blocks.post.params = omit(draft.blocks.post.params, ['text'])
    })
    expect(run(target, null, { prev: state }).state.blocks.s1).toBe(state.blocks.s1)
  })

  it('keeps an inactive value through an edit to an active one', () => {
    const state = workflowState([
      blockState('s1', 'slack', 'Post', {
        operation: 'read',
        channel: 'C1',
        text: 'stale message',
        notify: true,
      }),
    ])
    const target = edit(canonical(state).workflow, (draft) => {
      draft.blocks.post.params = omit(draft.blocks.post.params, ['text'])
      draft.blocks.post.params.notify = { kind: 'value', value: false }
    })
    const result = run(target, null, { prev: state })
    expect(subBlockValue(result.state, 's1', 'notify')).toBe(false)
    expect(subBlockValue(result.state, 's1', 'text')).toBe('stale message')
  })

  it("keeps a forEach loop's stored count through a collection edit", () => {
    const state = workflowState([
      blockState(
        'l1',
        'loop',
        'Each',
        {},
        { data: { loopType: 'forEach', count: 7, collection: '<start.items>' } }
      ),
    ])
    const target = edit(canonical(state).workflow, (draft) => {
      draft.blocks.each.subflow = {
        kind: 'loop',
        loopType: 'forEach',
        iterations: 5,
        forEachItems: '<start.rows>',
      }
    })
    const data = run(target, null, { prev: state }).state.blocks.l1.data
    expect(data?.count).toBe(7)
    expect(data?.collection).toBe('<start.rows>')
  })

  it('keeps the stored spelling of a loop count that runs the same', () => {
    const state = workflowState([
      blockState('l1', 'loop', 'Count', {}, { data: { loopType: 'for', count: 0 } }),
    ])
    const target = edit(canonical(state).workflow, (draft) => {
      draft.blocks.count.subflow = { kind: 'loop', loopType: 'for', iterations: 5 }
    })
    expect(run(target, null, { prev: state }).state.blocks.l1).toBe(state.blocks.l1)
  })
})
