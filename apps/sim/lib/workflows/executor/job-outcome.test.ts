/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { projectWorkflowJobOutcome } from '@/lib/workflows/executor/job-outcome'

describe('projectWorkflowJobOutcome', () => {
  it('reports a workflow job that completed with a failed workflow as failed', () => {
    expect(
      projectWorkflowJobOutcome({
        type: 'workflow-execution',
        status: 'completed',
        output: { success: false, error: 'planPanels: ValueError' },
      })
    ).toEqual({ status: 'failed', error: 'planPanels: ValueError' })
  })

  it('leaves a resume that reported its cancellation without an error as the queue reported it', () => {
    expect(
      projectWorkflowJobOutcome({
        type: 'resume-execution',
        status: 'completed',
        output: { success: false, status: 'cancelled' },
      })
    ).toEqual({ status: 'completed' })
  })

  it('leaves a job type that never returns a failure result as the queue reported it', () => {
    expect(
      projectWorkflowJobOutcome({
        type: 'webhook-execution',
        status: 'completed',
        output: { success: false, error: 'Gmail 2 is missing required fields: Label' },
      })
    ).toEqual({ status: 'completed' })
  })
})
