/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ForkClearedRef, ForkMappingEntry } from '@/lib/api/contracts/workspace-fork'
import {
  buildForkResolveItems,
  type ForkResolveInputs,
  forkResolveProgress,
} from '@/ee/workspace-forking/components/fork-sync/resolve-items'

const entry = (overrides: Partial<ForkMappingEntry> = {}): ForkMappingEntry => ({
  kind: 'table',
  resourceType: 'table',
  sourceId: 'src-1',
  sourceLabel: 'Leads',
  targetId: null,
  suggested: false,
  required: false,
  sourceDeleted: false,
  candidates: [],
  candidatesTruncated: false,
  ...overrides,
})

const clearedRef = (overrides: Partial<ForkClearedRef> = {}): ForkClearedRef =>
  ({
    cause: 'reference',
    kind: 'table',
    sourceId: 'src-1',
    sourceLabel: 'Leads',
    sourceDeleted: false,
    targetWorkflowId: 'wf-1',
    workflowName: 'Support triage',
    blockId: 'blk-1',
    blockLabel: 'Enrich',
    fieldLabel: 'Table',
    ...overrides,
  }) as ForkClearedRef

const inputs = (overrides: Partial<ForkResolveInputs> = {}): ForkResolveInputs => ({
  entries: [],
  targetFor: (candidate) => candidate.targetId ?? '',
  copyingKeys: new Set(),
  droppedRefs: new Set(),
  reconfigPendingKeys: new Set(),
  reconfigPendingCounts: new Map(),
  blockingRefs: [],
  dependentClears: [],
  ...overrides,
})

describe('buildForkResolveItems', () => {
  it('marks a mapped entry resolved and says nothing more about it', () => {
    const [item] = buildForkResolveItems(inputs({ entries: [entry({ targetId: 'tgt-1' })] }))
    expect(item.status).toBe('mapped')
    expect(item.detail).toBeNull()
  })

  it('marks a copy-selected entry as a copy rather than as unmapped', () => {
    const [item] = buildForkResolveItems(
      inputs({ entries: [entry()], copyingKeys: new Set(['table:src-1']) })
    )
    expect(item.status).toBe('copied')
  })

  it('blocks an unmapped copyable and names both ways out', () => {
    const [item] = buildForkResolveItems(
      inputs({ entries: [entry()], blockingRefs: [clearedRef()] })
    )
    expect(item.status).toBe('blocking')
    expect(item.detail).toContain('Enrich would lose Table in Support triage')
    expect(item.detail).toContain('Map it to an existing table or copy it across')
  })

  it('blocks a required entry even when no cleared-ref names it', () => {
    // Credentials and secrets never reach the cleared-ref collector, so the required gate is the
    // only thing that can flag them — and the row still has to explain itself.
    const [item] = buildForkResolveItems(
      inputs({ entries: [entry({ kind: 'credential', required: true })] })
    )
    expect(item.status).toBe('blocking')
    expect(item.detail).toBe('Required. Map it to a credential in the target workspace.')
  })

  it('offers a drop only for a source-deleted reference, counting the fields it covers', () => {
    const deleted = clearedRef({ sourceDeleted: true })
    const [item] = buildForkResolveItems(
      inputs({
        entries: [entry()],
        blockingRefs: [deleted, clearedRef({ sourceDeleted: true, fieldLabel: 'Rows' })],
      })
    )
    expect(item.dropFieldCount).toBe(2)
    expect(item.detail).toContain('drop it from all 2 fields')
  })

  it('never offers a drop for a live unmapped copyable', () => {
    const [item] = buildForkResolveItems(
      inputs({ entries: [entry()], blockingRefs: [clearedRef()] })
    )
    expect(item.dropFieldCount).toBeNull()
  })

  it('moves an acknowledged drop out of blocking and states the consequence', () => {
    const [item] = buildForkResolveItems(
      inputs({
        entries: [entry()],
        blockingRefs: [clearedRef({ sourceDeleted: true })],
        droppedRefs: new Set(['table:src-1']),
      })
    )
    expect(item.status).toBe('dropped')
    expect(item.detail).toContain('Every field naming it will be cleared')
  })

  it('reports a resolved entry with an empty required dependent as needing setup', () => {
    const [item] = buildForkResolveItems(
      inputs({
        entries: [entry({ targetId: 'tgt-1' })],
        reconfigPendingKeys: new Set(['table:src-1']),
        reconfigPendingCounts: new Map([['table:src-1', 2]]),
      })
    )
    expect(item.status).toBe('needs-setup')
    expect(item.detail).toBe('2 required fields still need values.')
  })

  it('gives a cross-workflow reference its own row, since no mapping entry can resolve it', () => {
    const items = buildForkResolveItems(
      inputs({
        blockingRefs: [
          clearedRef({
            cause: 'workflow',
            kind: 'workflow',
            sourceId: 'wf-2',
            sourceLabel: 'Billing sync',
          }),
        ],
      })
    )
    expect(items).toHaveLength(1)
    expect(items[0].entry).toBeNull()
    expect(items[0].detail).toContain('Deploy “Billing sync” in the source workspace')
  })

  it('orders the rows by how much they still need', () => {
    const items = buildForkResolveItems(
      inputs({
        entries: [
          entry({ sourceId: 'a', sourceLabel: 'Mapped', targetId: 'tgt' }),
          entry({ sourceId: 'b', sourceLabel: 'Blocking' }),
          entry({ sourceId: 'c', sourceLabel: 'Setup', targetId: 'tgt-2' }),
        ],
        blockingRefs: [clearedRef({ sourceId: 'b' })],
        reconfigPendingKeys: new Set(['table:c']),
        reconfigPendingCounts: new Map([['table:c', 1]]),
      })
    )
    expect(items.map((item) => item.status)).toEqual(['blocking', 'needs-setup', 'mapped'])
  })
})

describe('forkResolveProgress', () => {
  it('counts an unresolved optional reference as neither resolved nor blocking', () => {
    const items = buildForkResolveItems(
      inputs({
        entries: [
          entry({ sourceId: 'a', targetId: 'tgt' }),
          entry({ sourceId: 'b' }),
          entry({ sourceId: 'c' }),
        ],
        blockingRefs: [clearedRef({ sourceId: 'c' })],
      })
    )
    expect(forkResolveProgress(items)).toEqual({
      total: 3,
      resolved: 1,
      blocking: 1,
      needsSetup: 0,
    })
  })
})
