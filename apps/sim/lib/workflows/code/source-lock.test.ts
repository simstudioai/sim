import {
  type CanonicalBlock,
  type CanonicalizeResult,
  encodeAnchor,
  parseSourceMeta,
  parseWorkflowLock,
  type WorkflowSourceMetaV1,
} from '@sim/workflow-code'
import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  buildLockFromState,
  hintsFromSourceMeta,
  mergeSourceMetaFromLock,
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
      annotations: { comments: {} },
    },
  }
}

const meta = (patch: Partial<WorkflowSourceMetaV1>): WorkflowSourceMetaV1 => ({
  version: 1,
  idents: {},
  order: {},
  comments: {},
  ...patch,
})

describe('buildLockFromState', () => {
  it('derives an ident and an order for blocks source meta does not know, after stored orders', () => {
    const lock = buildLockFromState(
      meta({ idents: { 'id-1': 'first' }, order: { 'id-1': 7 } }),
      canonicalOf([
        { id: 'id-1', name: 'Zeta' },
        { id: 'id-2', name: 'Fetch user' },
        { id: 'id-3', name: 'Alpha' },
      ])
    )
    expect(lock.blocks.zeta).toMatchObject({ ident: 'first', order: 7 })
    expect(lock.blocks.alpha).toMatchObject({ ident: 'alpha', order: 8 })
    expect(lock.blocks.fetchuser).toMatchObject({ ident: 'fetchUser', order: 9 })
  })

  it('prefers what the printer wrote over source meta, and never reuses an ident', () => {
    const lock = buildLockFromState(
      meta({ idents: { 'id-1': 'slack', 'id-2': 'other' } }),
      canonicalOf([
        { id: 'id-1', name: 'Slack' },
        { id: 'id-2', name: 'Other' },
      ]),
      { blocks: { slack: { ident: 'slack2', order: 0 }, other: { ident: 'slack2', order: 1 } } }
    )
    expect(lock.blocks.slack.ident).toBe('slack2')
    expect(lock.blocks.other.ident).not.toBe('slack2')
  })

  it('ignores unusable stored idents instead of writing an invalid lock', () => {
    const lock = buildLockFromState(
      meta({ idents: { 'id-1': 'workflow' } }),
      canonicalOf([{ id: 'id-1', name: 'Workflow step' }])
    )
    expect(lock.blocks.workflowstep.ident).toBe('workflowStep')
  })
})

describe('hintsFromSourceMeta', () => {
  it('re-keys hints and comments to the current keys and skips ids that left the graph', () => {
    const sourceMeta = meta({
      idents: { 'id-1': 'fetchUser', gone: 'stale' },
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
    const inputs = hintsFromSourceMeta(
      sourceMeta,
      canonicalOf([{ id: 'id-1', name: 'Load user' }], { retries: 'var-1' })
    )
    expect(inputs.hints).toEqual({ blocks: { loaduser: { ident: 'fetchUser', order: 2 } } })
    expect(Object.keys(inputs.comments).sort()).toEqual(['block:loaduser', 'var:retries'])
  })
})

describe('mergeSourceMetaFromLock', () => {
  it('stores the compiled idents, order and comments under ids and drops deleted blocks', () => {
    const lock = buildLockFromState(
      null,
      canonicalOf([
        { id: 'id-1', name: 'Fetch' },
        { id: 'id-2', name: 'Send' },
      ])
    )
    const merged = mergeSourceMetaFromLock(
      meta({ idents: { 'id-gone': 'old' }, 'x-keep': true }),
      lock,
      {
        hints: { blocks: { fetch: { ident: 'getIt', order: 1 }, send: { order: 0 } } },
        workflow: {
          annotations: {
            comments: {
              [encodeAnchor({ kind: 'block', block: 'send' })]: [
                { text: ' notify', kind: 'line', placement: 'leading' },
              ],
              [encodeAnchor({ kind: 'block', block: 'nosuchblock' })]: [
                { text: ' dropped', kind: 'line', placement: 'leading' },
              ],
              [encodeAnchor({ kind: 'header' })]: [
                { text: ' kept', kind: 'line', placement: 'leading' },
              ],
            },
          },
        },
      }
    )
    expect(merged.idents).toEqual({ 'id-1': 'getIt', 'id-2': 'send' })
    expect(merged.order).toEqual({ 'id-1': 1, 'id-2': 0 })
    expect(Object.keys(merged.comments).sort()).toEqual(['block:id-2', 'header'])
    expect(merged['x-keep']).toBe(true)
    expect(parseSourceMeta(merged).diagnostics).toBeUndefined()
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
  it('every assembled lock is valid, whatever source meta holds', () => {
    fc.assert(
      fc.property(
        graphArb,
        fc.dictionary(
          fc.constantFrom('id-0', 'id-1', 'id-2', 'gone'),
          nameArb.map((n) => n.replace(/ /g, ''))
        ),
        (stored, idents) => {
          const lock = buildLockFromState(meta({ idents }), canonicalOf(stored))
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
        const stored2 = mergeSourceMetaFromLock(null, first, {
          hints: { blocks: {} },
          workflow: { annotations: { comments: {} } },
        })
        expect(buildLockFromState(stored2, canonical)).toEqual(first)
      })
    )
  })

  it('renaming every block on the canvas changes no ident or order', () => {
    fc.assert(
      fc.property(graphArb, (stored) => {
        const first = buildLockFromState(null, canonicalOf(stored))
        const sourceMeta = mergeSourceMetaFromLock(null, first, {
          hints: { blocks: {} },
          workflow: { annotations: { comments: {} } },
        })
        const renamed = buildLockFromState(
          sourceMeta,
          canonicalOf(stored.map(({ id }) => ({ id, name: `Renamed ${id}` })))
        )
        const byId = (lock: typeof first) =>
          Object.fromEntries(Object.values(lock.blocks).map((b) => [b.id, [b.ident, b.order]]))
        expect(byId(renamed)).toEqual(byId(first))
      })
    )
  })
})
