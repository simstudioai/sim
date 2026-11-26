import { describe, expect, it } from 'vitest'
import { withRunNext } from './run-next'

const point = (contextId: string, status = 'paused') => ({ contextId, kind: 'human', status })

/** `next` as `withRunNext` adds it, matched by its command. */
const nextCommand = (command: string) => ({ next: { command, reason: expect.any(String) } })

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
      ...nextCommand('sim workflows runs resume run_top --workflow wf_1 --context ctx_9'),
    })
  })

  it('reads the paused field of a run resource, naming only the points still waiting', () => {
    const run = {
      ...paused,
      output: undefined,
      paused: { contextId: 'b', runId: 'run_top', points: [point('a', 'resumed'), point('b')] },
    }
    expect(withRunNext('getWorkflowRun', run)).toMatchObject(
      nextCommand('sim workflows runs resume run_top --workflow wf_1 --context b')
    )
  })

  it('names no command for a timed pause, which resumes on its own', () => {
    const timed = { contextId: 'later', kind: 'time', status: 'paused' }
    expect(
      withRunNext('executeWorkflow', {
        ...paused,
        paused: { runId: 'run_top', points: [timed, point('ctx_9')] },
      })
    ).toMatchObject(
      nextCommand('sim workflows runs resume run_top --workflow wf_1 --context ctx_9')
    )
    const onlyTimed = { ...paused, paused: { runId: 'run_top', points: [timed] } }
    expect(withRunNext('executeWorkflow', onlyTimed)).toBe(onlyTimed)
  })

  it('names one command per waiting point, quoting a branch context', () => {
    const several = {
      ...paused,
      paused: { runId: 'run_top', points: [point('a₍0₎'), point('b')] },
    }
    expect(withRunNext('executeWorkflow', several)).toMatchObject(
      nextCommand(
        [
          "sim workflows runs resume run_top --workflow wf_1 --context 'a₍0₎'",
          'sim workflows runs resume run_top --workflow wf_1 --context b',
        ].join('\n')
      )
    )
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
    error: {
      message: 'boom',
      code: 'BLOCK_EXECUTION_FAILED',
      blockId: 'blk_3',
      rerunFromBlockId: 'blk_3',
    },
  }

  it('names the rerun from the block the server says it starts at, with the run as its source', () => {
    const next = nextCommand('sim workflows run wf_1 --from-block blk_3 --source-run run_9')
    expect(withRunNext('executeWorkflow', failed)).toEqual({ ...failed, ...next })
    expect(withRunNext('getWorkflowRun', failed)).toMatchObject(next)
  })

  it('reruns a failure inside a loop or parallel from the container the server names, not the failed block', () => {
    const inLoop = { ...failed, error: { ...failed.error, rerunFromBlockId: 'loop_1' } }
    expect(withRunNext('executeWorkflow', inLoop)).toMatchObject(
      nextCommand('sim workflows run wf_1 --from-block loop_1 --source-run run_9')
    )
  })

  it('keeps a test run a test: a dry run with its allowed blocks, a workflow test dry', () => {
    const overrides = { allow: ['blk_1', 'wf_child.blk_c1'], mocks: [] }
    const next = nextCommand(
      'sim workflows run wf_1 --from-block blk_3 --source-run run_9 --dry --allow blk_1 --allow wf_child.blk_c1'
    )
    expect(withRunNext('executeWorkflow', { ...failed, overrides })).toMatchObject(next)
    expect(withRunNext('getWorkflowRun', { ...failed, trigger: 'test', overrides })).toMatchObject(
      next
    )
    expect(
      withRunNext('getWorkflowRun', { ...failed, trigger: 'test', overrides: null })
    ).toMatchObject(
      nextCommand('sim workflows run wf_1 --from-block blk_3 --source-run run_9 --dry')
    )
    expect(
      withRunNext('getWorkflowRun', { ...failed, trigger: 'manual', overrides: null })
    ).toMatchObject(nextCommand('sim workflows run wf_1 --from-block blk_3 --source-run run_9'))
    for (const allow of [['$(id)'], ['$(id).blk_1'], ['wf_child.x y']]) {
      const hostile = { ...failed, overrides: { allow, mocks: [] } }
      expect(withRunNext('executeWorkflow', hostile)).toBe(hostile)
    }
  })

  it('reads mocks again from the run they came from, and names the ones it cannot read instead of a placeholder', () => {
    const fromRun = {
      allow: [],
      mocks: ['blk_2', 'wf_child.blk_c2'],
      mocksFrom: { runId: 'run_1', blocks: ['blk_4'] },
    }
    const withSource = withRunNext('executeWorkflow', { ...failed, overrides: fromRun })
    expect(withSource).toMatchObject({
      ...nextCommand(
        'sim workflows run wf_1 --from-block blk_3 --source-run run_9 --dry --mock-from run_1 --mock blk_4'
      ),
      nextNote: expect.stringContaining('blk_2, wf_child.blk_c2'),
    })
    expect(JSON.stringify(withSource)).not.toContain('<json>')

    const passedOnly = { allow: [], mocks: ['blk_2', 'blk_5', 'wf_child.blk_c2'] }
    const sideEffects = {
      stubbed: [],
      unreached: [{ workflowId: 'wf_1', blockId: 'blk_5', block: 'Notify', kind: 'mock' }],
    }
    const reached = withRunNext('executeWorkflow', {
      ...failed,
      overrides: passedOnly,
      sideEffects,
    })
    expect(reached).toMatchObject({
      ...nextCommand(
        'sim workflows run wf_1 --from-block blk_3 --source-run run_9 --dry --mock-from run_9 --mock blk_2'
      ),
      nextNote: expect.stringContaining('blk_5, wf_child.blk_c2'),
    })
    expect(JSON.stringify(reached)).not.toContain('<json>')

    expect(
      withRunNext('getWorkflowRun', { ...failed, trigger: 'test', overrides: passedOnly })
    ).toMatchObject({
      ...nextCommand('sim workflows run wf_1 --from-block blk_3 --source-run run_9 --dry'),
      nextNote: expect.stringContaining('blk_2, blk_5, wf_child.blk_c2'),
    })
    expect(withRunNext('executeWorkflow', failed)).not.toHaveProperty('nextNote')

    for (const hostile of [
      { ...fromRun, mocksFrom: { runId: 'run 1', blocks: ['blk_4'] } },
      { ...fromRun, mocks: ["wf_child.x'y"] },
    ]) {
      const record = { ...failed, overrides: hostile }
      expect(withRunNext('executeWorkflow', record)).toBe(record)
    }
  })

  it('names no resume for a paused test run, which is never resumed', () => {
    const pausedTest = { ...paused, trigger: 'test' }
    expect(withRunNext('getWorkflowRun', pausedTest)).toBe(pausedTest)
  })

  it('names no rerun when the server names no start block, or an id it never issues', () => {
    const unstartable = { message: 'boom', code: 'BLOCK_EXECUTION_FAILED', blockId: 'blk_3' }
    for (const unnamed of [
      { ...failed, error: { message: 'The run timed out', code: 'TIMEOUT' } },
      { ...failed, error: null },
      { ...failed, error: unstartable },
      { ...failed, error: { ...failed.error, rerunFromBlockId: '$(id)' } },
      { ...failed, runId: 'run; id' },
    ]) {
      expect(withRunNext('executeWorkflow', unnamed)).toBe(unnamed)
    }
  })
})
