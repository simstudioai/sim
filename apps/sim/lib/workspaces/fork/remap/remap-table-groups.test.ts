/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { TableSchema } from '@/lib/table/types'
import {
  buildForkBlockIdResolver,
  deriveForkBlockId,
} from '@/lib/workspaces/fork/remap/block-identity'
import { remapForkTableWorkflowGroups } from '@/lib/workspaces/fork/remap/remap-table-groups'

describe('remapForkTableWorkflowGroups', () => {
  it('remaps a manual group workflowId and outputs[].blockId to child ids', () => {
    const map = new Map([['src-wf', 'child-wf']])
    const schema: TableSchema = {
      columns: [{ id: 'col_1', name: 'Out', type: 'string', workflowGroupId: 'g1' }],
      workflowGroups: [
        {
          id: 'g1',
          workflowId: 'src-wf',
          outputs: [{ blockId: 'src-block', path: 'out', columnName: 'col_1' }],
        },
      ],
    }
    const result = remapForkTableWorkflowGroups(schema, map)
    const group = result.workflowGroups?.[0]
    expect(group?.workflowId).toBe('child-wf')
    expect(group?.outputs[0].blockId).toBe(deriveForkBlockId('child-wf', 'src-block'))
    expect(group?.outputs[0].columnName).toBe('col_1')
    expect(result.columns[0].id).toBe('col_1')
    expect(result.columns[0].workflowGroupId).toBe('g1')
  })

  // Promote threads its persisted-pair resolver: a paired block resolves to the pair's target id
  // (on push, the parent's ORIGINAL id - never the derive); an unpaired block falls back to the
  // derive, matching the workflow write path.
  it('prefers a provided block-id resolver (persisted pair) over the derive, deriving unpaired blocks', () => {
    const map = new Map([['src-wf', 'child-wf']])
    const schema: TableSchema = {
      columns: [],
      workflowGroups: [
        {
          id: 'g1',
          workflowId: 'src-wf',
          outputs: [
            { blockId: 'src-block', path: 'out', columnName: 'col_1' },
            { blockId: 'src-unpaired', path: 'out2', columnName: 'col_2' },
          ],
        },
      ],
    }
    const resolver = buildForkBlockIdResolver(true, {
      parentToChild: new Map([
        ['src-block', { targetBlockId: 'original-parent-block', targetWorkflowId: 'child-wf' }],
      ]),
      childToParent: new Map(),
    })
    const result = remapForkTableWorkflowGroups(schema, map, resolver)
    const outputs = result.workflowGroups?.[0].outputs
    expect(outputs?.[0].blockId).toBe('original-parent-block')
    expect(outputs?.[1].blockId).toBe(deriveForkBlockId('child-wf', 'src-unpaired'))
  })

  it('drops a group whose backing workflow was not copied and clears its column wiring', () => {
    const schema: TableSchema = {
      columns: [{ id: 'col_1', name: 'Out', type: 'string', workflowGroupId: 'g1' }],
      workflowGroups: [
        {
          id: 'g1',
          workflowId: 'missing-wf',
          outputs: [{ blockId: 'b', path: 'p', columnName: 'col_1' }],
        },
      ],
    }
    const result = remapForkTableWorkflowGroups(schema, new Map())
    expect(result.workflowGroups).toHaveLength(0)
    expect(result.columns[0].workflowGroupId).toBeUndefined()
    expect(result.columns[0].id).toBe('col_1')
  })

  it('leaves enrichment groups (empty workflowId) untouched', () => {
    const schema: TableSchema = {
      columns: [],
      workflowGroups: [
        {
          id: 'g1',
          workflowId: '',
          enrichmentId: 'enr',
          outputs: [{ blockId: '', path: '', columnName: 'col_1', outputId: 'o' }],
        },
      ],
    }
    const result = remapForkTableWorkflowGroups(schema, new Map([['src-wf', 'child-wf']]))
    expect(result.workflowGroups?.[0]).toEqual(schema.workflowGroups?.[0])
  })

  it('returns the schema unchanged when there are no groups', () => {
    const schema: TableSchema = { columns: [{ id: 'col_1', name: 'A', type: 'string' }] }
    expect(remapForkTableWorkflowGroups(schema, new Map())).toBe(schema)
  })
})
