/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { DeployedWorkflowSummary } from '@/ee/workspace-forking/lib/copy/deploy-bridge'
import type {
  ForkCopyableLabel,
  ForkCopyableSourceResource,
} from '@/ee/workspace-forking/lib/mapping/resources'
import {
  assembleForkCopyableUnmapped,
  buildForkPromotePlanItems,
  buildPromoteWorkflowIdMap,
  collectForkArchivedTargets,
  collectForkCopyableIdsByKind,
  collectForkUnreferencedCopyables,
} from '@/ee/workspace-forking/lib/promote/promote-plan'
import type { ForkReference } from '@/ee/workspace-forking/lib/remap/remap-references'

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

  it('still seeds a sync-excluded mapped pair (sibling references keep resolving)', () => {
    // An excluded workflow never becomes an item, but its identity pair survives
    // (source exists + target active), so a synced sibling that references it
    // repoints to the existing target instead of clearing.
    const map = buildPromoteWorkflowIdMap({
      identityMap: new Map([['excluded-src', 'excluded-tgt']]),
      existingSourceIds: new Set(['excluded-src']),
      targetActiveIds: new Set(['excluded-tgt']),
      items: [{ sourceWorkflowId: 'a-src', targetWorkflowId: 'a-tgt' }],
    })
    expect(map.get('excluded-src')).toBe('excluded-tgt')
  })
})

const deployed = (id: string, name = id): DeployedWorkflowSummary => ({
  id,
  name,
  description: null,
  folderId: null,
  sortOrder: 0,
  isPublicApi: false,
})

/**
 * `buildForkPromotePlanItems` decides which deployed source workflows a promote
 * writes and how (replace vs create), and implements the target side of
 * "Exclude from sync": an excluded mapped target must never be replaced. These
 * cases lock in that a skipped target is reported (for the diff preview) and
 * never written.
 */
describe('buildForkPromotePlanItems', () => {
  it('classifies a mapped-active target as replace (carrying its name) and an unmapped source as create', () => {
    const { items, excludedTargets } = buildForkPromotePlanItems({
      deployedSourceWorkflows: [deployed('a-src', 'Alpha'), deployed('b-src', 'Beta')],
      sourceStateIds: new Set(['a-src', 'b-src']),
      identityMap: new Map([['a-src', 'a-tgt']]),
      targetActiveIds: new Set(['a-tgt']),
      targetNameById: new Map([['a-tgt', 'Alpha (prod)']]),
      excludedTargetIds: new Set(),
    })
    expect(excludedTargets).toEqual([])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      sourceWorkflowId: 'a-src',
      targetWorkflowId: 'a-tgt',
      targetName: 'Alpha (prod)',
      mode: 'replace',
    })
    expect(items[1]).toMatchObject({ sourceWorkflowId: 'b-src', targetName: null, mode: 'create' })
    expect(items[1].targetWorkflowId).not.toBe('b-src')
  })

  it('skips a source whose state failed to load', () => {
    const { items } = buildForkPromotePlanItems({
      deployedSourceWorkflows: [deployed('a-src')],
      sourceStateIds: new Set(),
      identityMap: new Map(),
      targetActiveIds: new Set(),
      targetNameById: new Map(),
      excludedTargetIds: new Set(),
    })
    expect(items).toEqual([])
  })

  it('never replaces a sync-excluded mapped target and reports it for the preview', () => {
    const { items, excludedTargets } = buildForkPromotePlanItems({
      deployedSourceWorkflows: [deployed('a-src', 'Alpha'), deployed('b-src', 'Beta')],
      sourceStateIds: new Set(['a-src', 'b-src']),
      identityMap: new Map([
        ['a-src', 'a-tgt'],
        ['b-src', 'b-tgt'],
      ]),
      targetActiveIds: new Set(['a-tgt', 'b-tgt']),
      targetNameById: new Map([
        ['a-tgt', 'Alpha (prod)'],
        ['b-tgt', 'Beta (prod)'],
      ]),
      excludedTargetIds: new Set(['b-tgt']),
    })
    expect(items.map((item) => item.sourceWorkflowId)).toEqual(['a-src'])
    expect(excludedTargets).toEqual([{ id: 'b-tgt', name: 'Beta (prod)' }])
  })

  it('treats an excluded-but-archived mapped target as create (recreated fresh, like any dead target)', () => {
    // Exclusion protects a LIVE target. Once the target is archived the identity
    // match already fails, so the source recreates a fresh (non-excluded) copy -
    // same as the pre-existing dead-target behavior.
    const { items, excludedTargets } = buildForkPromotePlanItems({
      deployedSourceWorkflows: [deployed('a-src')],
      sourceStateIds: new Set(['a-src']),
      identityMap: new Map([['a-src', 'a-tgt']]),
      targetActiveIds: new Set(),
      targetNameById: new Map(),
      excludedTargetIds: new Set(['a-tgt']),
    })
    expect(excludedTargets).toEqual([])
    expect(items).toHaveLength(1)
    expect(items[0].mode).toBe('create')
  })
})

