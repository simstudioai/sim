import { omit } from '@sim/utils/object'
import { describe, expect, it } from 'vitest'
import { encodeAnchor } from '../anchors'
import type { LockIdentity } from '../lock'
import {
  blockState,
  canonical,
  draftOf,
  edge,
  workflowState,
} from '../materialize/fixtures.test-helpers'
import type { CanonicalWorkflow, CodeComment } from '../model'
import { setOwn } from '../records'
import { diffCanonical, renamesBetween, replacedBetween } from '.'

const base = canonical(
  workflowState(
    [
      blockState('start', 'start_trigger', 'Start'),
      blockState('l1', 'loop', 'Each', {}, { data: { loopType: 'for', count: 2 } }),
      blockState('a1', 'function', 'Fetch', { code: 'return 1' }),
      blockState('a2', 'function', 'Report', { code: 'return 2' }),
      blockState('s1', 'slack', 'Notify', { operation: 'send', channel: 'C1' }),
    ],
    {
      edges: [edge('e1', 'start', 'a1'), edge('e2', 'a1', 'a2'), edge('e3', 'a2', 's1')],
      variables: {
        v1: { id: 'v1', name: 'Count', type: 'number', value: 1 },
        v2: { id: 'v2', name: 'Gone', type: 'string', value: '' },
      },
    }
  )
)

function edit(change: (draft: CanonicalWorkflow) => void): CanonicalWorkflow {
  const draft: CanonicalWorkflow = draftOf(base.workflow)
  change(draft)
  return draft
}

function rename(draft: CanonicalWorkflow, from: string, to: string, name: string) {
  draft.blocks[to] = { ...draft.blocks[from], key: to, name }
  draft.blocks = omit(draft.blocks, [from])
  draft.edges = draft.edges.map((e) => ({
    ...e,
    from: e.from === from ? to : e.from,
    to: e.to === from ? to : e.to,
  }))
}

const LINE: CodeComment = { text: ' note', kind: 'line', placement: 'leading' }

