import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListLogsResponse } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { attachLogsFollow, type LogRow } from './logs-follow'

const { mockRequest, mockSleep, profile } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockSleep: vi.fn(() => Promise.resolve()),
  profile: { output: 'json' as string },
}))

vi.mock('../../helpers', () => ({ sleep: mockSleep }))

vi.mock('../../context', () => ({
  clientFrom: () => ({
    client: { request: mockRequest, requireWorkspace: () => 'ws_1' },
    profile: {
      name: 'default',
      endpoint: 'https://sim.example',
      apiKey: 'k',
      workspaceId: 'ws_1',
      output: profile.output,
    },
  }),
}))

/** Stops a runaway follow before it can hang the suite. */
const MAX_POLLS = 50

const originalStderrIsTTY = process.stderr.isTTY

let stdout: string[]
let stderr: string[]

function row(runId: string, startedAt: string): LogRow {
  return {
    kind: 'workflow',
    runId,
    workflowId: 'wf_1',
    deploymentVersionId: null,
    status: 'completed',
    level: 'info',
    trigger: 'api',
    startedAt,
    endedAt: startedAt,
    totalDurationMs: 12,
    cost: { total: 0.5 },
    files: null,
    hasHandledErrors: false,
    workflow: { id: 'wf_1', name: 'Nightly sync', description: null, deleted: false },
  }
}

function page(rows: LogRow[], nextCursor: string | null = null): ListLogsResponse {
  return { data: rows, nextCursor }
}

/**
 * Answers each poll from `responses`, then ends the follow the way a user does.
 *
 * Ctrl-C is the only clean exit a follow has, so the tests stop it the same way
 * rather than by unwinding the loop with an error.
 */
function respondWith(responses: Array<ListLogsResponse | Error>): void {
  let polls = 0
  mockRequest.mockImplementation(async () => {
    polls += 1
    if (polls > MAX_POLLS) throw new Error('follow did not stop')
    const next = responses.shift()
    if (next === undefined) {
      process.emit('SIGINT')
      return page([])
    }
    if (next instanceof Error) throw next
    return next
  })
}

function follow(...argv: string[]): Promise<unknown> {
  const root = new Command('sim').exitOverride()
  const logs = new Command('logs').exitOverride()
  root.addCommand(logs)
  attachLogsFollow(logs)
  for (const command of logs.commands) command.exitOverride()
  return root.parseAsync(['node', 'sim', 'logs', 'follow', ...argv])
}

/** The run ids printed to stdout, in the order they were printed. */
function printedRunIds(): string[] {
  return stdout.map((line) => JSON.parse(line).runId as string)
}

beforeEach(() => {
  stdout = []
  stderr = []
  profile.output = 'json'
  mockRequest.mockReset()
  mockSleep.mockClear()
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    stdout.push(String(line))
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk))
    return true
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(process.stderr, 'isTTY', {
    value: originalStderrIsTTY,
    configurable: true,
  })
})

describe('sim logs follow', () => {
  it('prints the backlog oldest first and never reprints it', async () => {
    const rows = [
      row('run_3', '2026-08-17T10:00:03.000Z'),
      row('run_2', '2026-08-17T10:00:02.000Z'),
      row('run_1', '2026-08-17T10:00:01.000Z'),
    ]
    respondWith([page(rows), page(rows), page(rows)])

    await follow('-n', '3')

    expect(printedRunIds()).toEqual(['run_1', 'run_2', 'run_3'])
  })

  it('prints a sibling run that shares a start time with one already printed', async () => {
    const sameInstant = '2026-08-17T10:00:01.000Z'
    const first = row('run_1', sameInstant)
    const sibling = row('run_2', sameInstant)
    respondWith([page([first]), page([sibling, first])])

    await follow('-n', '1')

    expect(printedRunIds()).toEqual(['run_1', 'run_2'])
  })

  it('does not replay history a later page reaches back into', async () => {
    const newest = row('run_2', '2026-08-17T10:00:02.000Z')
    const older = row('run_1', '2026-08-17T10:00:01.000Z')
    respondWith([page([newest]), page([newest, older])])

    await follow('-n', '1')

    expect(printedRunIds()).toEqual(['run_2'])
  })

  it('stops immediately on an authentication failure', async () => {
    const first = row('run_1', '2026-08-17T10:00:01.000Z')
    respondWith([page([first]), new SimApiError('Unauthorized', 401), page([first])])

    await expect(follow('-n', '1')).rejects.toThrow('Unauthorized')
    expect(mockRequest).toHaveBeenCalledTimes(2)
  })

  it('emits one JSON object per line rather than an array', async () => {
    const rows = [
      row('run_2', '2026-08-17T10:00:02.000Z'),
      row('run_1', '2026-08-17T10:00:01.000Z'),
    ]
    respondWith([page(rows)])

    await follow('-n', '2')

    expect(stdout).toHaveLength(2)
    for (const line of stdout) {
      expect(line.startsWith('{')).toBe(true)
      expect(line).not.toContain('\n')
      expect(JSON.parse(line)).toMatchObject({ workflow: { name: 'Nightly sync' } })
    }
  })

  it('keeps a run id whole when the follow started with an empty backlog', async () => {
    // `-n 0` seeds the writer with no rows, so the widths used to lock to the
    // header labels — RUN is three characters, and a 36-character run id
    // printed as `9f…`, uncopyable.
    profile.output = 'table'
    const runId = '9f5e9856-1801-4028-a85f-6e335e65d974'
    const arrival = row(runId, '2026-08-17T10:00:01.000Z')
    arrival.workflow = {
      id: 'wf_1',
      name: 'clitest-nightly-sync',
      description: null,
      deleted: false,
    }
    respondWith([page([]), page([arrival])])

    await follow('-n', '0')

    const printed = stdout.join('\n')
    expect(printed).toContain(runId)
    expect(printed).toContain('clitest-nightly-sync')
    expect(printed).not.toContain('…')
  })

  it('says so when a burst is larger than one poll may read', async () => {
    // The page budget bounds one poll so an enormous burst cannot stall the
    // follow, but the remainder is older than everything collected and the next
    // poll restarts at the newest page — so those runs are never coming, and a
    // hole the reader cannot see is worse than a slow poll.
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
    const seed = row('seed', '2026-08-17T10:00:00.000Z')
    const budgeted = Array.from({ length: 10 }, (_, index) =>
      page([row(`burst_${index}`, `2026-08-17T10:01:0${index}.000Z`)], `cursor_${index}`)
    )
    respondWith([page([seed]), ...budgeted])

    await follow('-n', '1')

    expect(stderr.join('')).toContain('older ones were skipped')
    expect(stdout.join('')).not.toContain('older ones were skipped')
  })

  it('exits cleanly on Ctrl-C and leaves no signal listeners behind', async () => {
    const before = process.listenerCount('SIGINT')
    respondWith([page([row('run_1', '2026-08-17T10:00:01.000Z')])])

    await expect(follow('-n', '1')).resolves.toBeDefined()

    expect(process.listenerCount('SIGINT')).toBe(before)
  })
})
