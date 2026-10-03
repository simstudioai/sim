import { describe, expect, it } from 'vitest'
import type { ForkClearedRef } from '@/lib/api/contracts/workspace-fork'
import {
  forkSyncBlockerReasonFor,
  selectForkSyncBlockingRefs,
} from '@/ee/workspace-forking/lib/promote/sync-blockers'

type ReferenceRef = Extract<ForkClearedRef, { cause: 'reference' }>
type DependentRef = Extract<ForkClearedRef, { cause: 'dependent' }>

const base = {
  targetWorkflowId: 'wf-tgt',
  workflowName: 'Workflow',
  blockId: 'block-1',
  blockLabel: 'Block',
  fieldLabel: 'Field',
  sourceLabel: 'Source',
}

const referenceRef = (
  kind: ReferenceRef['kind'],
  sourceId: string,
  sourceDeleted = false
): ReferenceRef => ({ ...base, cause: 'reference', kind, sourceId, sourceDeleted })

const workflowRef = (sourceId: string): ForkClearedRef => ({
  ...base,
  cause: 'workflow',
  kind: 'workflow',
  sourceId,
})

const dependentRef = (parentKind: DependentRef['parentKind']): DependentRef => ({
  ...base,
  cause: 'dependent',
  kind: parentKind,
  sourceId: 'parent-src',
  parentKind,
  parentSourceId: 'parent-src',
})

describe('forkSyncBlockerReasonFor', () => {
  it('maps a live unmapped copyable-kind reference to unmapped-copyable (map or copy)', () => {
    for (const kind of [
      'table',
      'knowledge-base',
      'file',
      'custom-tool',
      'skill',
      // External MCP servers are copyable too (config rows; OAuth tokens never copied).
      'mcp-server',
    ] as const) {
      expect(forkSyncBlockerReasonFor(referenceRef(kind, 'src-1'))).toBe('unmapped-copyable')
    }
  })

  it('maps a source-deleted reference of ANY kind to source-deleted (no exemption)', () => {
    expect(forkSyncBlockerReasonFor(referenceRef('table', 'tbl-gone', true))).toBe('source-deleted')
    expect(forkSyncBlockerReasonFor(referenceRef('mcp-server', 'srv-gone', true))).toBe(
      'source-deleted'
    )
    expect(forkSyncBlockerReasonFor(referenceRef('file', 'workspace/SRC/gone.png', true))).toBe(
      'source-deleted'
    )
  })

  it('never blocks a dependent-cause entry (the reconfigure flow owns dependents)', () => {
    expect(forkSyncBlockerReasonFor(dependentRef('credential'))).toBeNull()
    expect(forkSyncBlockerReasonFor(dependentRef('knowledge-base'))).toBeNull()
  })
})

describe('selectForkSyncBlockingRefs / toForkSyncBlockers', () => {
  it('keeps reference + workflow causes with their reasons and drops dependents', () => {
    const refs: ForkClearedRef[] = [
      referenceRef('table', 'tbl-1'),
      referenceRef('mcp-server', 'srv-1'),
      referenceRef('skill', 'sk-gone', true),
      workflowRef('wf-other'),
      dependentRef('credential'),
    ]
    const blocking = selectForkSyncBlockingRefs(refs)
    expect(blocking.map(({ ref, reason }) => [ref.sourceId, reason])).toEqual([
      ['tbl-1', 'unmapped-copyable'],
      ['srv-1', 'unmapped-copyable'],
      ['sk-gone', 'source-deleted'],
      ['wf-other', 'workflow-missing'],
    ])
  })

  it('classifies an unmapped custom block separately from the copyable kinds', () => {
    // A custom block is neither copyable nor clearable: its reference IS the block's type,
    // so an unmapped one keeps invoking the SOURCE environment's block. Blocking on it is
    // the only thing that makes that visible, and it needs its own reason so the resolution
    // copy does not tell the user to "select it for copy".
    expect(forkSyncBlockerReasonFor(referenceRef('custom-block', 'custom_block_abc'))).toBe(
      'unmapped-custom-block'
    )
  })
})
