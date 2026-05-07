import { describe, expect, it } from 'vitest'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'

const metadata: ExecutionMetadata = {
  requestId: 'request-1',
  executionId: 'execution-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  triggerType: 'manual',
  startTime: '2026-05-06T00:00:00.000Z',
}

describe('ExecutionSnapshot', () => {
  it('normalizes untyped persisted execution state at construction', () => {
    const variable = { id: 'var-1', name: 'brand', type: 'plain', value: 'myfitness' }

    const snapshot = new ExecutionSnapshot(
      metadata,
      { blocks: [] },
      {},
      [variable],
      ['agent.content', 123, 'function.result']
    )

    expect(snapshot.workflowVariables).toEqual({ 'var-1': variable })
    expect(snapshot.selectedOutputs).toEqual(['agent.content', 'function.result'])
  })
})
