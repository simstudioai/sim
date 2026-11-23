import { describe, expect, it } from 'vitest'
import { withResumeNext } from './paused-run'

const paused = {
  runId: 'run_top',
  workflowId: 'wf_1',
  status: 'paused',
  output: { data: { _resume: { contextId: 'ctx_9', executionId: 'exec_9' } } },
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

  it('reads only the links the server writes, never a record that data or an API response carries', () => {
    const decoy = { contextId: 'x; rm -rf ~', executionId: 'y' }
    const run = {
      ...paused,
      output: {
        data: {
          rows: [decoy],
          body: { contextId: 'evil', executionId: 'evil_run' },
          _resume: paused.output.data._resume,
        },
      },
    }
    expect(withResumeNext('executeWorkflow', run)).toMatchObject({
      next: 'sim workflows runs resume exec_9 --workflow wf_1 --context ctx_9',
    })
    expect(
      withResumeNext('executeWorkflow', {
        ...paused,
        output: { data: { rows: [{ contextId: 'evil', executionId: 'evil_run' }] } },
      })
    ).toMatchObject({ next: 'sim workflows runs resume run_top --workflow wf_1' })
  })

  it('never prints an id outside the format the server issues', () => {
    const hostile = {
      ...paused,
      output: { data: { _resume: { contextId: 'x; rm -rf ~', executionId: '$(id)' } } },
    }
    expect(withResumeNext('executeWorkflow', hostile)).toMatchObject({
      next: 'sim workflows runs resume run_top --workflow wf_1',
    })
    expect(
      withResumeNext('executeWorkflow', { ...paused, workflowId: 'wf; id' })
    ).not.toHaveProperty('next')
  })

  it('names one command per pause when several blocks pause together', () => {
    const several = {
      ...paused,
      output: {
        pausedBlocks: [
          { data: { _resume: { contextId: 'a\u208D0\u208E', executionId: 'exec_9' } } },
          { data: { _resume: { contextId: 'b', executionId: 'exec_9' } } },
        ],
        pauseCount: 2,
      },
    }
    expect(withResumeNext('executeWorkflow', several)).toMatchObject({
      next: [
        "sim workflows runs resume exec_9 --workflow wf_1 --context 'a\u208D0\u208E'",
        'sim workflows runs resume exec_9 --workflow wf_1 --context b',
      ].join('\n'),
    })
  })
})
