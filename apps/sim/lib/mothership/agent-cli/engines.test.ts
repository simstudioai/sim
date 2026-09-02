/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { buildWorkflowLintReport } = vi.hoisted(() => ({
  buildWorkflowLintReport: vi.fn().mockResolvedValue({
    sources: ['block-1'],
    sinks: ['block-2'],
    orphanBlocks: [],
    emptyOutgoingPorts: [],
    invalidBranchPorts: [],
    invalidConnectionTargets: [],
    fieldIssues: [
      {
        blockId: 'block-2',
        blockName: 'Summarize emails',
        missingRequiredFields: ['model'],
        inactiveModeValues: [],
      },
    ],
    unresolvedReferences: [],
  }),
}))

vi.mock('@/lib/workflows/editing/lint-report', () => ({ buildWorkflowLintReport }))

import { runEngine } from '@/lib/mothership/agent-cli/engines'
import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'

const WORKFLOW_STATE = {
  blocks: {
    'block-1': { type: 'starter', name: 'Start', enabled: true },
    'block-2': { type: 'agent', name: 'Summarize emails', enabled: true },
  },
  edges: [{ source: 'block-1', target: 'block-2', sourceHandle: 'source', id: 'edge-1' }],
  variables: { apiBase: 'https://api.example.com' },
}

function runtimeWith(responses: Record<string, unknown>): AgentCliRuntime {
  return {
    workspaceId: 'ws-1',
    userId: 'user-1',
    client: {
      request: async <T>(path: string): Promise<T> => {
        const hit = responses[path]
        if (hit === undefined) throw new Error(`Unexpected request: ${path}`)
        return hit as T
      },
    },
  }
}

const STATE_PATH = '/api/v2/workflows/wf-1/state'
const stateResponse = { data: WORKFLOW_STATE }

describe('workflows lint', () => {
  it('lints a workflow through the shared engine with the caller scoped as subject', async () => {
    const result = await runEngine(
      'workflows lint',
      ['wf-1'],
      runtimeWith({ [STATE_PATH]: stateResponse }),
      {}
    )
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.fieldIssues).toHaveLength(1)
    expect(report.summary.length).toBeGreaterThan(0)
    expect(buildWorkflowLintReport).toHaveBeenCalledWith(expect.anything(), {
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
      subjectUserId: 'user-1',
    })
  })

  it('surfaces execution errors as a failed result, never a throw', async () => {
    const result = await runEngine('workflows lint', ['wf-missing'], runtimeWith({}), {})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unexpected request')
  })
})
