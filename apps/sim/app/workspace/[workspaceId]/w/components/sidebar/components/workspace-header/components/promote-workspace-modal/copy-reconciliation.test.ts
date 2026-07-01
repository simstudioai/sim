/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ForkCopyableUnmapped, ForkMappingEntry } from '@/lib/api/contracts/workspace-fork'
import {
  effectiveForkTarget,
  forkCopyingKeys,
  forkMappedCopyableKeys,
  forkRefKey,
  forkRequiredPending,
  forkVisibleCopyables,
  isForkRequiredComplete,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/promote-workspace-modal/copy-reconciliation'

const entry = (overrides: Partial<ForkMappingEntry>): ForkMappingEntry => ({
  kind: 'credential',
  resourceType: 'oauth_credential',
  sourceId: 'src',
  sourceLabel: 'Src',
  targetId: null,
  suggested: false,
  required: false,
  candidates: [],
  candidatesTruncated: false,
  ...overrides,
})

const copyable = (overrides: Partial<ForkCopyableUnmapped>): ForkCopyableUnmapped => ({
  kind: 'knowledge-base',
  sourceId: 'kb',
  label: 'KB',
  parentId: null,
  parentLabel: null,
  ...overrides,
})

describe('forkRefKey / effectiveForkTarget', () => {
  it('shares the kind:sourceId keyspace for entries and copyables', () => {
    expect(forkRefKey({ kind: 'knowledge-base', sourceId: 'kb-1' })).toBe('knowledge-base:kb-1')
    expect(forkRefKey(entry({ kind: 'table', sourceId: 't-1' }))).toBe('table:t-1')
  })

  it('prefers an in-session override, else the persisted target, else empty', () => {
    const e = entry({ kind: 'table', sourceId: 't-1', targetId: 'persisted' })
    expect(effectiveForkTarget(e, { 'table:t-1': 'in-session' })).toBe('in-session')
    expect(effectiveForkTarget(e, {})).toBe('persisted')
    expect(effectiveForkTarget(entry({ kind: 'table', sourceId: 't-1' }), {})).toBe('')
  })
})

describe('copy-vs-map reconciliation', () => {
  it('drops a mapped copyable from the visible copy list (maps win over copy)', () => {
    const entries = [
      entry({ kind: 'knowledge-base', sourceId: 'kb-1', targetId: 'kb-tgt' }),
      entry({ kind: 'table', sourceId: 'tbl-1' }),
    ]
    const candidates = [
      copyable({ kind: 'knowledge-base', sourceId: 'kb-1' }),
      copyable({ kind: 'table', sourceId: 'tbl-1' }),
    ]
    const mapped = forkMappedCopyableKeys(entries, {})
    expect(mapped.has('knowledge-base:kb-1')).toBe(true)
    expect(mapped.has('table:tbl-1')).toBe(false)
    expect(forkVisibleCopyables(candidates, mapped).map(forkRefKey)).toEqual(['table:tbl-1'])
  })

  it('an in-session mapping target also drops the copyable', () => {
    const entries = [entry({ kind: 'knowledge-base', sourceId: 'kb-1' })]
    const mapped = forkMappedCopyableKeys(entries, { 'knowledge-base:kb-1': 'kb-tgt' })
    expect(
      forkVisibleCopyables([copyable({ kind: 'knowledge-base', sourceId: 'kb-1' })], mapped)
    ).toEqual([])
  })

  it('copyingKeys = the visible candidates that are selected for copy', () => {
    const visible = [
      copyable({ kind: 'table', sourceId: 'tbl-1' }),
      copyable({ kind: 'skill', sourceId: 'sk-1' }),
    ]
    expect([...forkCopyingKeys(visible, new Set(['table:tbl-1']))]).toEqual(['table:tbl-1'])
  })
})

describe('isForkRequiredComplete', () => {
  it('a required ref is satisfied by a mapping target', () => {
    const entries = [
      entry({ kind: 'credential', sourceId: 'c1', required: true, targetId: 'c-tgt' }),
    ]
    expect(isForkRequiredComplete(entries, {}, new Set())).toBe(true)
  })

  it('a required ref is satisfied by a copy selection (server accepts copy as resolving it)', () => {
    const entries = [entry({ kind: 'knowledge-base', sourceId: 'kb-1', required: true })]
    expect(isForkRequiredComplete(entries, {}, new Set(['knowledge-base:kb-1']))).toBe(true)
  })

  it('a required ref neither mapped nor copied blocks', () => {
    const entries = [entry({ kind: 'credential', sourceId: 'c1', required: true })]
    expect(isForkRequiredComplete(entries, {}, new Set())).toBe(false)
  })

  it('optional refs never block', () => {
    const entries = [entry({ kind: 'table', sourceId: 't1', required: false })]
    expect(isForkRequiredComplete(entries, {}, new Set())).toBe(true)
  })
})

describe('forkRequiredPending', () => {
  it('is true when a required ref is neither mapped nor selected for copy', () => {
    const items = [entry({ kind: 'credential', sourceId: 'c1', required: true })]
    expect(forkRequiredPending(items, {}, new Set())).toBe(true)
  })

  it('is false when the required ref is selected for copy', () => {
    const items = [entry({ kind: 'knowledge-base', sourceId: 'kb-1', required: true })]
    expect(forkRequiredPending(items, {}, new Set(['knowledge-base:kb-1']))).toBe(false)
  })

  it('is false when the required ref is mapped', () => {
    const items = [entry({ kind: 'credential', sourceId: 'c1', required: true, targetId: 'c-tgt' })]
    expect(forkRequiredPending(items, {}, new Set())).toBe(false)
  })
})
