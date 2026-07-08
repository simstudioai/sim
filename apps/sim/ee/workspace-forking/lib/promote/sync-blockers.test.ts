/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ForkClearedRef } from '@/lib/api/contracts/workspace-fork'
import {
  forkSyncBlockerReasonFor,
  selectForkSyncBlockingRefs,
  toForkSyncBlockers,
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

  it('maps a workflow-cause entry to workflow-missing', () => {
    expect(forkSyncBlockerReasonFor(workflowRef('wf-other'))).toBe('workflow-missing')
  })

  it('never blocks a dependent-cause entry (the reconfigure flow owns dependents)', () => {
    expect(forkSyncBlockerReasonFor(dependentRef('credential'))).toBeNull()
    expect(forkSyncBlockerReasonFor(dependentRef('knowledge-base'))).toBeNull()
  })

  it('defensively ignores kinds the collector excludes (credential / env-var / document)', () => {
    // These never reach the cleared list (excluded by the collector); if one leaked, the
    // kind-level required gate owns credentials/env-vars, so this path must not double-block.
    expect(forkSyncBlockerReasonFor(referenceRef('credential', 'c1'))).toBeNull()
    expect(forkSyncBlockerReasonFor(referenceRef('env-var', 'KEY'))).toBeNull()
    expect(forkSyncBlockerReasonFor(referenceRef('knowledge-document', 'doc-1'))).toBeNull()
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

  it('maps blocking entries to the wire blocker shape', () => {
    const blocking = selectForkSyncBlockingRefs([referenceRef('table', 'tbl-1')])
    expect(toForkSyncBlockers(blocking)).toEqual([
      {
        workflowName: 'Workflow',
        blockLabel: 'Block',
        fieldLabel: 'Field',
        kind: 'table',
        sourceId: 'tbl-1',
        sourceLabel: 'Source',
        reason: 'unmapped-copyable',
      },
    ])
  })
})
