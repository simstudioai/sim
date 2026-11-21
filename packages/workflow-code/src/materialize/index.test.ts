import { omit } from '@sim/utils/object'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { canonicalEquals } from '../equivalence'
import type { WorkflowLockV1 } from '../lock'
import type { CanonicalWorkflow } from '../model'
import { getOwn, setOwn } from '../records'
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
import { renamedReferenceRewriter, rewriteRenamedReferences } from './values'

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

  it('writes a __proto__ key in a value as data, not as the stored object prototype', () => {
    const state = workflowState([blockState('a1', 'agent', 'Agent', { model: 'gpt-4o' })])
    const message = JSON.parse('{"role":"user","__proto__":{"polluted":true}}')
    const target = edit(canonical(state).workflow, (draft) => {
      draft.blocks.agent.params.messages = { kind: 'value', value: [message] }
    })
    const stored = subBlockValue(run(target, null, { prev: state }).state, 'a1', 'messages')
    const [written] = Array.isArray(stored) ? stored : []
    expect(Object.hasOwn(written, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(written)).toBe(Object.prototype)
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

  it('lists the keys an unknown key could have been, with a did-you-mean, when the resolver has them', () => {
    const state = workflowState([blockState('k1', 'knowledge', 'KB', { knowledgeBaseIds: 'kb-1' })])
    const target = edit(canonical(state).workflow, (draft) => {
      draft.blocks.kb.params.knowledgeBaseIds = {
        kind: 'value',
        value: [{ $sim: 'resource', kind: 'knowledge-base', key: 'product-doc' }],
      }
    })
    const keysOf = (kind: string) => (kind === 'knowledge-base' ? ['product-docs', 'support'] : [])
    const [finding] = run(target, null, {
      prev: state,
      resources: { ...RESOURCES, keysOf },
    }).diagnostics
    expect(finding?.hint).toBe('Did you mean product-docs? Keys: product-docs, support.')
    const [none] = run(target, null, {
      prev: state,
      resources: { ...RESOURCES, keysOf: () => [] },
    }).diagnostics
    expect(none?.hint).toBe(
      'This workspace has no knowledge-base a source can name yet. Create it with `sim knowledge create`; a source names it by its key, which `sim workflows source resources` lists.'
    )
  })

  it('names the command that creates a credential the workspace lacks, the dead end an agent hit', () => {
    const state = workflowState([blockState('s1', 'slack', 'Notify', {})])
    const target = edit(canonical(state).workflow, (draft) => {
      draft.blocks.notify.params.credential = {
        kind: 'value',
        value: { $sim: 'resource', kind: 'credential', key: 'team-slack' },
      }
    })
    const keysOf = (kind: string) => (kind === 'credential' ? ['ops-gmail'] : [])
    const [finding] = run(target, null, {
      prev: state,
      resources: { ...RESOURCES, keysOf },
    }).diagnostics.filter((d) => d.code === 'E_MAT_UNKNOWN_RESOURCE')
    expect(finding?.hint).toContain('sim credentials connect <provider> --name "<Name>"')
    expect(finding?.hint).toContain(
      'sim credentials create <provider> --name "<Name>" --credentials @<file>'
    )
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

  it('keeps the row id of the one branch whose key changed, and its edge with it', () => {
    const prev = workflowState(
      [
        blockState('c1', 'condition', 'Gate', {
          conditions: JSON.stringify([
            { id: 'c1-a', key: 'one', value: 'x' },
            { id: 'c1-b', key: 'two', value: 'y' },
            { id: 'c1-else', value: '' },
          ]),
        }),
        blockState('n1', 'function', 'Next', { code: 'return 1' }),
      ],
      { edges: [{ ...edge('e1', 'c1', 'n1'), sourceHandle: 'condition-c1-a' }] }
    )
    const target = edit(canonical(prev).workflow, (draft) => {
      const rows = draft.blocks.gate.branches?.rows ?? []
      rows[0].key = 'single'
      draft.edges = draft.edges.map((e) =>
        e.port.kind === 'branch' ? { ...e, port: { kind: 'branch', key: 'single' } } : e
      )
    })
    const result = run(target, null, { prev })
    const stored = JSON.parse(String(subBlockValue(result.state, 'c1', 'conditions')))
    expect(stored.map((row: { id: string }) => row.id)).toEqual(['c1-a', 'c1-b', 'c1-else'])
    expect(result.state.edges.map((e) => [e.id, e.sourceHandle])).toEqual([
      ['e1', 'condition-c1-a'],
    ])
  })

  it('mints new row ids when more than one branch key changed, which nothing pairs', () => {
    const prev = workflowState([
      blockState('c1', 'condition', 'Gate', {
        conditions: JSON.stringify([
          { id: 'c1-a', key: 'one', value: 'x' },
          { id: 'c1-b', key: 'two', value: 'y' },
          { id: 'c1-else', value: '' },
        ]),
      }),
    ])
    const target = edit(canonical(prev).workflow, (draft) => {
      const rows = draft.blocks.gate.branches?.rows ?? []
      rows[0].key = 'uno'
      rows[1].key = 'dos'
    })
    const result = run(target, null, { prev })
    const stored = JSON.parse(String(subBlockValue(result.state, 'c1', 'conditions')))
    expect(stored[0].id).not.toBe('c1-a')
    expect(stored[1].id).not.toBe('c1-b')
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

  it('keeps each id across a chain rename where one block takes the name another leaves', () => {
    const prev = base()
    const lock = lockFor(prev)
    const moves: Record<string, string> = { fetch: 'report', report: 'summary' }
    const target = edit(canonical(prev, lock).workflow, (draft) => {
      const blocks = { ...draft.blocks }
      draft.blocks = omit(draft.blocks, ['fetch', 'report'])
      draft.blocks.report = { ...blocks.fetch, key: 'report', name: 'Report' }
      draft.blocks.summary = { ...blocks.report, key: 'summary', name: 'Summary' }
      draft.edges = draft.edges.map((e) => ({
        ...e,
        from: moves[e.from] ?? e.from,
        to: moves[e.to] ?? e.to,
      }))
    })
    const result = run(target, lock, {
      prev,
      compiledIdents: { report: lock.blocks.fetch.ident, summary: lock.blocks.report.ident },
    })
    expect(result.identity.blocks.report.id).toBe('a1')
    expect(result.identity.blocks.summary.id).toBe('a2')
    expect(result.entries.filter((entry) => entry.status !== 'matched')).toEqual([])
  })

  it('infers a lockless rename from type, parent and agreeing neighbours, flagged', () => {
    const prev = base()
    const result = run(renameFetch(canonical(prev).workflow), null, { prev })
    expect(result.entries).toContainEqual(
      expect.objectContaining({ status: 'matched', key: 'load', id: 'a1', via: 'inferred' })
    )
    expect(codes(result)).toEqual(['W_MAT_INFERRED_RENAME'])
  })

  it('does not infer a rename when neighbours disagree', () => {
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

  it.each([
    ['<one.result> > 1', '<uno.result> > 1'],
    ['<One.result> > 1', '<Uno.result> > 1'],
  ])(
    'infers a rename whose every reference (%s in a condition branch) was renamed with it',
    (before, after) => {
      const prev = workflowState(
        [
          blockState('a1', 'function', 'One', { code: 'return 1' }),
          blockState('c1', 'condition', 'Gate', {
            conditions: JSON.stringify([
              { id: 'c1-if', title: 'if', value: before },
              { id: 'c1-else', title: 'else', value: '' },
            ]),
          }),
          blockState('u1', 'function', 'Use', { code: 'return 0' }),
        ],
        { edges: [edge('e1', 'u1', 'a1')] }
      )
      // Neither settings nor connections tie the two: only the renamed references do.
      const target = edit(canonical(prev).workflow, (draft) => {
        draft.edges = []
        draft.blocks.uno = {
          ...draft.blocks.one,
          key: 'uno',
          name: 'Uno',
          params: { code: { kind: 'value', value: 'return 2' } },
        }
        draft.blocks = omit(draft.blocks, ['one'])
        const rows = draft.blocks.gate.branches?.rows ?? []
        rows[0].value = after
      })
      const result = run(target, lockFor(prev), { prev, lockFreshness: 'fresh' })
      expect(result.entries).toContainEqual(
        expect.objectContaining({ status: 'matched', key: 'uno', id: 'a1', via: 'inferred' })
      )
    }
  )

  it('infers a rename by its renamed references beside a reference to no block', () => {
    const prev = base()
    const lock = lockFor(prev)
    const target = edit(renameFetch(canonical(prev, lock).workflow), (draft) => {
      draft.blocks.load.params.code = { kind: 'value', value: 'return 2' }
      draft.blocks.report.params.code = {
        kind: 'value',
        value: 'return <load.result> + <nothing.x>',
      }
      draft.edges = draft.edges.filter((e) => e.from !== 'start')
    })
    const result = run(target, lock, { prev, compiledIdents: { load: 'x_load' } })
    expect(result.entries).toContainEqual(
      expect.objectContaining({ status: 'matched', key: 'load', id: 'a1', via: 'inferred' })
    )
  })

  it('infers a rename under a fresh lock when the ident changed too', () => {
    const prev = base()
    const lock = lockFor(prev)
    const result = run(renameFetch(canonical(prev, lock).workflow), lock, { prev })
    expect(result.entries).toContainEqual(
      expect.objectContaining({ status: 'matched', key: 'load', id: 'a1', via: 'inferred' })
    )
    expect(codes(result)).toContain('W_MAT_INFERRED_RENAME')
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

  it('sends a block moved into or out of a container to autolayout: its position was relative to the old one', () => {
    const prev = workflowState(
      [
        blockState('l1', 'loop', 'Each', {}, { data: { loopType: 'for', count: 2 } }),
        blockState(
          'f1',
          'function',
          'Inner',
          { code: 'x' },
          { data: { parentId: 'l1', extent: 'parent' } }
        ),
        blockState('f2', 'function', 'Outer', { code: 'y' }, { position: { x: 900, y: 400 } }),
      ],
      { loops: { l1: { id: 'l1', nodes: ['f1'], iterations: 2, loopType: 'for', enabled: true } } }
    )
    const lock = lockFor(prev)
    const target = edit(canonical(prev, lock).workflow, (draft) => {
      draft.blocks.inner.parent = null
      draft.blocks.outer.parent = 'each'
    })

    const result = run(target, lock, { prev })

    expect(result.state.blocks.f1.position).toEqual({ x: 0, y: 0 })
    expect(result.state.blocks.f2.position).toEqual({ x: 0, y: 0 })
    expect([...result.needsLayout].sort()).toEqual(['inner', 'outer'])
    expect(result.identity.blocks.inner.id).toBe('f1')
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

  it('never lets a new block inherit the id of a block renamed and retyped by ident', () => {
    const prev = base()
    const lock = lockFor(prev)
    const target = edit(canonical(prev, lock).workflow, (draft) => {
      draft.blocks.summarizer = {
        ...draft.blocks.fetch,
        key: 'summarizer',
        name: 'Summarizer',
        type: 'api',
        params: { url: { kind: 'value', value: 'https://x' } },
      }
      draft.blocks.writer = { ...draft.blocks.fetch, key: 'writer', name: 'Writer' }
      draft.blocks = omit(draft.blocks, ['fetch'])
      draft.edges = draft.edges.map((e) => ({
        ...e,
        from: e.from === 'fetch' ? 'writer' : e.from,
        to: e.to === 'fetch' ? 'writer' : e.to,
      }))
    })
    const result = run(target, lock, {
      prev,
      compiledIdents: { summarizer: lock.blocks.fetch.ident },
    })
    expect(codes(result)).toContain('W_MAT_RETYPE_RECREATED')
    expect(codes(result)).not.toContain('W_MAT_INFERRED_RENAME')
    expect(result.entries).toContainEqual({ status: 'deleted', key: 'fetch', id: 'a1' })
    expect(result.identity.blocks.writer.id).not.toBe('a1')
    expect(result.identity.blocks.summarizer.id).not.toBe('a1')
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

  it('does not call a stale lock entry re-created when a block re-added under its key matches', () => {
    const pulled = base()
    const lock = lockFor(pulled)
    const readded = blockState('a9', 'function', 'Fetch', { code: 'return 1' })
    const prev = workflowState([pulled.blocks.start, readded, pulled.blocks.a2], {
      edges: [edge('e1', 'start', 'a9'), edge('e2', 'a9', 'a2')],
      variables: pulled.variables,
    })
    const result = run(canonical(pulled, lock).workflow, lock, { prev, lockFreshness: 'stale' })
    expect(result.entries).toContainEqual(
      expect.objectContaining({ status: 'matched', key: 'fetch', id: 'a9', via: 'db-name' })
    )
    expect(codes(result)).not.toContain('W_MAT_DELETED_SINCE_PULL')
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

  it('escapes the lock key in a duplicate lock id pointer', () => {
    const pulled = workflowState([blockState('b1', 'function', 'fn', { code: 'return 1' })])
    const lock: WorkflowLockV1 = {
      version: 1,
      blocks: {
        'a/b': { id: 'shared', parent: null, ident: 'ab', order: 0 },
        'x~y': { id: 'shared', parent: null, ident: 'xy', order: 1 },
      },
      variables: {},
    }
    const result = run(canonical(pulled).workflow, lock)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'E_MAT_DUPLICATE_LOCK_ID', path: '/blocks/x~0y/id' })
    )
  })

  it('gives a new variable keyed like an Object.prototype member a fresh id', () => {
    const prev = base()
    const lock = lockFor(prev)
    const target = edit(canonical(prev, lock).workflow, (draft) => {
      setOwn(draft.variables, 'constructor', {
        key: 'constructor',
        name: 'constructor',
        type: 'plain',
        value: 'x',
      })
    })
    const result = run(target, lock, { prev, lockFreshness: 'fresh' })
    const ids = Object.keys(result.state.variables ?? {})
    expect(ids).toHaveLength(2)
    expect(ids.every((id) => typeof id === 'string' && !id.startsWith('function'))).toBe(true)
    expect(typeof getOwn(result.identity.variables, 'constructor')).toBe('string')
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

  it('keeps the id of the one inputFormat field renamed with its type and description', () => {
    const prev = workflowState([
      blockState('start', 'start_trigger', 'Start', {
        inputFormat: [
          { id: 'f-n', name: 'n', type: 'number', description: 'How many' },
          { id: 'f-q', name: 'q', type: 'string' },
        ],
      }),
    ])
    const renamed = (to: string, type: string, description = 'How many') =>
      edit(canonical(prev).workflow, (draft) => {
        const inputFormat = draft.blocks.start.params.inputFormat
        if (inputFormat.kind === 'value' && Array.isArray(inputFormat.value)) {
          inputFormat.value[0] = { name: to, type, description }
        }
      })
    const ids = (workflow: CanonicalWorkflow) =>
      (
        subBlockValue(run(workflow, null, { prev }).state, 'start', 'inputFormat') as Array<{
          id: string
        }>
      ).map((field) => field.id)

    expect(ids(renamed('num', 'number'))).toEqual(['f-n', 'f-q'])
    expect(ids(renamed('label', 'string'))).toEqual(['new-1', 'f-q'])
    // A shared type alone ties nothing: another field of that type is a delete and an add.
    expect(ids(renamed('count', 'number', 'Rows to fetch'))).toEqual(['new-1', 'f-q'])
  })

  it('keeps the stored variable order when source lists the variables in another order', () => {
    const pulled = workflowState([blockState('a1', 'function', 'Fetch', { code: 'return 1' })], {
      variables: {
        'var-z': { id: 'var-z', name: 'Zeta', type: 'number', value: 1 },
        'var-a': { id: 'var-a', name: 'Alpha', type: 'number', value: 1 },
      },
    })
    const edited = edit(canonical(pulled).workflow, (draft) => {
      draft.variables = {
        alpha: { ...draft.variables.alpha, value: 2 },
        new: { key: 'new', name: 'New', type: 'number', value: 3 },
        zeta: draft.variables.zeta,
      }
    })

    expect(Object.keys(run(edited, null, { prev: pulled }).state.variables ?? {})).toEqual([
      'var-z',
      'var-a',
      'new-1',
    ])
  })

  it('keeps the id of the one variable renamed to a key of the same type', () => {
    const pulled = base()
    const renamed = (type: 'number' | 'plain') =>
      edit(canonical(pulled).workflow, (draft) => {
        draft.variables = {
          total: { key: 'total', name: 'Total', type, value: type === 'number' ? 1 : '1' },
        }
      })
    const ids = (workflow: CanonicalWorkflow) =>
      Object.keys(run(workflow, null, { prev: pulled }).state.variables ?? {})

    expect(ids(renamed('number'))).toEqual(['var-1'])
    expect(ids(renamed('plain'))).toEqual(['new-1'])
  })

  it('treats an unrelated variable of the same type added beside a removed one as a delete and an add', () => {
    const pulled = base()
    const replaced = edit(canonical(pulled).workflow, (draft) => {
      draft.variables = { region: { key: 'region', name: 'Region', type: 'number', value: 42 } }
    })

    expect(Object.keys(run(replaced, null, { prev: pulled }).state.variables ?? {})).toEqual([
      'new-1',
    ])
  })

  it('ties no variable rename on a value as common as 0, false or true', () => {
    for (const [type, value] of [
      ['number', 0],
      ['boolean', false],
      ['boolean', true],
    ] as const) {
      const pulled = {
        ...base(),
        variables: { 'var-1': { id: 'var-1', name: 'Retries', type, value } },
      }
      const replaced = edit(canonical(pulled).workflow, (draft) => {
        draft.variables = { offset: { key: 'offset', name: 'Offset', type, value } }
      })

      expect(Object.keys(run(replaced, null, { prev: pulled }).state.variables ?? {})).toEqual([
        'new-1',
      ])
    }
  })

  it.each([
    ['number', 0],
    ['boolean', false],
    ['plain', ''],
  ] as const)(
    'keeps the id of a variable holding %s %j renamed with every reference to it',
    (type, value) => {
      const pulled = workflowState(
        [
          blockState('a1', 'function', 'Read', { code: 'return <variable.retries> + 1' }),
          blockState('a2', 'function', 'Other', { code: 'return 2' }),
        ],
        { variables: { 'var-1': { id: 'var-1', name: 'Retries', type, value } } }
      )
      const rename = (code: string, renamedValue: number | boolean | string = value) =>
        edit(canonical(pulled).workflow, (draft) => {
          draft.variables = {
            attempts: { key: 'attempts', name: 'Attempts', type, value: renamedValue },
          }
          draft.blocks.read.params.code = { kind: 'value', value: code }
        })
      const ids = (workflow: CanonicalWorkflow) =>
        Object.keys(run(workflow, null, { prev: pulled }).state.variables ?? {})

      expect(ids(rename('return <variable.attempts> + 1'))).toEqual(['var-1'])
      // A reference left behind, or a changed value, ties nothing.
      expect(ids(rename('return 1'))).toEqual(['new-1'])
      expect(ids(rename('return <variable.attempts> + 1', type === 'number' ? 5 : 'x'))).toEqual([
        'new-1',
      ])
    }
  )

  it('keeps the id of a falsy-valued variable renamed in the same edit as the block that reads it', () => {
    const pulled = workflowState(
      [
        blockState('a1', 'function', 'Read', { code: 'return <variable.retries> + 1' }),
        blockState('a2', 'function', 'Other', { code: 'return 2' }),
      ],
      { variables: { 'var-1': { id: 'var-1', name: 'Retries', type: 'number', value: 0 } } }
    )
    const lock = lockFor(pulled)
    const target = edit(canonical(pulled, lock).workflow, (draft) => {
      draft.variables = {
        attempts: { key: 'attempts', name: 'Attempts', type: 'number', value: 0 },
      }
      draft.blocks.reader = {
        ...draft.blocks.read,
        key: 'reader',
        name: 'Reader',
        params: {
          ...draft.blocks.read.params,
          code: { kind: 'value', value: 'return <variable.attempts> + 1' },
        },
      }
      draft.blocks = omit(draft.blocks, ['read'])
    })

    const result = run(target, lock, {
      prev: pulled,
      compiledIdents: { reader: lock.blocks.read.ident },
    })

    expect(result.identity.blocks.reader.id).toBe('a1')
    expect(Object.keys(result.state.variables ?? {})).toEqual(['var-1'])
  })

  it('leaves an inputFormat id two fields share out of the identity items', () => {
    const prev = workflowState([
      blockState('start', 'start_trigger', 'Start', {
        inputFormat: [
          { id: 'f1', name: 'email', type: 'string' },
          { id: 'f1', name: 'phone', type: 'string' },
        ],
      }),
    ])
    const target = edit(canonical(prev).workflow, (draft) => {
      const inputFormat = draft.blocks.start.params.inputFormat
      if (inputFormat.kind === 'value' && Array.isArray(inputFormat.value)) {
        inputFormat.value.push({ name: 'age', type: 'number' })
      }
    })
    const result = run(target, null, { prev })
    expect(subBlockValue(result.state, 'start', 'inputFormat')).toEqual([
      { id: 'f1', name: 'email', type: 'string' },
      { id: 'f1', name: 'phone', type: 'string' },
      { id: 'new-1', name: 'age', type: 'number' },
    ])
    expect(result.identity).toStrictEqual(canonical(result.state).identity)
    expect(result.identity.blocks.start.items).toEqual({
      inputFormat: [{ name: 'age', id: 'new-1' }],
    })
  })

  it('keeps the collapsed flag of inputFormat fields whose id stays inline', () => {
    const prev = workflowState([
      blockState('start', 'start_trigger', 'Start', {
        inputFormat: [
          { id: 'f1', name: 'email', type: 'string', collapsed: true },
          { id: 'f2', name: 'email', type: 'number', collapsed: false },
          { id: 'f3', type: 'string', collapsed: true },
        ],
      }),
    ])
    const target = edit(canonical(prev).workflow, (draft) => {
      const inputFormat = draft.blocks.start.params.inputFormat
      if (inputFormat.kind === 'value' && Array.isArray(inputFormat.value)) {
        inputFormat.value.push({ name: 'age', type: 'number' })
      }
    })
    const result = run(target, null, { prev })
    expect(subBlockValue(result.state, 'start', 'inputFormat')).toEqual([
      { id: 'f1', name: 'email', type: 'string', collapsed: true },
      { id: 'f2', name: 'email', type: 'number', collapsed: false },
      { id: 'f3', type: 'string', collapsed: true },
      { id: 'new-1', name: 'age', type: 'number' },
    ])
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
    const result = run(target, lock, { prev, lockFreshness: 'stale' })
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

  it('rewrites a renamed block reference inside a restored inactive value, as a canvas rename does', () => {
    const state = workflowState([
      blockState('a1', 'function', 'Fetch', { code: 'return 1' }),
      blockState('s1', 'slack', 'Post', {
        operation: 'read',
        channel: 'C1',
        text: 'saw <fetch.result>',
      }),
    ])
    const lock = lockFor(state)
    const target = edit(canonical(state, lock).workflow, (draft) => {
      draft.blocks.load = { ...draft.blocks.fetch, key: 'load', name: 'Load' }
      draft.blocks = omit(draft.blocks, ['fetch'])
      draft.blocks.post.params = omit(draft.blocks.post.params, ['text'])
    })
    const result = run(target, lock, {
      prev: state,
      compiledIdents: { load: lock.blocks.fetch.ident },
    })
    expect(result.identity.blocks.load.id).toBe('a1')
    expect(subBlockValue(result.state, 's1', 'text')).toBe('saw <load.result>')
  })

  it.each([
    ['a chain', { fetch: 'report', report: 'summary' }, 'saw <report.result> and <summary.result>'],
    ['a swap', { fetch: 'report', report: 'fetch' }, 'saw <report.result> and <fetch.result>'],
  ])(
    'rewrites a restored inactive value through %s of renames at once',
    (_label, moves, expected) => {
      const state = workflowState([
        blockState('a1', 'function', 'Fetch', { code: 'return 1' }),
        blockState('a2', 'function', 'Report', { code: 'return 2' }),
        blockState('s1', 'slack', 'Post', {
          operation: 'read',
          channel: 'C1',
          text: 'saw <fetch.result> and <report.result>',
        }),
      ])
      const lock = lockFor(state)
      const renamed: Record<string, string> = moves
      const target = edit(canonical(state, lock).workflow, (draft) => {
        const blocks = { ...draft.blocks }
        draft.blocks = omit(draft.blocks, ['fetch', 'report'])
        for (const [from, to] of Object.entries(renamed)) {
          draft.blocks[to] = { ...blocks[from], key: to, name: to[0].toUpperCase() + to.slice(1) }
        }
        draft.blocks.post.params = omit(draft.blocks.post.params, ['text'])
      })
      const result = run(target, lock, {
        prev: state,
        compiledIdents: Object.fromEntries(
          Object.entries(renamed).map(([from, to]) => [to, lock.blocks[from].ident])
        ),
      })
      expect(result.identity.blocks[renamed.fetch].id).toBe('a1')
      expect(result.identity.blocks[renamed.report].id).toBe('a2')
      expect(subBlockValue(result.state, 's1', 'text')).toBe(expected)
    }
  )

  it('clears a standalone advanced field that source emptied instead of restoring it', () => {
    const state = workflowState([
      blockState('s1', 'slack', 'Post', { operation: 'send', text: 'hi', threadTs: '123.456' }),
    ])
    const removed = edit(canonical(state).workflow, (draft) => {
      draft.blocks.post.params = omit(draft.blocks.post.params, ['threadTs'])
    })
    const emptied = edit(canonical(state).workflow, (draft) => {
      draft.blocks.post.params.threadTs = { kind: 'value', value: '' }
    })
    expect(subBlockValue(run(removed, null, { prev: state }).state, 's1', 'threadTs')).toBeNull()
    expect(subBlockValue(run(emptied, null, { prev: state }).state, 's1', 'threadTs')).toBe('')
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

  it('writes a collection item holding a $sim key back as stored, not as its literal wrapper', () => {
    const item = { $sim: 'x', n: 1 }
    const state = workflowState(
      [
        blockState('l1', 'loop', 'Each', {}, { data: { loopType: 'forEach', collection: [item] } }),
        blockState(
          'p1',
          'parallel',
          'Fan',
          {},
          { data: { parallelType: 'collection', collection: [item] } }
        ),
      ],
      {
        loops: {
          l1: {
            id: 'l1',
            nodes: [],
            iterations: 5,
            loopType: 'forEach',
            forEachItems: [item],
            enabled: true,
          },
        },
        parallels: {
          p1: {
            id: 'p1',
            nodes: [],
            parallelType: 'collection',
            distribution: [item],
            enabled: true,
          },
        },
      }
    )
    const target = edit(canonical(state).workflow, (draft) => {
      for (const key of ['each', 'fan']) {
        const spec = draft.blocks[key].subflow
        const items = spec?.kind === 'loop' ? spec.forEachItems : spec?.distribution
        if (Array.isArray(items)) items.push(2)
      }
    })
    const result = run(target, null, { prev: state })
    expect(result.state.blocks.l1.data?.collection).toEqual([item, 2])
    expect(result.state.loops.l1.forEachItems).toEqual([item, 2])
    expect(result.state.blocks.p1.data?.collection).toEqual([item, 2])
    expect(result.state.parallels.p1.distribution).toEqual([item, 2])
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

describe('rewriteRenamedReferences', () => {
  it('keeps __proto__-keyed params, tool params and record members while rewriting them', () => {
    const { workflow } = canonical(
      workflowState([blockState('a2', 'function', 'Report', { code: 'return <fetch.x>' })])
    )
    const params = workflow.blocks.report.params
    setOwn(params, '__proto__', { kind: 'value', value: JSON.parse('{"__proto__":"<fetch.y>"}') })
    setOwn(params, 'tools', {
      kind: 'tools',
      tools: [{ type: 'http', params: JSON.parse('{"__proto__":"<fetch.z>"}'), modes: {} }],
    })
    const rewritten = rewriteRenamedReferences(workflow, [{ from: 'fetch', to: 'load' }])
    const out = rewritten.blocks.report.params
    expect(Object.hasOwn(out, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(getOwn(out, '__proto__')).toEqual({
      kind: 'value',
      value: JSON.parse('{"__proto__":"<load.y>"}'),
    })
    const tools = getOwn(out, 'tools')
    expect(tools?.kind === 'tools' && Object.hasOwn(tools.tools[0].params, '__proto__')).toBe(true)
    expect(tools?.kind === 'tools' && getOwn(tools.tools[0].params, '__proto__')).toBe('<load.z>')
  })
})

describe('renamedReferenceRewriter', () => {
  it('rewrites swapped and chained renames at once, never a token a rename already wrote', () => {
    const swap = renamedReferenceRewriter([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ])
    expect(swap('<a.x> <B.y>')).toBe('<b.x> <a.y>')

    const chain = renamedReferenceRewriter([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ])
    expect(chain('<a.x> <b.y>')).toBe('<b.x> <c.y>')
  })
})