/**
 * `collectForkArchivedTargets` removes previously-mapped targets whose source was
 * deleted. These cases lock in the two protections: a source that still EXISTS
 * (even excluded/undeployed) never archives its counterpart, and a sync-excluded
 * target is never archived even when its source is gone.
 */
describe('collectForkArchivedTargets', () => {
  const workflowRow = (parentResourceId: string, childResourceId: string | null) => ({
    resourceType: 'workflow',
    parentResourceId,
    childResourceId,
  })

  it('archives a mapped active target whose source was deleted', () => {
    const { archivedTargetIds, archivedTargets, excludedTargets } = collectForkArchivedTargets({
      mappingRows: [workflowRow('gone-src', 'gone-tgt')],
      sourceIsParent: true,
      existingSourceIds: new Set(),
      writtenTargetIds: new Set(),
      targetActiveIds: new Set(['gone-tgt']),
      targetNameById: new Map([['gone-tgt', 'Gone']]),
      excludedTargetIds: new Set(),
    })
    expect(archivedTargetIds).toEqual(['gone-tgt'])
    expect(archivedTargets).toEqual([{ id: 'gone-tgt', name: 'Gone' }])
    expect(excludedTargets).toEqual([])
  })

  it('keeps a target whose source still exists (a sync-excluded source never archives its counterpart)', () => {
    // The caller builds existingSourceIds from ALL non-archived source workflows,
    // independent of the deployed/excluded source set - so an excluded source
    // stays "existing" and its previously-synced counterpart is left untouched.
    const { archivedTargetIds } = collectForkArchivedTargets({
      mappingRows: [workflowRow('excluded-src', 'mapped-tgt')],
      sourceIsParent: true,
      existingSourceIds: new Set(['excluded-src']),
      writtenTargetIds: new Set(),
      targetActiveIds: new Set(['mapped-tgt']),
      targetNameById: new Map([['mapped-tgt', 'Mapped']]),
      excludedTargetIds: new Set(),
    })
    expect(archivedTargetIds).toEqual([])
  })

  it('never archives a sync-excluded target, reporting it for the preview instead', () => {
    const { archivedTargetIds, excludedTargets } = collectForkArchivedTargets({
      mappingRows: [workflowRow('gone-src', 'protected-tgt')],
      sourceIsParent: true,
      existingSourceIds: new Set(),
      writtenTargetIds: new Set(),
      targetActiveIds: new Set(['protected-tgt']),
      targetNameById: new Map([['protected-tgt', 'Protected']]),
      excludedTargetIds: new Set(['protected-tgt']),
    })
    expect(archivedTargetIds).toEqual([])
    expect(excludedTargets).toEqual([{ id: 'protected-tgt', name: 'Protected' }])
  })

  it('skips written targets, inactive targets, unfilled mappings, and non-workflow rows', () => {
    const { archivedTargetIds } = collectForkArchivedTargets({
      mappingRows: [
        workflowRow('gone-1', 'written-tgt'),
        workflowRow('gone-2', 'archived-tgt'),
        workflowRow('gone-3', null),
        { resourceType: 'table', parentResourceId: 'gone-4', childResourceId: 'tbl-tgt' },
      ],
      sourceIsParent: true,
      existingSourceIds: new Set(),
      writtenTargetIds: new Set(['written-tgt']),
      targetActiveIds: new Set(['written-tgt']),
      targetNameById: new Map(),
      excludedTargetIds: new Set(),
    })
    expect(archivedTargetIds).toEqual([])
  })

  it('orients source/target by direction (pull: child is the source side)', () => {
    const { archivedTargetIds } = collectForkArchivedTargets({
      mappingRows: [workflowRow('parent-tgt', 'child-src')],
      sourceIsParent: false,
      existingSourceIds: new Set(),
      writtenTargetIds: new Set(),
      targetActiveIds: new Set(['parent-tgt']),
      targetNameById: new Map([['parent-tgt', 'Parent']]),
      excludedTargetIds: new Set(),
    })
    expect(archivedTargetIds).toEqual(['parent-tgt'])
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
        referenced: true,
      },
      {
        kind: 'file',
        sourceId: 'fk-1',
        label: 'a.png',
        parentId: 'fld-1',
        parentLabel: 'Folder',
        referenced: true,
      },
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

describe('collectForkUnreferencedCopyables', () => {
  const source = (
    kind: ForkCopyableSourceResource['kind'],
    sourceId: string,
    label = sourceId
  ): ForkCopyableSourceResource => ({ kind, sourceId, label, parentId: null, parentLabel: null })

  const referencedCandidate = (kind: ForkCopyableSourceResource['kind'], sourceId: string) => ({
    kind,
    sourceId,
    label: sourceId,
    parentId: null,
    parentLabel: null,
    referenced: true,
  })

  it('emits an unmapped source resource no synced workflow references, flagged referenced: false', () => {
    const result = collectForkUnreferencedCopyables(
      [source('table', 'tbl-new', 'Scratch table')],
      [],
      () => null
    )
    expect(result).toEqual([
      {
        kind: 'table',
        sourceId: 'tbl-new',
        label: 'Scratch table',
        parentId: null,
        parentLabel: null,
        referenced: false,
      },
    ])
  })

  it('dedupes against the referenced candidate set (a referenced resource is never double-listed)', () => {
    const result = collectForkUnreferencedCopyables(
      [source('knowledge-base', 'kb-1'), source('knowledge-base', 'kb-new')],
      [referencedCandidate('knowledge-base', 'kb-1')],
      () => null
    )
    expect(result.map((candidate) => candidate.sourceId)).toEqual(['kb-new'])
  })

  it('excludes a resource with a persisted mapping (idempotency: a prior copy is never re-offered)', () => {
    // A resource copied by a prior sync resolves through its workspace_fork_resource_map row.
    const result = collectForkUnreferencedCopyables(
      [source('skill', 'sk-copied'), source('skill', 'sk-new')],
      [],
      (kind, sourceId) => (kind === 'skill' && sourceId === 'sk-copied' ? 'sk-target' : null)
    )
    expect(result.map((candidate) => candidate.sourceId)).toEqual(['sk-new'])
  })

  it('does not confuse the same id across kinds when deduping or resolving', () => {
    const result = collectForkUnreferencedCopyables(
      [source('table', 'shared-id'), source('skill', 'shared-id')],
      [referencedCandidate('table', 'shared-id')],
      () => null
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'skill', sourceId: 'shared-id', referenced: false })
  })

  it('carries a file candidate keyed by storage key with its folder grouping', () => {
    const result = collectForkUnreferencedCopyables(
      [
        {
          kind: 'file',
          sourceId: 'workspace/SRC/new.png',
          label: 'new.png',
          parentId: 'fld-1',
          parentLabel: 'Images',
        },
      ],
      [],
      () => null
    )
    expect(result).toEqual([
      {
        kind: 'file',
        sourceId: 'workspace/SRC/new.png',
        label: 'new.png',
        parentId: 'fld-1',
        parentLabel: 'Images',
        referenced: false,
      },
    ])
  })
})
