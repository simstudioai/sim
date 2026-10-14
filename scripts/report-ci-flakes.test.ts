import { describe, expect, it } from 'vitest'
import {
  type Flake,
  failedTestsInLog,
  groupFlakes,
  type IssueSnapshot,
  normalizeJobName,
  type Occurrence,
  planIssueActions,
} from './report-ci-flakes'

function occurrence(jobId: number, jobName = 'checks / test (1/2)', attempt = 1): Occurrence {
  return {
    jobId,
    jobName,
    jobUrl: `https://github.com/o/r/actions/runs/1/job/${jobId}`,
    attempt,
    /** Later jobs start later, as GitHub's job ids do. */
    at: new Date(Date.UTC(2026, 9, 1) + jobId * 60_000).toISOString(),
  }
}

function flake(key: string, occurrences: Occurrence[]): Flake {
  return { key, subject: key.slice(key.indexOf(':') + 1), title: `Flaky: ${key}`, occurrences }
}

/** The issue as GitHub would hold it after the planned create or update was applied. */
function applied(flakes: Flake[], issues: IssueSnapshot[]): IssueSnapshot[] {
  const next = issues.map((issue) => ({ ...issue }))
  for (const action of planIssueActions(flakes, issues)) {
    if (action.kind === 'create') {
      next.push({ number: 100 + next.length, state: 'open', body: action.body })
      continue
    }
    const issue = next.find((candidate) => candidate.number === action.number)
    if (!issue) throw new Error(`no issue #${action.number}`)
    issue.body = action.body
    if (action.reopen) issue.state = 'open'
  }
  return next
}

describe('failedTestsInLog', () => {
  it('reads Vitest and E2E harness failures through timestamps and ANSI colour', () => {
    const log = [
      '2026-10-13T18:56:06.9115966Z  \x1b[31m❯\x1b[39m lib/knowledge/documents/utils.test.ts (36 tests | 1 failed) 82ms',
      '2026-10-13T18:56:06.9796747Z \x1b[41m FAIL \x1b[49m lib/knowledge/documents/utils.test.ts > fetchWithRetry > waits for the reset',
      '2026-10-13T18:56:06.9796976Z AssertionError: expected 899000 to be greater than 899000',
      '2026-10-13T08:21:22.6376830Z [2026-10-13T08:21:22.637Z] [ERROR] [MobileE2E] FAIL webkit/phone/rotation keeps navigation {',
      '2026-10-13T08:21:22.6376830Z [2026-10-13T08:21:22.637Z] [ERROR] [MobileE2E] FAIL suite setup',
      '2026-10-13T18:56:06.9798418Z  Test Files  1 failed | 1675 passed (1676)',
      '2026-10-13T18:56:06.9802119Z ##[error]AssertionError: expected 899000 to be greater than 899000',
    ].join('\n')

    expect(failedTestsInLog(log)).toEqual([
      'lib/knowledge/documents/utils.test.ts > fetchWithRetry > waits for the reset',
      'MobileE2E: webkit/phone/rotation keeps navigation',
      'MobileE2E: suite setup',
    ])
  })

  it('reports a test once when Vitest prints it inline and again in the summary', () => {
    const line = ' FAIL  lib/a.test.ts > suite > case'
    expect(failedTestsInLog([line, 'diff…', line].join('\n'))).toEqual([
      'lib/a.test.ts > suite > case',
    ])
  })

  it('names nothing when the job failed outside a test', () => {
    const log = [
      '2026-10-14T15:56:22.5123743Z ##[error]Local desktop executor app did not become ready within 300 seconds.',
      '2026-10-14T15:56:24.6913187Z ##[error]Process completed with exit code 1.',
    ].join('\n')
    expect(failedTestsInLog(log)).toEqual([])
  })
})

describe('normalizeJobName', () => {
  it('folds the shards of one job together and keeps distinguishing matrix values', () => {
    expect(normalizeJobName('checks / integration (push, 4/4)')).toBe('checks / integration (push)')
    expect(normalizeJobName('checks / test (2/2)')).toBe('checks / test')
    expect(normalizeJobName('checks / e2e (mobile, webkit)')).toBe('checks / e2e (mobile, webkit)')
  })
})

