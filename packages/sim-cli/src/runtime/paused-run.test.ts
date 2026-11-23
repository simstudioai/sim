import { describe, expect, it } from 'vitest'
import { withResumeNext } from './paused-run'

const point = (contextId: string, status = 'paused') => ({ contextId, kind: 'human', status })

const paused = {
  runId: 'run_attempt',
  workflowId: 'wf_1',
  status: 'paused',
  output: { data: { _resume: { contextId: 'decoy', executionId: 'decoy_run' } } },
  paused: { runId: 'run_top', points: [point('ctx_9')] },
}

describe('withResumeNext', () => {
  it('names the run the server says the pause is recorded under, not the record run id', () => {
    expect(withResumeNext('executeWorkflow', paused)).toEqual({
      ...paused,
      next: 'sim workflows runs resume run_top --workflow wf_1 --context ctx_9',
    })
  })

  it('reads the paused field of a run resource, naming only the points still waiting', () => {
    const run = {
      ...paused,
      output: undefined,
      paused: { contextId: 'b', runId: 'run_top', points: [point('a', 'resumed'), point('b')] },
    }
    expect(withResumeNext('getWorkflowRun', run)).toMatchObject({
      next: 'sim workflows runs resume run_top --workflow wf_1 --context b',
    })
  })

  it('names one command per waiting point, quoting a branch context', () => {
    const several = {
      ...paused,
      paused: { runId: 'run_top', points: [point('a₍0₎'), point('b')] },
    }
    expect(withResumeNext('executeWorkflow', several)).toMatchObject({
      next: [
        "sim workflows runs resume run_top --workflow wf_1 --context 'a₍0₎'",
        'sim workflows runs resume run_top --workflow wf_1 --context b',
      ].join('\n'),
    })
  })

  it('leaves a run that is not paused, another operation, an existing next and no paused field as they were', () => {
    const done = { ...paused, status: 'completed' }
    expect(withResumeNext('executeWorkflow', done)).toBe(done)
    expect(withResumeNext('listWorkflowRuns', paused)).toBe(paused)
    const hinted = { ...paused, next: 'x' }
    expect(withResumeNext('executeWorkflow', hinted)).toBe(hinted)
    expect(withResumeNext('executeWorkflow', null)).toBeNull()
    const unnamed = { ...paused, paused: null }
    expect(withResumeNext('executeWorkflow', unnamed)).toBe(unnamed)
  })

  it('never prints an id outside the format the server issues', () => {
    for (const hostile of [
      { ...paused, paused: { runId: '$(id)', points: [point('ctx_9')] } },
      { ...paused, paused: { runId: 'run_top', points: [point('x; rm -rf ~')] } },
      { ...paused, workflowId: 'wf; id' },
    ]) {
      expect(withResumeNext('executeWorkflow', hostile)).not.toHaveProperty('next')
    }
  })
})
