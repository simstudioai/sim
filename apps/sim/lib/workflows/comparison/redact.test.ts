import { describe, expect, it, vi } from 'vitest'
import { generateWorkflowDiffSummary } from '@/lib/workflows/comparison/compare'
import { redactWorkflowDiffSummary } from '@/lib/workflows/comparison/redact'
import { getBlock } from '@/blocks/registry'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/** Secrets can change without their values becoming part of the public delta. */
describe('public workflow comparison', () => {
  it('distinguishes a block setting from a credential subblock with the same name', () => {
    vi.mocked(getBlock).mockReturnValue({
      ...getBlock('agent')!,
      subBlocks: [{ id: 'enabled', type: 'short-input', password: true }],
    })
    const before: WorkflowState = {
      blocks: {
        node: {
          id: 'node',
          type: 'function',
          name: 'Node',
          enabled: true,
          position: { x: 0, y: 0 },
          outputs: {},
          subBlocks: { enabled: { id: 'enabled', type: 'short-input', value: 'private-before' } },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      lastSaved: 0,
    }
    const after = structuredClone(before)
    after.blocks.node.enabled = false
    after.blocks.node.subBlocks.enabled.value = 'private-after'
    const result = redactWorkflowDiffSummary(
      generateWorkflowDiffSummary(after, before),
      before,
      after
    )
    expect(result.modifiedBlocks[0].changes).toEqual([
      {
        scope: 'block',
        field: 'enabled',
        oldValue: { kind: 'value', value: true },
        newValue: { kind: 'value', value: false },
      },
      {
        scope: 'subblock',
        field: 'enabled',
        oldValue: { kind: 'redacted' },
        newValue: { kind: 'redacted' },
      },
    ])
  })

  it('preserves secret-only changes while withholding passwords and opaque tables', () => {
    const definition = getBlock('agent')!
    vi.mocked(getBlock).mockReturnValue({
      ...definition,
      subBlocks: [
        { id: 'deployKey', type: 'short-input', password: true },
        { id: 'headers', type: 'table' },
        { id: 'code', type: 'code' },
      ],
    })
    const state = (secret: string, code: string): WorkflowState => ({
      blocks: {
        fn: {
          id: 'fn',
          name: 'Function',
          type: 'function',
          enabled: true,
          position: { x: 0, y: 0 },
          outputs: {},
          subBlocks: {
            deployKey: { id: 'deployKey', type: 'short-input', value: secret },
            headers: {
              id: 'headers',
              type: 'table',
              value: [{ id: 'row', cells: { Key: 'X-Key', Value: secret } }],
            },
            code: { id: 'code', type: 'code', value: code },
          },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      lastSaved: 0,
    })
    const before = state('private-before', 'return 1')
    const after = state('private-after', 'return 2')
    const result = redactWorkflowDiffSummary(
      generateWorkflowDiffSummary(after, before),
      before,
      after
    )
    expect(result.hasChanges).toBe(true)
    expect(JSON.stringify(result)).not.toContain('private-')
    const fields = result.modifiedBlocks[0].changes
    expect(fields.find((change) => change.field === 'deployKey')).toMatchObject({
      oldValue: { kind: 'redacted' },
      newValue: { kind: 'redacted' },
    })
    expect(fields.find((change) => change.field === 'headers')).toMatchObject({
      oldValue: { kind: 'redacted' },
      newValue: { kind: 'redacted' },
    })
    expect(fields.find((change) => change.field === 'code')).toMatchObject({
      oldValue: { kind: 'value', value: 'return 1' },
      newValue: { kind: 'value', value: 'return 2' },
    })
    expect(before.blocks.fn.subBlocks.deployKey.value).toBe('private-before')
  })
})
