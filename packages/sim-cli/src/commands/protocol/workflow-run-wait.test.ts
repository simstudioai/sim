import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachWorkflowRunWait } from './workflow-run-wait'

const { mockRequest, sleeps, clock, output } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  sleeps: [] as number[],
  clock: { now: 0 },
  output: { format: 'text' },
}))

vi.mock('../../context', () => ({
  clientFrom: () => ({
    client: { request: mockRequest, requireWorkspace: () => 'ws_local' },
    profile: {
      workspaceId: 'ws_local',
      output: output.format,
      name: 'default',
      apiKey: 'k',
      endpoint: 'https://sim.example',
    },
  }),
}))

/**
 * Waiting is simulated rather than timed: the mock advances the same clock the
 * command reads its deadline from, so a `--wait-timeout 3600` test costs
 * nothing and the poll schedule is exactly what the assertions say it is.
 */
vi.mock('../../helpers', () => ({
  sleep: (ms: number) => {
    sleeps.push(ms)
    clock.now += ms
    return Promise.resolve()
  },
}))

let logged: string[]
let errored: string[]
let progress: string[]

const stderr = process.stderr as unknown as { isTTY: boolean }
const realIsTTY = stderr.isTTY

beforeEach(() => {
  mockRequest.mockReset()
  sleeps.length = 0
  clock.now = 1_000_000
  output.format = 'text'
  logged = []
  errored = []
  progress = []
  process.exitCode = undefined
  stderr.isTTY = false

  vi.spyOn(Date, 'now').mockImplementation(() => clock.now)
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line)
  })
  vi.spyOn(console, 'error').mockImplementation((line: string) => {
    errored.push(line)
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    progress.push(String(chunk))
    return true
  })
})

afterEach(() => {
  stderr.isTTY = realIsTTY
  process.exitCode = undefined
})

interface RunPayload {
  status: string
  paused?: {
    contextId?: string | null
    pauseKind?: string | null
    resumeAt?: string | null
  } | null
}

function run(payload: RunPayload) {
  return {
    data: {
      runId: 'run_1',
      workflowId: '00000000-0000-4000-8000-00000000000a',
      startedAt: '2026-08-17T00:00:00.000Z',
      endedAt: null,
      durationMs: null,
      cost: null,
      error: payload.status === 'failed' ? { message: 'Block agent_1 exploded' } : null,
      paused: null,
      ...payload,
    },
  }
}

/** Answers each poll in order, repeating the last payload once the script runs out. */
function respondWith(...payloads: RunPayload[]) {
  let index = 0
  mockRequest.mockImplementation(() => {
    const payload = payloads[Math.min(index, payloads.length - 1)]
    index += 1
    return Promise.resolve(run(payload))
  })
}

async function wait(argv: string[] = []): Promise<void> {
  const root = new Command('sim').exitOverride()
  const workflows = new Command('workflows').exitOverride()
  const runs = new Command('runs').exitOverride()
  workflows.addCommand(runs)
  root.addCommand(workflows)
  attachWorkflowRunWait(runs)
  runs.commands.forEach((command) => command.exitOverride())

  await root.parseAsync([
    'node',
    'sim',
    'workflows',
    'runs',
    'wait',
    'run_1',
    '--workflow',
    '00000000-0000-4000-8000-00000000000a',
    ...argv,
  ])
}

describe('workflows runs wait', () => {
  it('exits non-zero when the run failed', async () => {
    respondWith({ status: 'running' }, { status: 'failed' })

    await wait()

    expect(process.exitCode).toBe(1)
    expect(errored.join('\n')).toContain('Run run_1 failed')
    expect(logged.join('\n')).toContain('Block agent_1 exploded')
  })

  it('distinguishes a cancelled run from a failed one', async () => {
    respondWith({ status: 'cancelled' })

    await wait()

    expect(process.exitCode).toBe(2)
    expect(errored.join('\n')).toContain('cancelled')
  })

  it('stops on a pause that is waiting for a human, and says how to resume it', async () => {
    respondWith({ status: 'paused', paused: { pauseKind: 'human', contextId: 'ctx_9' } })

    await wait()

    expect(mockRequest).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(3)
    expect(errored.join('\n')).toContain(
      'sim workflows runs resume run_1 --workflow 00000000-0000-4000-8000-00000000000a --context ctx_9'
    )
  })

  it('stops on a pause whose kind the server did not name', async () => {
    respondWith({ status: 'paused', paused: { pauseKind: null } })

    await wait()

    expect(process.exitCode).toBe(3)
  })

  it('gives up when the wait bound elapses, without overshooting it', async () => {
    respondWith({ status: 'running' })

    await wait(['--wait-timeout', '3'])

    expect(sleeps).toEqual([2000, 1000])
    expect(process.exitCode).toBe(4)
    expect(errored.join('\n')).toContain('Timed out after 3s')
    expect(errored.join('\n')).toContain('status: running')
    expect(logged.join('\n')).toContain('running')
  })
})
