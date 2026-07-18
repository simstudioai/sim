import { describe, expect, it } from 'vitest'
import {
  allocateActionIds,
  collectWorkflowIdsFromToolCalls,
  slugifyActionId,
} from '@/lib/apps/demo/backend-handoff'
import type { ToolCallSummary } from '@/lib/copilot/request/types'

function tool(
  partial: Partial<ToolCallSummary> & Pick<ToolCallSummary, 'id' | 'name' | 'status'>
): ToolCallSummary {
  return partial
}

describe('collectWorkflowIdsFromToolCalls', () => {
  it('collects multiple create/edit successes and deduplicates', () => {
    const ids = collectWorkflowIdsFromToolCalls([
      tool({
        id: '1',
        name: 'create_workflow',
        status: 'success',
        result: { workflowId: 'wf-a', workflowName: 'A' },
      }),
      tool({
        id: '2',
        name: 'edit_workflow',
        status: 'success',
        params: { workflowId: 'wf-a' },
        result: { workflowId: 'wf-a' },
      }),
      tool({
        id: '3',
        name: 'create_workflow',
        status: 'success',
        result: { workflowId: 'wf-b' },
      }),
      tool({
        id: '4',
        name: 'edit_workflow',
        status: 'success',
        params: { workflowId: 'wf-c' },
        result: { ok: true },
      }),
    ])
    expect(ids).toEqual(['wf-a', 'wf-b', 'wf-c'])
  })

  it('ignores failed tools and non-workflow tools', () => {
    const ids = collectWorkflowIdsFromToolCalls([
      tool({
        id: '1',
        name: 'create_workflow',
        status: 'error',
        result: { workflowId: 'wf-bad' },
      }),
      tool({
        id: '2',
        name: 'run_workflow',
        status: 'success',
        result: { workflowId: 'wf-run' },
      }),
      tool({
        id: '3',
        name: 'create_workflow',
        status: 'success',
        result: { workflowId: 'wf-good' },
      }),
    ])
    expect(ids).toEqual(['wf-good'])
  })

  it('corroborates with resource workflow ids', () => {
    const ids = collectWorkflowIdsFromToolCalls(
      [
        tool({
          id: '1',
          name: 'create_workflow',
          status: 'success',
          result: { workflowId: 'wf-a' },
        }),
      ],
      ['wf-a', 'wf-resource']
    )
    expect(ids).toEqual(['wf-a', 'wf-resource'])
  })
})

describe('allocateActionIds', () => {
  it('slugifies names and adds collision suffixes', () => {
    expect(slugifyActionId('Lead Router')).toBe('lead_router')
    expect(allocateActionIds(['Lead Router', 'Lead Router', '123 Bad'])).toEqual([
      'lead_router',
      'lead_router_2',
      'action_123_bad',
    ])
  })
})
