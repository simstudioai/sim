import { describe, expect, it } from 'vitest'
import type { ForkCopyableUnmapped, ForkMappingEntry } from '@/lib/api/contracts/workspace-fork'
import {
  forkCopyingKeys,
  forkDefaultCopySelection,
  forkMappedCopyableKeys,
  forkParentResolution,
  forkRefKey,
  forkRequiredPending,
  forkVisibleCopyables,
  isForkRequiredComplete,
} from '@/ee/workspace-forking/components/fork-sync/copy-reconciliation'

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
  referenced: true,
  ...overrides,
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
})

describe('forkDefaultCopySelection', () => {
  it('seeds every referenced candidate and leaves unreferenced ones unselected', () => {
    const selection = forkDefaultCopySelection([
      copyable({ kind: 'knowledge-base', sourceId: 'kb-1', referenced: true }),
      copyable({ kind: 'table', sourceId: 'tbl-new', referenced: false }),
      copyable({ kind: 'file', sourceId: 'workspace/SRC/new.png', referenced: false }),
    ])
    expect(selection).toEqual(new Set(['knowledge-base:kb-1']))
  })
})

describe('isForkRequiredComplete', () => {
  it('a required ref is satisfied by a copy selection (server accepts copy as resolving it)', () => {
    const entries = [entry({ kind: 'knowledge-base', sourceId: 'kb-1', required: true })]
    expect(isForkRequiredComplete(entries, {}, new Set(['knowledge-base:kb-1']))).toBe(true)
  })

  it('a required ref neither mapped nor copied blocks', () => {
    const entries = [entry({ kind: 'credential', sourceId: 'c1', required: true })]
    expect(isForkRequiredComplete(entries, {}, new Set())).toBe(false)
  })

  it('a referenced MCP server (map-only, required) blocks until mapped - copy cannot satisfy it', () => {
    const entries = [
      entry({ kind: 'mcp-server', resourceType: 'mcp_server', sourceId: 'srv-1', required: true }),
    ]
    // MCP servers are never copy candidates, so the copy set can't contain them; only a
    // mapping target resolves the entry.
    expect(isForkRequiredComplete(entries, {}, new Set())).toBe(false)
    expect(isForkRequiredComplete(entries, { 'mcp-server:srv-1': 'srv-tgt' }, new Set())).toBe(true)
  })

  it('a source-deleted referenced resource (required, no copy candidate) blocks until mapped', () => {
    // A deleted source is dropped from the copy candidates (its label lookup fails), so the
    // only resolution is mapping the dead id to a live target resource.
    const entries = [
      entry({ kind: 'table', resourceType: 'table', sourceId: 'tbl-gone', required: true }),
    ]
    expect(isForkRequiredComplete(entries, {}, new Set())).toBe(false)
    expect(isForkRequiredComplete(entries, { 'table:tbl-gone': 'tbl-live' }, new Set())).toBe(true)
  })
})

describe('forkParentResolution', () => {
  const kb = entry({ kind: 'knowledge-base', sourceId: 'kb-1' })

  it('is mapped with a persisted or in-session target, unresolved with neither', () => {
    expect(
      forkParentResolution(
        entry({ kind: 'knowledge-base', sourceId: 'kb-1', targetId: 'kb-tgt' }),
        {},
        new Set()
      )
    ).toBe('mapped')
    expect(forkParentResolution(kb, { 'knowledge-base:kb-1': 'kb-tgt' }, new Set())).toBe('mapped')
    expect(forkParentResolution(kb, {}, new Set())).toBe('unresolved')
  })

  it('toggling copy⇄map flips the resolution (the selector scope + seed follow it)', () => {
    // Copy-selected: the dependent selectors browse the SOURCE parent.
    const copying = new Set(['knowledge-base:kb-1'])
    expect(forkParentResolution(kb, {}, copying)).toBe('copied')
    // The user maps a target instead: the mapped entry drops out of the visible copyables
    // (copy-vs-map reconciliation), so its copying key disappears and the resolution flips.
    const targets = { 'knowledge-base:kb-1': 'kb-tgt' }
    const mappedKeys = forkMappedCopyableKeys([kb], targets)
    const copyingAfterMap = forkCopyingKeys(
      forkVisibleCopyables([copyable({ kind: 'knowledge-base', sourceId: 'kb-1' })], mappedKeys),
      copying
    )
    expect(forkParentResolution(kb, targets, copyingAfterMap)).toBe('mapped')
    // Back to copy ('' target override): the copyable is visible + still selected again.
    const cleared = { 'knowledge-base:kb-1': '' }
    const copyingAfterClear = forkCopyingKeys(
      forkVisibleCopyables(
        [copyable({ kind: 'knowledge-base', sourceId: 'kb-1' })],
        forkMappedCopyableKeys([kb], cleared)
      ),
      copying
    )
    expect(forkParentResolution(kb, cleared, copyingAfterClear)).toBe('copied')
  })
})

describe('forkRequiredPending', () => {
  it('is true when a required ref is neither mapped nor selected for copy', () => {
    const items = [entry({ kind: 'credential', sourceId: 'c1', required: true })]
    expect(forkRequiredPending(items, {}, new Set())).toBe(true)
  })
})