describe('groupFlakes', () => {
  it('tracks each failing test across jobs, and a job only when its log named no test', () => {
    const flakes = groupFlakes([
      { occurrence: occurrence(1, 'checks / test (1/2)'), tests: ['a > one', 'a > two'] },
      { occurrence: occurrence(2, 'checks / test (2/2)'), tests: ['a > one'] },
      { occurrence: occurrence(3, 'checks / integration (push, 1/4)'), tests: [] },
      { occurrence: occurrence(4, 'checks / integration (push, 3/4)'), tests: [] },
    ])

    expect(flakes.map((entry) => [entry.key, entry.occurrences.map(({ jobId }) => jobId)])).toEqual(
      [
        ['test:a > one', [1, 2]],
        ['test:a > two', [1]],
        ['job:checks / integration (push)', [3, 4]],
      ]
    )
  })

  it('caps a long test name in the title but keeps it whole in the key', () => {
    const name = `a > ${'x'.repeat(400)}`
    const [entry] = groupFlakes([{ occurrence: occurrence(1), tests: [name] }])
    expect(entry.title.length).toBeLessThanOrEqual(200)
    expect(entry.key).toBe(`test:${name}`)
  })
})

describe('planIssueActions', () => {
  it('opens one issue per new flake', () => {
    const actions = planIssueActions([flake('test:a', [occurrence(1)])], [])
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: 'create' })
  })

  it('does nothing when a later run sees occurrences the issue already lists', () => {
    const flakes = [flake('test:a', [occurrence(1), occurrence(2)])]
    const issues = applied(flakes, [])
    expect(planIssueActions(flakes, issues)).toEqual([])
  })

  it('appends only the new occurrences and reopens a closed issue', () => {
    const issues = applied([flake('test:a', [occurrence(1)])], []).map((issue) => ({
      ...issue,
      state: 'closed' as const,
    }))

    const [action] = planIssueActions([flake('test:a', [occurrence(1), occurrence(2)])], issues)

    expect(action).toMatchObject({ kind: 'update', reopen: true, added: 1 })
    expect(action.body).toContain('/job/1)')
    expect(action.body).toContain('/job/2)')
    expect(action.body).toContain('Occurrences: 2')
  })

  it('records the occurrences an update adds, so the next run skips them', () => {
    let issues = applied([flake('test:a', [occurrence(1)])], [])
    issues = applied([flake('test:a', [occurrence(1), occurrence(2)])], issues)
    expect(planIssueActions([flake('test:a', [occurrence(1), occurrence(2)])], issues)).toEqual([])
  })

  it('leaves an open issue open', () => {
    const issues = applied([flake('test:a', [occurrence(1)])], [])
    const [action] = planIssueActions([flake('test:a', [occurrence(2)])], issues)
    expect(action).toMatchObject({ kind: 'update', reopen: false })
  })

  it('keeps counting occurrences past the ones the issue lists', () => {
    let issues: IssueSnapshot[] = []
    for (let batch = 0; batch < 5; batch++) {
      const jobs = Array.from({ length: 10 }, (_, index) => occurrence(batch * 10 + index + 1))
      issues = applied([flake('test:a', jobs)], issues)
    }

    const [issue] = issues
    expect(issue.body).toContain('Occurrences: 50')
    expect(issue.body.match(/\/job\/\d+\)/g)).toHaveLength(30)
  })

  it('does not count again an occurrence that dropped off a full list', () => {
    const jobs = Array.from({ length: 31 }, (_, index) => occurrence(index + 1))
    const issues = applied([flake('test:a', jobs)], [])

    expect(issues[0].body).toContain('Occurrences: 31')
    expect(issues[0].body).not.toContain('/job/1)')
    expect(planIssueActions([flake('test:a', [occurrence(1)])], issues)).toEqual([])
  })

  it('counts an older occurrence a full list never saw, as a wider backfill finds', () => {
    const jobs = Array.from({ length: 31 }, (_, index) => occurrence(index + 10))
    const issues = applied([flake('test:a', jobs)], [])

    const [action] = planIssueActions([flake('test:a', [occurrence(5)])], issues)

    expect(action).toMatchObject({ kind: 'update', added: 1 })
    expect(action.body).toContain('Occurrences: 32')
  })

  it('keeps counting past the job ids it keeps', () => {
    const jobs = Array.from({ length: 4_001 }, (_, index) => occurrence(index + 1))
    const issues = applied([flake('test:a', jobs)], [])

    const [action] = planIssueActions([flake('test:a', [occurrence(4_002)])], issues)

    expect(action.body).toContain('Occurrences: 4002')
  })

  it('matches an issue by its key even when the test name could end an HTML comment', () => {
    const key = 'test:a > renders --> and | pipes'
    const issues = applied([flake(key, [occurrence(1)])], [])
    expect(planIssueActions([flake(key, [occurrence(1)])], issues)).toEqual([])
    expect(planIssueActions([flake('test:a > other', [occurrence(1)])], issues)).toHaveLength(1)
  })
})
