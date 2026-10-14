#!/usr/bin/env bun
/**
 * Files one GitHub issue per flaky CI check, so a flake is tracked instead of re-run until green.
 *
 * A flake here is a job that failed on an earlier attempt of a `ci` workflow run whose final
 * attempt succeeded: the same commit passed without a code change. Within that job, each failing
 * Vitest test (`FAIL  <file> > <name>`) and each failing E2E check (`[<Suite>] FAIL <name>`, the
 * line the `apps/sim/scripts/test-*-e2e.ts` harnesses log) gets its own issue; a job whose log
 * names no failing test is tracked as the job itself. A flake an author clears by pushing again,
 * rather than re-running, leaves no trace in the API and is not counted.
 *
 * Every issue carries the `ci-flake` label, a hidden key, and the hidden list of job ids it has
 * counted, so a run is idempotent: an occurrence already counted is skipped, a write that failed
 * partway is completed by the next run, and a closed issue is reopened when its flake recurs —
 * closing one is a claim that the flake is fixed.
 *
 * Runs are selected by creation date, so a run re-run after it leaves the lookback window is
 * missed. Re-runs start within hours of the run (every one in a two-week sample within four), and
 * the daily schedule's three-day window leaves two days of slack.
 *
 * Usage: bun scripts/report-ci-flakes.ts [--days <n>] [--dry-run]
 * Needs GITHUB_TOKEN with `actions: read` and `issues: write`, and GITHUB_REPOSITORY (owner/name).
 */

import { compareStrings, truncateAtCodePoint } from '../packages/utils/src/string'

const FLAKE_LABEL = 'ci-flake'
/** The aggregate gate fails whenever any job does, so it never names a flake of its own. */
const GATE_JOB_NAME = 'checks / ci'
const CI_WORKFLOW_FILE = 'ci.yml'
const MAX_LISTED_OCCURRENCES = 30
const MAX_TITLE_LENGTH = 200
/** The key is URI-encoded so a test name can never close the HTML comment that carries it. */
const KEY_MARKER = /<!-- ci-flake-key: (\S+) -->/
const COUNTED_MARKER = /<!-- ci-flake-jobs: ([\d,]*) -->/
const TOTAL_LINE = /^Occurrences: (\d+)$/m
/**
 * The cap keeps the body under GitHub's size limit. Job ids only grow, so once the list is full its
 * lowest id is a watermark: a job below it is treated as counted, which keeps a wider backfill from
 * counting a dropped id again at the cost of never counting an older job first seen that late.
 */
const MAX_COUNTED_JOB_IDS = 4_000
const OCCURRENCE_ROW = /^\| (\S+) \| (.+) \| \[attempt (\d+)\]\((\S+\/job\/(\d+))\) \|$/gm

export interface Occurrence {
  jobId: number
  jobName: string
  jobUrl: string
  attempt: number
  /** ISO timestamp the failed attempt's job started. */
  at: string
}

export interface Flake {
  key: string
  /** The failing test, or the job when its log named none. */
  subject: string
  title: string
  occurrences: Occurrence[]
}

export interface IssueSnapshot {
  number: number
  state: 'open' | 'closed'
  body: string
}

export type IssueAction =
  | { kind: 'create'; flake: Flake; body: string }
  | { kind: 'update'; number: number; reopen: boolean; added: number; body: string }

const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g
const LOG_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z /
const VITEST_FAIL = /^ FAIL {2}(\S.*?)\s*$/
const HARNESS_FAIL = /^\[[^\]]+\] \[ERROR\] \[([^\]]+)\] FAIL (.+?)(?: \{)?\s*$/

/** Names every failing test or E2E check a job log reports, in first-seen order. */
export function failedTestsInLog(log: string): string[] {
  const names = new Set<string>()
  for (const rawLine of log.split('\n')) {
    if (!rawLine.includes('FAIL')) continue
    const line = rawLine.replace(ANSI_ESCAPE, '').replace(LOG_TIMESTAMP, '')
    const vitest = VITEST_FAIL.exec(line)
    if (vitest) {
      names.add(vitest[1])
      continue
    }
    const harness = HARNESS_FAIL.exec(line)
    if (harness) names.add(`${harness[1]}: ${harness[2]}`)
  }
  return [...names]
}

/** Drops the shard suffix so `integration (push, 4/4)` and `(push, 1/4)` share one flake. */
export function normalizeJobName(name: string): string {
  return name.replace(/,\s*\d+\/\d+\)$/, ')').replace(/\s*\(\d+\/\d+\)$/, '')
}

/** Groups occurrences by the test they name, or by the job when its log names no test. */
export function groupFlakes(failures: Array<{ occurrence: Occurrence; tests: string[] }>): Flake[] {
  const flakes = new Map<string, Flake>()
  for (const { occurrence, tests } of failures) {
    const job = normalizeJobName(occurrence.jobName)
    const subjects =
      tests.length > 0
        ? tests.map((test) => ({ key: `test:${test}`, subject: test, kind: 'test' }))
        : [{ key: `job:${job}`, subject: job, kind: 'job' }]
    for (const { key, subject, kind } of subjects) {
      const flake = flakes.get(key) ?? {
        key,
        subject,
        title: truncateAtCodePoint(`Flaky ${kind}: ${subject}`, MAX_TITLE_LENGTH - 1, '…'),
        occurrences: [],
      }
      flake.occurrences.push(occurrence)
      flakes.set(key, flake)
    }
  }
  return [...flakes.values()]
}

