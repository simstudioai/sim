import { describe, expect, it } from 'vitest'
import { withResumeNext } from './paused-run'

const paused = {
  runId: 'run_top',
  workflowId: 'wf_1',
  status: 'paused',
  output: { response: { data: { _resume: { contextId: 'ctx_9', executionId: 'exec_9' } } } },
}

describe('withResumeNext', () => {
  it('names the exact resume command, with the pause context and the execution its links name', () => {
    expect(withResumeNext('executeWorkflow', paused)).toEqual({
      ...paused,
      next: 'sim workflows runs resume exec_9 --workflow wf_1 --context ctx_9',
    })
  })

  it('falls back to the run id, and to the paused record context, when the output names none', () => {
    expect(withResumeNext('executeWorkflow', { ...paused, output: null })).toMatchObject({
      next: 'sim workflows runs resume run_top --workflow wf_1',
    })
    expect(
      withResumeNext('getWorkflowRun', { ...paused, output: undefined, paused: { contextId: 'c' } })
    ).toMatchObject({ next: 'sim workflows runs resume run_top --workflow wf_1 --context c' })
  })

  it('leaves a run that is not paused, another operation and an existing next as they were', () => {
    const done = { ...paused, status: 'completed' }
    expect(withResumeNext('executeWorkflow', done)).toBe(done)
    expect(withResumeNext('listWorkflowRuns', paused)).toBe(paused)
    const hinted = { ...paused, next: 'x' }
    expect(withResumeNext('executeWorkflow', hinted)).toBe(hinted)
    expect(withResumeNext('executeWorkflow', null)).toBeNull()
  })
})
