import { describe, expect, it } from 'vitest'
import { withRunNext } from './run-next'

const point = (contextId: string, status = 'paused') => ({ contextId, kind: 'human', status })

const paused = {
  runId: 'run_attempt',
  workflowId: 'wf_1',
  status: 'paused',
  output: { data: { _resume: { contextId: 'decoy', executionId: 'decoy_run' } } },
  paused: { runId: 'run_top', points: [point('ctx_9')] },
}

describe('withRunNext', () => {
  it('names the run the server says the pause is recorded under, not the record run id', () => {
    expect(withRunNext('executeWorkflow', paused)).toEqual({
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
    expect(withRunNext('getWorkflowRun', run)).toMatchObject({
      next: 'sim workflows runs resume run_top --workflow wf_1 --context b',
    })
  })

  it('names no command for a timed pause, which resumes on its own', () => {
    const timed = { contextId: 'later', kind: 'time', status: 'paused' }
    expect(
      withRunNext('executeWorkflow', {
        ...paused,
        paused: { runId: 'run_top', points: [timed, point('ctx_9')] },
      })
    ).toMatchObject({ next: 'sim workflows runs resume run_top --workflow wf_1 --context ctx_9' })
    const onlyTimed = { ...paused, paused: { runId: 'run_top', points: [timed] } }
    expect(withRunNext('executeWorkflow', onlyTimed)).toBe(onlyTimed)
  })

  it('names one command per waiting point, quoting a branch context', () => {
    const several = {
      ...paused,
      paused: { runId: 'run_top', points: [point('a₍0₎'), point('b')] },
    }
    expect(withRunNext('executeWorkflow', several)).toMatchObject({
      next: [
        "sim workflows runs resume run_top --workflow wf_1 --context 'a₍0₎'",
        'sim workflows runs resume run_top --workflow wf_1 --context b',
      ].join('\n'),
    })
  })

  it('leaves a run that is not paused, another operation, an existing next and no paused field as they were', () => {
    const done = { ...paused, status: 'completed' }
    expect(withRunNext('executeWorkflow', done)).toBe(done)
    expect(withRunNext('listWorkflowRuns', paused)).toBe(paused)
    const hinted = { ...paused, next: 'x' }
    expect(withRunNext('executeWorkflow', hinted)).toBe(hinted)
    expect(withRunNext('executeWorkflow', null)).toBeNull()
    const unnamed = { ...paused, paused: null }
    expect(withRunNext('executeWorkflow', unnamed)).toBe(unnamed)
  })

  it('never prints an id outside the format the server issues', () => {
    for (const hostile of [
      { ...paused, paused: { runId: '$(id)', points: [point('ctx_9')] } },
      { ...paused, paused: { runId: 'run_top', points: [point('x; rm -rf ~')] } },
      { ...paused, workflowId: 'wf; id' },
    ]) {
      expect(withRunNext('executeWorkflow', hostile)).not.toHaveProperty('next')
    }
  })
})

describe('withRunNext on a failed run', () => {
  const failed = {
    runId: 'run_9',
    workflowId: 'wf_1',
    status: 'failed',
    output: {},
    error: { message: 'boom', code: 'BLOCK_EXECUTION_FAILED', blockId: 'blk_3' },
  }

  it('names the rerun from the failed block with the run as its source, on a run or a run resource', () => {
    const next = 'sim workflows run wf_1 --from-block blk_3 --source-run run_9'
    expect(withRunNext('executeWorkflow', failed)).toEqual({ ...failed, next })
    expect(withRunNext('getWorkflowRun', failed)).toMatchObject({ next })
  })

  it('names no rerun for a failure no block owns, a parallel branch, or an id the server never issues', () => {
    for (const unnamed of [
      { ...failed, error: { message: 'The run timed out', code: 'TIMEOUT' } },
      { ...failed, error: null },
      { ...failed, error: { ...failed.error, blockId: 'blk_3₍0₎' } },
      { ...failed, error: { ...failed.error, blockId: '$(id)' } },
      { ...failed, runId: 'run; id' },
    ]) {
      expect(withRunNext('executeWorkflow', unnamed)).toBe(unnamed)
    }
  })
})
