/**
 * @vitest-environment node
 */
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLI_CONTRACT } from '../../contract/commands'
import { type ListLogsResponse, V2_OPERATIONS } from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { attachLogsFollow, type LogRow, MAX_CELL_WIDTH } from './logs-follow'

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

  it('prints only the runs that arrived since the last poll', async () => {
    const first = row('run_1', '2026-08-17T10:00:01.000Z')
    const second = row('run_2', '2026-08-17T10:00:02.000Z')
    respondWith([page([first]), page([second, first])])

    await follow('-n', '1')

    expect(printedRunIds()).toEqual(['run_1', 'run_2'])
  })

  it('prints a sibling run that shares a start time with one already printed', async () => {
    const sameInstant = '2026-08-17T10:00:01.000Z'
    const first = row('run_1', sameInstant)
    const sibling = row('run_2', sameInstant)
    respondWith([page([first]), page([sibling, first])])

    await follow('-n', '1')

    expect(printedRunIds()).toEqual(['run_1', 'run_2'])
  })

  it('prints a burst of runs oldest first, as a terminal reads', async () => {
    const first = row('run_1', '2026-08-17T10:00:01.000Z')
    const second = row('run_2', '2026-08-17T10:00:02.000Z')
    const third = row('run_3', '2026-08-17T10:00:03.000Z')
    respondWith([page([first]), page([third, second, first])])

    await follow('-n', '1')

    expect(printedRunIds()).toEqual(['run_1', 'run_2', 'run_3'])
  })

  it('does not replay history a later page reaches back into', async () => {
    const newest = row('run_2', '2026-08-17T10:00:02.000Z')
    const older = row('run_1', '2026-08-17T10:00:01.000Z')
    respondWith([page([newest]), page([newest, older])])

    await follow('-n', '1')

    expect(printedRunIds()).toEqual(['run_2'])
  })

  it('prints nothing from the backlog at -n 0 but still anchors to now', async () => {
    const existing = row('run_1', '2026-08-17T10:00:01.000Z')
    const arrived = row('run_2', '2026-08-17T10:00:02.000Z')
    respondWith([page([existing]), page([arrived, existing])])

    await follow('-n', '0')

    expect(printedRunIds()).toEqual(['run_2'])
  })

  it('retries a transient failure and keeps following', async () => {
    const first = row('run_1', '2026-08-17T10:00:01.000Z')
    const second = row('run_2', '2026-08-17T10:00:02.000Z')
    respondWith([page([first]), new SimApiError('Service Unavailable', 503), page([second, first])])

    await follow('-n', '1')

    expect(printedRunIds()).toEqual(['run_1', 'run_2'])
  })

  it('stops immediately on an authentication failure', async () => {
    const first = row('run_1', '2026-08-17T10:00:01.000Z')
    respondWith([page([first]), new SimApiError('Unauthorized', 401), page([first])])

    await expect(follow('-n', '1')).rejects.toThrow('Unauthorized')
    expect(mockRequest).toHaveBeenCalledTimes(2)
  })

  it('stops immediately on a rejected filter', async () => {
    respondWith([new SimApiError('triggers contains an empty entry', 400)])

    await expect(follow('--trigger', '', '-n', '1')).rejects.toThrow('empty entry')
    expect(mockRequest).toHaveBeenCalledTimes(1)
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

  it('prints the table header once, not once per poll', async () => {
    profile.output = 'table'
    const first = row('run_1', '2026-08-17T10:00:01.000Z')
    const second = row('run_2', '2026-08-17T10:00:02.000Z')
    respondWith([page([first]), page([second, first])])

    await follow('-n', '1')

    expect(stdout.filter((line) => line.includes('STARTED'))).toHaveLength(1)
    expect(stdout).toHaveLength(3)
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

  it('lines an arriving row up with the header it printed before any rows', async () => {
    // The floors are the half of this that keeps `-n 0` readable: without them
    // the columns lock to their header labels, and every cell of the first real
    // row overflows, so nothing below the header lines up for the life of the
    // follow.
    profile.output = 'table'
    const arrival = row('9f5e9856-1801-4028-a85f-6e335e65d974', '2026-08-17T10:00:01.000Z')
    respondWith([page([]), page([arrival])])

    await follow('-n', '0')

    const [header, printed] = stdout
    expect(printed.indexOf('completed')).toBe(header.indexOf('STATUS'))
    expect(printed.indexOf('Nightly sync')).toBe(header.indexOf('WORKFLOW'))
    expect(printed.indexOf('9f5e9856')).toBe(header.indexOf('RUN'))
  })

  it('keeps a later row wider than the batch that locked the widths', async () => {
    profile.output = 'table'
    const first = row('run_1', '2026-08-17T10:00:01.000Z')
    first.workflow = { id: 'wf_1', name: 'short', description: null, deleted: false }
    const second = row('run_2', '2026-08-17T10:00:02.000Z')
    second.workflow = {
      id: 'wf_2',
      name: 'a-considerably-longer-workflow-name',
      description: null,
      deleted: false,
    }
    respondWith([page([first]), page([second, first])])

    await follow('-n', '1')

    expect(stdout.join('\n')).toContain('a-considerably-longer-workflow-name')
  })

  it('still cuts a cell at the width one column may ever take', async () => {
    profile.output = 'table'
    const huge = 'x'.repeat(MAX_CELL_WIDTH + 40)
    const arrival = row('run_1', '2026-08-17T10:00:01.000Z')
    arrival.workflow = { id: 'wf_1', name: huge, description: null, deleted: false }
    respondWith([page([]), page([arrival])])

    await follow('-n', '0')

    const printed = stdout.join('\n')
    expect(printed).not.toContain(huge)
    expect(printed).toContain(`${'x'.repeat(MAX_CELL_WIDTH - 1)}…`)
  })

  it('asks for no column floor wider than a column may render', () => {
    // A floor above the cap is silently clamped, so an oversized spec would
    // read as deliberate and do nothing.
    const oversized = Object.entries(CLI_CONTRACT).flatMap(([operation, spec]) =>
      [...(spec.columns ?? []), ...(spec.fields ?? [])]
        .filter((column) => (column.minWidth ?? 0) > MAX_CELL_WIDTH)
        .map((column) => `${operation}.${column.header}`)
    )

    expect(oversized).toEqual([])
  })

  it('keeps rows on stdout and retry notices on stderr', async () => {
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
    const first = row('run_1', '2026-08-17T10:00:01.000Z')
    respondWith([page([first]), new SimApiError('Too Many Requests', 429), page([first])])

    await follow('-n', '1')

    expect(printedRunIds()).toEqual(['run_1'])
    expect(stderr.join('')).toContain('retrying in')
    expect(stdout.join('')).not.toContain('retrying in')
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

  it('says so when the requested backlog is larger than a page holds', async () => {
    // The API clamps limit into 1–1000 instead of rejecting, so -n above that
    // comes back short and the follow anchors its floor to the partial page.
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
    const rows = Array.from({ length: 3 }, (_, index) =>
      row(`run_${index}`, `2026-08-17T10:00:0${index}.000Z`)
    )
    respondWith([page(rows, 'more'), page(rows, 'more')])

    await follow('-n', '50')

    expect(stderr.join('')).toContain('asked for 50 earlier runs')
    expect(stdout.join('')).not.toContain('asked for 50')
  })

  it('stays quiet when the workspace simply holds fewer runs than asked for', async () => {
    // Short because there is no more to give is not a shortfall, and warning
    // there would fire on every small workspace.
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
    const rows = [row('run_0', '2026-08-17T10:00:00.000Z')]
    respondWith([page(rows, null), page(rows, null)])

    await follow('-n', '50')

    expect(stderr.join('')).not.toContain('asked for 50')
  })

  it('does not warn when the last budgeted page proves the follow caught up', async () => {
    // A page holding a run already printed is the watermark: everything below it
    // is older, so stopping there is the correct terminus, not a truncation.
    // Warning here would report a hole on the ordinary steady-state path, and
    // the run sharing that page is still collected because the filter takes
    // every unprinted row on it, not only those above the known one.
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
    const seen = row('seed', '2026-08-17T10:00:00.000Z')
    const budgeted = Array.from({ length: 9 }, (_, index) =>
      page([row(`burst_${index}`, `2026-08-17T10:01:0${index}.000Z`)], `cursor_${index}`)
    )
    const mixed = page([row('straggler', '2026-08-17T10:00:30.000Z'), seen], null)
    respondWith([page([seen]), ...budgeted, mixed])

    await follow('-n', '1')

    expect(stderr.join('')).not.toContain('older ones were skipped')
    expect(printedRunIds()).toContain('straggler')
  })

  it('clears a retry notice on the first healthy poll, even an empty one', async () => {
    // The clear used to sit after the empty check, so a poll that recovered but
    // found nothing left "retrying in Ns…" up while the follow was already
    // healthy. Asserted between two failures because the teardown clears the
    // line either way: what separates the two is whether a bare erase lands
    // BEFORE the second notice, or only at the end.
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
    const first = row('run_1', '2026-08-17T10:00:01.000Z')
    respondWith([
      page([first]),
      new SimApiError('Service Unavailable', 503),
      page([first]),
      new SimApiError('Service Unavailable', 503),
      page([first]),
    ])

    await follow('-n', '1')

    const bareErase = stderr.indexOf(`\r${String.fromCharCode(27)}[K`)
    const notices = stderr
      .map((line, index) => (line.includes('retrying in') ? index : -1))
      .filter((index) => index >= 0)
    expect(notices).toHaveLength(2)
    expect(bareErase).toBeGreaterThan(notices[0])
    expect(bareErase).toBeLessThan(notices[1])
  })

  it('stays silent on stderr when it is not a terminal', async () => {
    Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true })
    const first = row('run_1', '2026-08-17T10:00:01.000Z')
    respondWith([page([first]), new SimApiError('Too Many Requests', 429), page([first])])

    await follow('-n', '1')

    expect(stderr).toEqual([])
  })

  it('exits cleanly on Ctrl-C and leaves no signal listeners behind', async () => {
    const before = process.listenerCount('SIGINT')
    respondWith([page([row('run_1', '2026-08-17T10:00:01.000Z')])])

    await expect(follow('-n', '1')).resolves.toBeDefined()

    expect(process.listenerCount('SIGINT')).toBe(before)
  })

  it('rejects an interval that would hammer the API', async () => {
    respondWith([])

    await expect(follow('--interval', '0.001')).rejects.toThrow('--interval must be at least')
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('rejects a backlog count that is not a whole number of runs', async () => {
    respondWith([])

    await expect(follow('-n', '-1')).rejects.toThrow('--lines must be a non-negative integer')
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('asks for the detail level that names each run’s workflow, and the newest page first', async () => {
    respondWith([page([row('run_1', '2026-08-17T10:00:01.000Z')])])

    await follow('-n', '1', '--workflow', 'wf_1', '--workflow', 'wf_2', '--folder', '/Q1 2026')

    expect(mockRequest).toHaveBeenCalledWith('/api/v2/logs', {
      query: expect.objectContaining({
        workspaceId: 'ws_1',
        details: 'full',
        sortBy: 'startedAt',
        sortOrder: 'desc',
        workflowIds: 'wf_1,wf_2',
        folderPaths: '/Q1%202026',
        limit: 1,
      }),
    })
  })

  it('sends only query parameters the listLogs operation declares', async () => {
    respondWith([page([row('run_1', '2026-08-17T10:00:01.000Z')])])

    await follow('-n', '1', '--workflow', 'wf_1', '--folder', '/Q1 2026', '--trigger', 'api')

    const declared = new Set(Object.keys(V2_OPERATIONS.listLogs.query))
    expect(mockRequest).toHaveBeenCalled()
    for (const [, init] of mockRequest.mock.calls as unknown as Array<
      [string, { query: Record<string, unknown> }]
    >) {
      const sent = Object.entries(init.query)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key]) => key)
      expect(sent.filter((key) => !declared.has(key))).toEqual([])
    }
  })

  it('sends sort values the listLogs operation accepts', async () => {
    respondWith([page([row('run_1', '2026-08-17T10:00:01.000Z')])])

    await follow('-n', '1')

    const [, init] = mockRequest.mock.calls[0] as unknown as [
      string,
      { query: Record<string, unknown> },
    ]
    expect(V2_OPERATIONS.listLogs.query.sortBy.values).toContain(init.query.sortBy)
    expect(V2_OPERATIONS.listLogs.query.sortOrder.values).toContain(init.query.sortOrder)
  })

  it('waits between polls instead of spinning', async () => {
    const first = row('run_1', '2026-08-17T10:00:01.000Z')
    respondWith([page([first]), page([first])])

    await follow('-n', '1')

    expect(mockSleep).toHaveBeenCalled()
    for (const [ms] of mockSleep.mock.calls as unknown as Array<[number]>) {
      expect(ms).toBeGreaterThan(0)
    }
  })
})
