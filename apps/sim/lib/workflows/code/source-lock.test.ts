import {
  type CanonicalBlock,
  type CanonicalizeResult,
  encodeAnchor,
  parseCodeMeta,
  parseWorkflowLock,
  type WorkflowCodeMetaV1,
} from '@sim/workflow-code'
import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  buildLockFromState,
  codeMetaPrintInputs,
  mergeCodeMetaFromLock,
} from '@/lib/workflows/code/source-lock'

interface StoredBlock {
  id: string
  name: string
}

function block(key: string, name: string): CanonicalBlock {
  return {
    key,
    name,
    type: 'function',
    parent: null,
    enabled: true,
    locked: false,
    triggerMode: false,
    advancedMode: false,
    errorPort: false,
    retry: null,
    params: {},
    modes: {},
  }
}

/** A canonicalize result for a flat graph: key = normalized name, no collisions. */
function canonicalOf(
  stored: StoredBlock[],
  variables: Record<string, string> = {}
): Pick<CanonicalizeResult, 'identity' | 'layout' | 'workflow'> {
  const blocks: Record<string, CanonicalBlock> = {}
  const identity: CanonicalizeResult['identity'] = { blocks: {}, variables }
  for (const { id, name } of stored) {
    const key = normalizeWorkflowBlockName(name)
    blocks[key] = block(key, name)
    identity.blocks[key] = { id, parent: null }
  }
  return {
    identity,
    layout: {},
    workflow: {
      modelVersion: 1,
      meta: { name: 'wf', description: null },
      blocks,
      edges: [],
      variables: {},
      annotations: { inactive: {}, comments: {} },
    },
  }
}

const meta = (patch: Partial<WorkflowCodeMetaV1>): WorkflowCodeMetaV1 => ({
  v: 1,
  bindings: {},
  order: {},
  comments: {},
  ...patch,
})

describe('buildLockFromState', () => {
  it('keeps a block binding and order across a canvas rename (keyed by id, not key)', () => {
    const codeMeta = meta({ bindings: { 'id-1': 'classify' }, order: { 'id-1': 4 } })
    const before = buildLockFromState(codeMeta, canonicalOf([{ id: 'id-1', name: 'Classify' }]))
    const after = buildLockFromState(
      codeMeta,
      canonicalOf([{ id: 'id-1', name: 'Route ticket by intent' }])
    )
    expect(before.blocks.classify).toMatchObject({ id: 'id-1', binding: 'classify', order: 4 })
    expect(after.blocks.routeticketbyintent).toMatchObject({
      id: 'id-1',
      binding: 'classify',
      order: 4,
    })
  })

  it('derives a binding and an order for blocks code_meta does not know, after stored orders', () => {
    const lock = buildLockFromState(
      meta({ bindings: { 'id-1': 'first' }, order: { 'id-1': 7 } }),
      canonicalOf([
        { id: 'id-1', name: 'Zeta' },
        { id: 'id-2', name: 'Fetch user' },
        { id: 'id-3', name: 'Alpha' },
      ])
    )
    expect(lock.blocks.zeta).toMatchObject({ binding: 'first', order: 7 })
    expect(lock.blocks.alpha).toMatchObject({ binding: 'alpha', order: 8 })
    expect(lock.blocks.fetchuser).toMatchObject({ binding: 'fetchUser', order: 9 })
  })

  it('prefers what the printer wrote over code_meta, and never reuses a binding', () => {
    const lock = buildLockFromState(
      meta({ bindings: { 'id-1': 'slack', 'id-2': 'other' } }),
      canonicalOf([
        { id: 'id-1', name: 'Slack' },
        { id: 'id-2', name: 'Other' },
      ]),
      { blocks: { slack: { binding: 'slack2', order: 0 }, other: { binding: 'slack2', order: 1 } } }
    )
    expect(lock.blocks.slack.binding).toBe('slack2')
    expect(lock.blocks.other.binding).not.toBe('slack2')
  })

  it('ignores unusable stored bindings instead of writing an invalid lock', () => {
    const lock = buildLockFromState(
      meta({ bindings: { 'id-1': 'workflow' } }),
      canonicalOf([{ id: 'id-1', name: 'Workflow step' }])
    )
    expect(lock.blocks.workflowstep.binding).toBe('workflowStep')
  })
})