describe('diffCanonical', () => {
  it('is a no-op for equal workflows, whatever the edge order and annotations', () => {
    const target = edit((draft) => {
      draft.edges.reverse()
      draft.annotations.comments = { [encodeAnchor({ kind: 'block', block: 'fetch' })]: [LINE] }
    })
    expect(diffCanonical(base.workflow, target).noop).toBe(true)
  })

  it('names params, modes, attributes and reparenting per block', () => {
    const target = edit((draft) => {
      draft.blocks.fetch.params.code = { kind: 'value', value: 'return 3' }
      draft.blocks.fetch.parent = 'each'
      draft.blocks.notify.modes.channel = 'advanced'
      draft.blocks.notify.enabled = false
      draft.blocks.report.retry = { enabled: true, maxTries: 3, waitBetweenTriesMs: 1000 }
      draft.meta.description = 'now described'
    })
    const diff = diffCanonical(base.workflow, target)
    expect(diff.noop).toBe(false)
    expect(diff.meta).toEqual(['description'])
    expect(diff.blocks.modified).toEqual([
      {
        key: 'fetch',
        baseKey: 'fetch',
        changes: [
          { kind: 'attribute', attribute: 'parent' },
          { kind: 'param', param: 'code' },
        ],
      },
      { key: 'report', baseKey: 'report', changes: [{ kind: 'attribute', attribute: 'retry' }] },
      {
        key: 'notify',
        baseKey: 'notify',
        changes: [
          { kind: 'attribute', attribute: 'enabled' },
          { kind: 'mode', canonicalParamId: 'channel' },
        ],
      },
    ])
  })

  it('lists removed blocks by key, whatever order the stored blocks loaded in', () => {
    const reordered = draftOf(base.workflow)
    reordered.blocks = Object.fromEntries(Object.entries(reordered.blocks).reverse())
    const target = edit((draft) => {
      draft.blocks = omit(draft.blocks, ['fetch', 'report'])
      draft.edges = []
    })

    expect(diffCanonical(reordered, target).blocks.removed).toEqual(['fetch', 'report'])
  })

  it('reports added and removed blocks, edges and variables', () => {
    const target = edit((draft) => {
      draft.blocks = omit(draft.blocks, ['report'])
      draft.edges = draft.edges.filter((e) => e.from !== 'report' && e.to !== 'report')
      draft.blocks.extra = { ...draft.blocks.fetch, key: 'extra', name: 'Extra' }
      draft.edges.push({ from: 'fetch', port: { kind: 'error' }, to: 'extra' })
      draft.variables = omit(draft.variables, ['gone'])
      draft.variables.count.value = 2
      draft.variables.fresh = { key: 'fresh', name: 'Fresh', type: 'plain', value: 'x' }
    })
    const diff = diffCanonical(base.workflow, target)
    expect(diff.blocks.added).toEqual(['extra'])
    expect(diff.blocks.removed).toEqual(['report'])
    expect(diff.edges.added).toEqual([{ from: 'fetch', port: { kind: 'error' }, to: 'extra' }])
    expect(diff.edges.removed).toEqual([
      { from: 'fetch', port: { kind: 'out' }, to: 'report' },
      { from: 'report', port: { kind: 'out' }, to: 'notify' },
    ])
    expect(diff.variables).toEqual({ added: ['fresh'], removed: ['gone'], modified: ['count'] })
  })

  it('reads a variable keyed like an Object.prototype member as absent from the other side', () => {
    const target = edit((draft) => {
      setOwn(draft.variables, 'constructor', {
        key: 'constructor',
        name: 'constructor',
        type: 'plain',
        value: 'x',
      })
    })
    const diff = diffCanonical(base.workflow, target)
    expect(diff.variables).toEqual({ added: ['constructor'], removed: [], modified: [] })
    expect(diffCanonical(target, base.workflow).variables).toEqual({
      added: [],
      removed: ['constructor'],
      modified: [],
    })
  })

  it('pairs a rename through renames so no edge moves, and without it removes plus adds', () => {
    const target = edit((draft) => rename(draft, 'fetch', 'load', 'Load'))
    const paired = diffCanonical(base.workflow, target, new Map([['load', 'fetch']]))
    expect(paired.blocks.renamed).toEqual([{ from: 'fetch', to: 'load' }])
    expect(paired.blocks.added).toEqual([])
    expect(paired.blocks.modified).toEqual([
      { key: 'load', baseKey: 'fetch', changes: [{ kind: 'attribute', attribute: 'name' }] },
    ])
    expect(paired.edges).toEqual({ added: [], removed: [] })

    const unpaired = diffCanonical(base.workflow, target)
    expect(unpaired.blocks.added).toEqual(['load'])
    expect(unpaired.blocks.removed).toEqual(['fetch'])
    expect(unpaired.edges.added).toHaveLength(2)
  })

  it('maps a renamed parent to its base key before comparing parents', () => {
    const nested = edit((draft) => {
      draft.blocks.fetch.parent = 'each'
    })
    const target = draftOf(nested)
    rename(target, 'each', 'every', 'Every')
    target.blocks.fetch.parent = 'every'
    const diff = diffCanonical(nested, target, new Map([['every', 'each']]))
    expect(diff.blocks.modified.map((m) => m.key)).toEqual(['every'])
  })

  it('derives renames from two identities by block id', () => {
    const target = edit((draft) => rename(draft, 'fetch', 'load', 'Load'))
    const blocks: LockIdentity['blocks'] = {
      ...base.identity.blocks,
      load: base.identity.blocks.fetch,
    }
    const targetIdentity = { ...base.identity, blocks: omit(blocks, ['fetch']) }
    const renames = renamesBetween(base.identity, targetIdentity)
    expect([...renames]).toEqual([['load', 'fetch']])
    expect(diffCanonical(base.workflow, target, renames).blocks.added).toEqual([])
  })
  it('pairs two blocks that swap display names by id, so only their names change', () => {
    const target = edit((draft) => {
      const { fetch, report } = draft.blocks
      draft.blocks.report = { ...fetch, key: 'report', name: 'Report' }
      draft.blocks.fetch = { ...report, key: 'fetch', name: 'Fetch' }
      const swap = (key: string) => (key === 'fetch' ? 'report' : key === 'report' ? 'fetch' : key)
      draft.edges = draft.edges.map((e) => ({ ...e, from: swap(e.from), to: swap(e.to) }))
    })
    const diff = diffCanonical(
      base.workflow,
      target,
      new Map([
        ['report', 'fetch'],
        ['fetch', 'report'],
      ])
    )
    expect(diff.blocks.renamed).toEqual([
      { from: 'fetch', to: 'report' },
      { from: 'report', to: 'fetch' },
    ])
    expect(diff.blocks.modified.map((m) => [m.key, m.changes])).toEqual([
      ['report', [{ kind: 'attribute', attribute: 'name' }]],
      ['fetch', [{ kind: 'attribute', attribute: 'name' }]],
    ])
    expect(diff.blocks.added).toEqual([])
    expect(diff.edges).toEqual({ added: [], removed: [] })
  })

  it('reports a block replaced under its key (a retype gets a new id) as removed plus added', () => {
    const target = edit((draft) => {
      draft.blocks.report = { ...draft.blocks.report, type: 'agent', params: {} }
    })
    const identity = {
      ...base.identity,
      blocks: { ...base.identity.blocks, report: { ...base.identity.blocks.report, id: 'new-id' } },
    }
    const replaced = replacedBetween(base.identity, identity)
    expect([...replaced]).toEqual(['report'])

    const diff = diffCanonical(base.workflow, target, new Map(), replaced)

    expect(diff.blocks.added).toEqual(['report'])
    expect(diff.blocks.removed).toEqual(['report'])
    expect(diff.blocks.modified).toEqual([])
    expect(diff.edges.added).toHaveLength(2)
    expect(diff.edges.removed).toHaveLength(2)
  })
  it('pairs a chain rename, where one block takes the key another leaves, without a delete', () => {
    const target = edit((draft) => {
      const { fetch, report } = draft.blocks
      draft.blocks.load = { ...fetch, key: 'load', name: 'Load' }
      draft.blocks.fetch = { ...report, key: 'fetch', name: 'Fetch' }
      draft.blocks = omit(draft.blocks, ['report'])
      const moved = (key: string) => (key === 'fetch' ? 'load' : key === 'report' ? 'fetch' : key)
      draft.edges = draft.edges.map((e) => ({ ...e, from: moved(e.from), to: moved(e.to) }))
    })
    const diff = diffCanonical(
      base.workflow,
      target,
      new Map([
        ['load', 'fetch'],
        ['fetch', 'report'],
      ])
    )
    expect(diff.blocks.removed).toEqual([])
    expect(diff.blocks.added).toEqual([])
    expect(diff.edges).toEqual({ added: [], removed: [] })
  })
})
