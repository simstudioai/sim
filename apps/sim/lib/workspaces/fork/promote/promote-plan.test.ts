/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ForkCopyableLabel } from '@/lib/workspaces/fork/mapping/resources'
import {
  assembleForkCopyableUnmapped,
  buildPromoteWorkflowIdMap,
  collectForkCopyableIdsByKind,
} from '@/lib/workspaces/fork/promote/promote-plan'
import type { ForkReference } from '@/lib/workspaces/fork/remap/remap-references'

const ref = (kind: ForkReference['kind'], sourceId: string): ForkReference => ({
  kind,
  sourceId,
  subBlockKey: 'sb',
  required: false,
})

/**
 * `buildPromoteWorkflowIdMap` decides which cross-workflow references survive a
 * promote: the resulting map is handed to `remapWorkflowReferencesInSubBlocks`,
 * where a hit repoints the reference and a miss (with `clearUnmapped`) blanks it.
 * These cases lock in the seed/overlay matrix so the "mapped sibling not in this
 * push" repoint and the "deleted / archived / never-mapped" clears can't drift.
 */
describe('buildPromoteWorkflowIdMap', () => {
  it("overlays this push's items (replace + create)", () => {
    const map = buildPromoteWorkflowIdMap({
      identityMap: new Map(),
      existingSourceIds: new Set(),
      targetActiveIds: new Set(),
      items: [
        { sourceWorkflowId: 'a-src', targetWorkflowId: 'a-tgt' },
        { sourceWorkflowId: 'b-src', targetWorkflowId: 'b-new' },
      ],
    })
    expect(map.get('a-src')).toBe('a-tgt')
    expect(map.get('b-src')).toBe('b-new')
    expect(map.size).toBe(2)
  })

  it('repoints a mapped sibling that is not in this push when source exists and target is active', () => {
    // B is mapped + still deployed in the target but undeployed in the source, so it
    // is not an item this push. A references B and must keep pointing at target-B.
    const map = buildPromoteWorkflowIdMap({
      identityMap: new Map([['b-src', 'b-tgt']]),
      existingSourceIds: new Set(['b-src']),
      targetActiveIds: new Set(['b-tgt']),
      items: [{ sourceWorkflowId: 'a-src', targetWorkflowId: 'a-tgt' }],
    })
    expect(map.get('b-src')).toBe('b-tgt')
    expect(map.get('a-src')).toBe('a-tgt')
  })

  it('does not seed a mapped pair whose source was deleted (reference clears)', () => {
    const map = buildPromoteWorkflowIdMap({
      identityMap: new Map([['b-src', 'b-tgt']]),
      existingSourceIds: new Set(), // b-src deleted in the source
      targetActiveIds: new Set(['b-tgt']),
      items: [],
    })
    expect(map.has('b-src')).toBe(false)
  })

  it('does not seed a mapped pair whose target was archived (reference clears)', () => {
    const map = buildPromoteWorkflowIdMap({
      identityMap: new Map([['b-src', 'b-tgt']]),
      existingSourceIds: new Set(['b-src']),
      targetActiveIds: new Set(), // b-tgt archived by a prior push
      items: [],
    })
    expect(map.has('b-src')).toBe(false)
  })

  it('does not map a workflow that was never mapped (reference clears)', () => {
    const map = buildPromoteWorkflowIdMap({
      identityMap: new Map([['b-src', 'b-tgt']]),
      existingSourceIds: new Set(['b-src', 'c-src']),
      targetActiveIds: new Set(['b-tgt']),
      items: [],
    })
    expect(map.has('c-src')).toBe(false)
  })

  it('lets this push override a stale identity mapping (re-created target wins)', () => {
    const map = buildPromoteWorkflowIdMap({
      identityMap: new Map([['s', 't-old']]),
      existingSourceIds: new Set(['s']),
      targetActiveIds: new Set(['t-old']),
      items: [{ sourceWorkflowId: 's', targetWorkflowId: 't-new' }],
    })
    expect(map.get('s')).toBe('t-new')
  })
})

describe('collectForkCopyableIdsByKind', () => {
  it('groups copyable kinds and ignores non-copyable kinds (credential / env-var)', () => {
    const byKind = collectForkCopyableIdsByKind([
      ref('knowledge-base', 'kb-1'),
      ref('knowledge-base', 'kb-2'),
      ref('table', 'tbl-1'),
      ref('credential', 'cred-1'),
      ref('env-var', 'API_KEY'),
      ref('custom-tool', 'ct-1'),
      ref('skill', 'sk-1'),
      ref('file', 'fk-1'),
    ])
    expect(byKind).toEqual({
      'knowledge-base': ['kb-1', 'kb-2'],
      table: ['tbl-1'],
      'custom-tool': ['ct-1'],
      skill: ['sk-1'],
      file: ['fk-1'],
    })
  })
})

describe('assembleForkCopyableUnmapped', () => {
  const flat = (label: string): ForkCopyableLabel => ({ label, parentId: null, parentLabel: null })

  it('emits a candidate per copyable ref whose label resolved, carrying its labels', () => {
    const labels = new Map<string, ForkCopyableLabel>([
      ['knowledge-base:kb-1', flat('Docs KB')],
      ['file:fk-1', { label: 'a.png', parentId: 'fld-1', parentLabel: 'Folder' }],
    ])
    const result = assembleForkCopyableUnmapped(
      [ref('knowledge-base', 'kb-1'), ref('file', 'fk-1'), ref('credential', 'cred-1')],
      labels
    )
    expect(result).toEqual([
      {
        kind: 'knowledge-base',
        sourceId: 'kb-1',
        label: 'Docs KB',
        parentId: null,
        parentLabel: null,
      },
      { kind: 'file', sourceId: 'fk-1', label: 'a.png', parentId: 'fld-1', parentLabel: 'Folder' },
    ])
  })

  it('drops a copyable ref whose label is missing (no longer exists in the source)', () => {
    expect(assembleForkCopyableUnmapped([ref('knowledge-base', 'kb-gone')], new Map())).toEqual([])
  })

  it('ignores non-copyable kinds entirely (credential / env-var)', () => {
    const result = assembleForkCopyableUnmapped(
      [ref('credential', 'cred-1'), ref('env-var', 'API_KEY')],
      new Map([['credential:cred-1', flat('X')]])
    )
    expect(result).toEqual([])
  })
})