function keyOfIssueBody(body: string): string | undefined {
  const match = KEY_MARKER.exec(body)
  return match ? decodeURIComponent(match[1]) : undefined
}

function countedJobIds(body: string): number[] {
  const ids = COUNTED_MARKER.exec(body)?.[1]
  return ids ? ids.split(',').map(Number) : []
}

function parseOccurrences(body: string): Occurrence[] {
  return [...body.matchAll(OCCURRENCE_ROW)].map((match) => ({
    at: match[1],
    jobName: match[2],
    attempt: Number(match[3]),
    jobUrl: match[4],
    jobId: Number(match[5]),
  }))
}

/**
 * Renders an issue body: the newest occurrences as a table, `total` counting every occurrence ever
 * recorded, and `counted` the job ids counted so far, listed or not. The total is kept apart from
 * the ids because the ids are capped.
 */
function renderIssueBody(
  flake: Flake,
  occurrences: Occurrence[],
  total: number,
  counted: number[]
): string {
  const listed = [...occurrences]
    .sort((left, right) => compareStrings(right.at, left.at))
    .slice(0, MAX_LISTED_OCCURRENCES)
  const kept = [...new Set(counted)]
    .sort((left, right) => right - left)
    .slice(0, MAX_COUNTED_JOB_IDS)
  return [
    `<!-- ci-flake-key: ${encodeURIComponent(flake.key)} -->`,
    `<!-- ci-flake-jobs: ${kept.join(',')} -->`,
    `\`${flake.subject.replaceAll('`', "'")}\` failed on a CI attempt and passed when the same commit was re-run.`,
    '',
    'Fix the nondeterminism (clock, ordering, shared state, an unawaited condition) rather than adding a retry or a longer timeout. Close this issue once it is fixed; `scripts/report-ci-flakes.ts` reopens it if the flake recurs.',
    '',
    `Occurrences: ${total}`,
    '',
    '| Failed at | Job | Run |',
    '| --- | --- | --- |',
    ...listed.map(
      (occurrence) =>
        `| ${occurrence.at} | ${occurrence.jobName.replaceAll('|', '/')} | [attempt ${occurrence.attempt}](${occurrence.jobUrl}) |`
    ),
  ].join('\n')
}

/**
 * Decides what to do with each flake given the tracker's existing issues: create one, or append
 * the occurrences an issue has not counted yet (reopening it if closed). A flake whose occurrences
 * are all counted already needs nothing, which is what makes overlapping lookback windows safe.
 */
export function planIssueActions(flakes: Flake[], issues: IssueSnapshot[]): IssueAction[] {
  const byKey = new Map<string, IssueSnapshot>()
  for (const issue of issues) {
    const key = keyOfIssueBody(issue.body)
    if (key !== undefined && !byKey.has(key)) byKey.set(key, issue)
  }

  const actions: IssueAction[] = []
  for (const flake of flakes) {
    const issue = byKey.get(flake.key)
    if (!issue) {
      actions.push({
        kind: 'create',
        flake,
        body: renderIssueBody(
          flake,
          flake.occurrences,
          flake.occurrences.length,
          flake.occurrences.map((occurrence) => occurrence.jobId)
        ),
      })
      continue
    }
    const counted = countedJobIds(issue.body)
    const countedIds = new Set(counted)
    const watermark =
      counted.length >= MAX_COUNTED_JOB_IDS
        ? counted.reduce((lowest, id) => Math.min(lowest, id))
        : Number.NEGATIVE_INFINITY
    const added = flake.occurrences.filter(
      (occurrence) => !countedIds.has(occurrence.jobId) && occurrence.jobId > watermark
    )
    if (added.length === 0) continue
    const listed = parseOccurrences(issue.body)
    const previousTotal = Number(TOTAL_LINE.exec(issue.body)?.[1] ?? counted.length)
    actions.push({
      kind: 'update',
      number: issue.number,
      reopen: issue.state === 'closed',
      added: added.length,
      body: renderIssueBody(flake, [...listed, ...added], previousTotal + added.length, [
        ...counted,
        ...added.map((occurrence) => occurrence.jobId),
      ]),
    })
  }
  return actions
}

interface WorkflowRun {
  id: number
  run_attempt: number
}

interface Job {
  id: number
  run_attempt: number
  name: string
  conclusion: string | null
  started_at: string
  html_url: string
}