describe('codeMetaPrintInputs', () => {
  it('re-keys hints and comments to the current keys and skips ids that left the graph', () => {
    const codeMeta = meta({
      bindings: { 'id-1': 'fetchUser', gone: 'stale' },
      order: { 'id-1': 2, gone: 0 },
      comments: {
        [encodeAnchor({ kind: 'block', block: 'id-1' })]: [
          { text: ' loads the user', kind: 'line', placement: 'leading' },
        ],
        [encodeAnchor({ kind: 'param', block: 'gone', param: 'code' })]: [
          { text: ' orphan', kind: 'line', placement: 'leading' },
        ],
        [encodeAnchor({ kind: 'var', variable: 'var-1' })]: [
          { text: ' retries', kind: 'line', placement: 'trailing' },
        ],
      },
    })
    const inputs = codeMetaPrintInputs(
      codeMeta,
      canonicalOf([{ id: 'id-1', name: 'Load user' }], { retries: 'var-1' })
    )
    expect(inputs.hints).toEqual({ blocks: { loaduser: { binding: 'fetchUser', order: 2 } } })
    expect(Object.keys(inputs.comments).sort()).toEqual(['block:loaduser', 'var:retries'])
  })
})

describe('mergeCodeMetaFromLock', () => {
  it('stores the compiled bindings, order and comments under ids and drops deleted blocks', () => {
    const lock = buildLockFromState(
      null,
      canonicalOf([
        { id: 'id-1', name: 'Fetch' },
        { id: 'id-2', name: 'Send' },
      ])
    )
    const merged = mergeCodeMetaFromLock(
      meta({ bindings: { 'id-gone': 'old' }, 'x-keep': true }),
      lock,
      {
        hints: { blocks: { fetch: { binding: 'getIt', order: 1 }, send: { order: 0 } } },
        workflow: {
          annotations: {
            inactive: {},
            comments: {
              [encodeAnchor({ kind: 'block', block: 'send' })]: [
                { text: ' notify', kind: 'line', placement: 'leading' },
              ],
              [encodeAnchor({ kind: 'block', block: 'nosuchblock' })]: [
                { text: ' dropped', kind: 'line', placement: 'leading' },
              ],
              header: [{ text: ' kept', kind: 'line', placement: 'leading' }],
            },
          },
        },
      }
    )
    expect(merged.bindings).toEqual({ 'id-1': 'getIt', 'id-2': 'send' })
    expect(merged.order).toEqual({ 'id-1': 1, 'id-2': 0 })
    expect(Object.keys(merged.comments).sort()).toEqual(['block:id-2', 'header'])
    expect(merged['x-keep']).toBe(true)
    expect(parseCodeMeta(merged).diagnostics).toBeUndefined()
  })
})

const nameArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,10}$/)
const graphArb = fc
  .uniqueArray(nameArb, {
    minLength: 1,
    maxLength: 8,
    selector: (name) => normalizeWorkflowBlockName(name),
  })
  .filter((names) => names.every((name) => normalizeWorkflowBlockName(name).length > 0))
  .map((names) => names.map((name, i) => ({ id: `id-${i}`, name })))

describe('lock helper properties', () => {
  it('every assembled lock is valid, whatever code_meta holds', () => {
    fc.assert(
      fc.property(
        graphArb,
        fc.dictionary(
          fc.constantFrom('id-0', 'id-1', 'id-2', 'gone'),
          nameArb.map((n) => n.replace(/ /g, ''))
        ),
        (stored, bindings) => {
          const lock = buildLockFromState(meta({ bindings }), canonicalOf(stored))
          expect(parseWorkflowLock(lock).diagnostics).toBeUndefined()
          expect(Object.keys(lock.blocks)).toHaveLength(stored.length)
        }
      )
    )
  })

  it('apply then read is a fixed point: merging a lock and rebuilding returns the same lock', () => {
    fc.assert(
      fc.property(graphArb, fc.array(fc.nat(20), { maxLength: 8 }), (stored, orders) => {
        const canonical = canonicalOf(stored)
        const first = buildLockFromState(
          meta({ order: Object.fromEntries(orders.map((order, i) => [`id-${i}`, order])) }),
          canonical
        )
        const stored2 = mergeCodeMetaFromLock(null, first, {
          hints: { blocks: {} },
          workflow: { annotations: { inactive: {}, comments: {} } },
        })
        expect(buildLockFromState(stored2, canonical)).toEqual(first)
      })
    )
  })

  it('renaming every block on the canvas changes no binding or order', () => {
    fc.assert(
      fc.property(graphArb, (stored) => {
        const first = buildLockFromState(null, canonicalOf(stored))
        const codeMeta = mergeCodeMetaFromLock(null, first, {
          hints: { blocks: {} },
          workflow: { annotations: { inactive: {}, comments: {} } },
        })
        const renamed = buildLockFromState(
          codeMeta,
          canonicalOf(stored.map(({ id }) => ({ id, name: `Renamed ${id}` })))
        )
        const byId = (lock: typeof first) =>
          Object.fromEntries(Object.values(lock.blocks).map((b) => [b.id, [b.binding, b.order]]))
        expect(byId(renamed)).toEqual(byId(first))
      })
    )
  })
})
