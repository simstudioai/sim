/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { TableSchema } from '@/lib/table/types'
import { deriveForkBlockId } from '@/lib/workspaces/fork/remap/block-identity'
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