class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly repository: string
  ) {}

  private send(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`https://api.github.com/repos/${this.repository}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    })
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.send(path, init)
    if (!response.ok) {
      throw new Error(`GitHub ${init.method ?? 'GET'} ${path} returned ${response.status}`)
    }
    return response
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await (await this.request(path, init)).json()) as T
  }

  /** Pages through a list endpoint; `pick` reads the array out of an enveloped response. */
  private async list<T>(path: string, pick: (page: unknown) => T[]): Promise<T[]> {
    const items: T[] = []
    for (let page = 1; ; page++) {
      const separator = path.includes('?') ? '&' : '?'
      const batch = pick(await this.json(`${path}${separator}per_page=100&page=${page}`))
      items.push(...batch)
      if (batch.length < 100) return items
    }
  }

  successfulRunsSince(since: string): Promise<WorkflowRun[]> {
    return this.list(
      `/actions/workflows/${CI_WORKFLOW_FILE}/runs?status=success&created=>=${since}`,
      (page) => (page as { workflow_runs: WorkflowRun[] }).workflow_runs
    )
  }

  /** Every attempt's jobs, in one list. */
  runJobs(runId: number): Promise<Job[]> {
    return this.list(
      `/actions/runs/${runId}/jobs?filter=all`,
      (page) => (page as { jobs: Job[] }).jobs
    )
  }

  /**
   * The logs endpoint redirects to a signed blob URL. The redirect is followed by hand so the
   * API token is never sent to the blob host.
   */
  async jobLog(jobId: number): Promise<string> {
    const path = `/actions/jobs/${jobId}/logs`
    const redirect = await this.send(path, { redirect: 'manual' })
    const location = redirect.headers.get('location')
    if (redirect.status !== 302 || !location) {
      throw new Error(`GitHub GET ${path} returned ${redirect.status}, not a log redirect`)
    }
    const log = await fetch(location)
    if (!log.ok) throw new Error(`Job ${jobId} log download returned ${log.status}`)
    return log.text()
  }

  trackedIssues(): Promise<IssueSnapshot[]> {
    return this.list(`/issues?labels=${FLAKE_LABEL}&state=all`, (page) =>
      (page as Array<{ number: number; state: 'open' | 'closed'; body: string | null }>).map(
        (issue) => ({ number: issue.number, state: issue.state, body: issue.body ?? '' })
      )
    )
  }

  async ensureLabel(): Promise<void> {
    const existing = await this.send(`/labels/${FLAKE_LABEL}`)
    if (existing.ok) return
    if (existing.status !== 404) throw new Error(`GitHub label lookup returned ${existing.status}`)
    await this.request('/labels', {
      method: 'POST',
      body: JSON.stringify({
        name: FLAKE_LABEL,
        color: 'd93f0b',
        description: 'A CI check that failed and then passed on the same commit',
      }),
    })
  }

  async apply(action: IssueAction): Promise<void> {
    if (action.kind === 'create') {
      await this.request('/issues', {
        method: 'POST',
        body: JSON.stringify({
          title: action.flake.title,
          body: action.body,
          labels: [FLAKE_LABEL],
        }),
      })
      return
    }
    await this.request(`/issues/${action.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: action.body, ...(action.reopen ? { state: 'open' } : {}) }),
    })
  }
}

const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out'])

/** Collects the failed earlier-attempt jobs of every run that finally succeeded. */
async function collectFlakes(client: GitHubClient, since: string): Promise<Flake[]> {
  const failures: Array<{ occurrence: Occurrence; tests: string[] }> = []
  for (const run of await client.successfulRunsSince(since)) {
    if (run.run_attempt < 2) continue
    for (const job of await client.runJobs(run.id)) {
      if (
        job.run_attempt >= run.run_attempt ||
        job.name === GATE_JOB_NAME ||
        !FAILED_CONCLUSIONS.has(job.conclusion ?? '')
      ) {
        continue
      }
      failures.push({
        occurrence: {
          jobId: job.id,
          jobName: job.name,
          jobUrl: job.html_url,
          attempt: job.run_attempt,
          at: job.started_at,
        },
        tests: failedTestsInLog(await client.jobLog(job.id)),
      })
    }
  }
  return groupFlakes(failures)
}

function parseArgs(argv: string[]): { days: number; dryRun: boolean } {
  const daysIndex = argv.indexOf('--days')
  const days = daysIndex === -1 ? 3 : Number(argv[daysIndex + 1])
  if (!Number.isInteger(days) || days < 1) throw new Error('--days must be a positive integer')
  return { days, dryRun: argv.includes('--dry-run') }
}

async function main(): Promise<void> {
  const { days, dryRun } = parseArgs(process.argv.slice(2))
  const token = process.env.GITHUB_TOKEN
  const repository = process.env.GITHUB_REPOSITORY
  if (!token || !repository) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required')

  const client = new GitHubClient(token, repository)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const flakes = await collectFlakes(client, since)
  const actions = planIssueActions(flakes, await client.trackedIssues())

  for (const action of actions) {
    const summary =
      action.kind === 'create'
        ? `create "${action.flake.title}" (${action.flake.occurrences.length} occurrences)`
        : `update #${action.number} (+${action.added}${action.reopen ? ', reopen' : ''})`
    console.log(dryRun ? `[dry run] ${summary}` : summary)
  }
  if (dryRun || actions.length === 0) return
  await client.ensureLabel()
  for (const action of actions) await client.apply(action)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
