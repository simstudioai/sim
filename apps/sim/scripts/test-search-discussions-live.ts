import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { z } from 'zod'
import {
  type WorkspaceSearchFilters,
  workspaceSearchFiltersSchema,
} from '@/lib/api/contracts/knowledge'
import { exceedsGitHubTextLimit, readGitHub, searchGitHub } from '@/lib/sim-search/live/github'
import { array, object, string } from '@/lib/sim-search/live/http'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import type { NativeClient, NativePage } from '@/lib/sim-search/live/types'

/**
 * Read-only acceptance against GitHub's real API with the current gh login; no token is printed.
 * Run from apps/sim with gh authenticated:
 * SEARCH_DISCUSSIONS_REPORT_PATH=/tmp/report.json \
 * SEARCH_DISCUSSIONS_GITHUB_REPOSITORY=example/project SEARCH_DISCUSSIONS_GITHUB_PR=123 \
 * SEARCH_DISCUSSIONS_CASES_PATH=/tmp/cases.json bun scripts/test-search-discussions-live.ts
 * Choose a public PR with conversation, review, and inline comments. Cases are a JSON array of
 * 1–12 objects, for example [{"name":"Title discovery","question":"Which PR fixes search?",
 * "query":"repo:example/project is:pr search in:title",
 * "oracleQueries":["repo:example/project is:pr search in:title"],"expectedId":"123"}].
 * Optional fields: filters (startDate, endDate, sortBy), commentFragment, reviewer, approved.
 * reviewer requires a submitted review by that login. approved independently checks whether a
 * submitted APPROVED review event exists, not current approval status or mergeability. Review
 * fixtures must have fewer than 100 records; a full oracle page is rejected as incomplete.
 * commentFragment must occur in the same comment identified by a search match. Conversation
 * and inline-comment fixtures each need fewer than 100 comments for complete oracle coverage.
 * Oracle queries describe equivalent logical branches. Explicit updated: qualifiers take
 * precedence over filters; otherwise both paths use inclusive GitHub candidate bounds.
 * Untyped oracle searches use separate ten-item issue and pull-request pages.
 * The application search layer applies the exclusive end-date filter and is not exercised here.
 * Keep real identities and source content in the external case file. Timings include gh process
 * and network costs, not model selection or the authorized application/UI boundary.
 */
const logger = createLogger('SearchDiscussionsLive')
const exec = promisify(execFile)
const reportPath = process.env.SEARCH_DISCUSSIONS_REPORT_PATH
const repository = process.env.SEARCH_DISCUSSIONS_GITHUB_REPOSITORY
const number = process.env.SEARCH_DISCUSSIONS_GITHUB_PR
const casesPath = process.env.SEARCH_DISCUSSIONS_CASES_PATH
if (!reportPath || !repository || !number || !casesPath)
  throw new Error(
    'Set SEARCH_DISCUSSIONS_REPORT_PATH, SEARCH_DISCUSSIONS_GITHUB_REPOSITORY, SEARCH_DISCUSSIONS_GITHUB_PR and SEARCH_DISCUSSIONS_CASES_PATH'
  )
if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^\d+$/.test(number))
  throw new Error('Invalid GitHub repository or PR number')

interface RequestLog {
  path: string
  lane: 'adapter' | 'oracle'
  status: 'passed' | 'failed'
  durationMs: number
}
const queryCaseSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    question: z.string().trim().min(1).max(2000),
    query: z.string().trim().min(1).max(2000),
    oracleQueries: z.array(z.string().trim().min(1).max(2000)).min(1).max(4),
    filters: workspaceSearchFiltersSchema
      .pick({ startDate: true, endDate: true, sortBy: true })
      .strict()
      .optional(),
    expectedId: z
      .string()
      .regex(/^[1-9]\d{0,9}$/)
      .optional(),
    commentFragment: z.string().trim().min(1).max(2000).optional(),
    reviewer: z
      .string()
      .regex(/^[a-z\d](?:[a-z\d-]{0,38})$/i)
      .optional(),
    approved: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !value.commentFragment || Boolean(value.expectedId), {
    message: 'commentFragment requires expectedId',
  })
const queryCasesSchema = z.array(queryCaseSchema).min(1).max(12)
type QueryCase = z.output<typeof queryCaseSchema>
interface QueryReport {
  name: string
  question: string
  native: { provider: 'github'; kind: 'issues'; query: string }
  filters?: WorkspaceSearchFilters
  actualProviderQueries: string[]
  results: {
    id: string
    title: string
    url: string
    snippet: string
    container?: string
    kind?: string
  }[]
  oracleResultIds: string[]
  oracleTotal: number
  evidence: { type: string; url?: string; snippet: string }[]
  samplesMs: number[]
  status: 'passed' | 'failed'
  error?: string
}

const requests: RequestLog[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const queries: QueryReport[] = []
const readSamplesMs: number[] = []

function assertRepositoryScope(query: string) {
  const tokens = query.match(/"[^"]*"|\S+/g) ?? []
  const scopes = tokens.filter((token) => /^-?repo:/i.test(token))
  assert.ok(
    scopes.length === 1 &&
      scopes[0]?.toLowerCase() === `repo:${repository}`.toLowerCase() &&
      !tokens.some((token) => /^(?:OR|NOT)$/i.test(token)),
    'Acceptance searches must be scoped to the selected public repository without OR or NOT branches'
  )
}

/** Both paths make real requests, while expected records come from independent oracle calls. */
async function githubApi(endpoint: string, lane: RequestLog['lane']): Promise<unknown> {
  const url = new URL(endpoint, 'https://api.github.com')
  assert.equal(url.origin, 'https://api.github.com', 'Unexpected GitHub API origin')
  if (url.pathname.startsWith('/search/')) {
    assert.equal(url.pathname, '/search/issues', 'Only issue search is supported')
    assertRepositoryScope(url.searchParams.get('q') ?? '')
  } else if (
    url.pathname !== `/repos/${repository}` &&
    !url.pathname.startsWith(`/repos/${repository}/`)
  ) {
    throw new Error('Acceptance reads must stay inside the selected public repository')
  }
  const started = performance.now()
  try {
    const { stdout } = await exec(
      'gh',
      [
        'api',
        endpoint,
        '-H',
        'Accept: application/vnd.github.text-match+json',
        '-H',
        'X-GitHub-Api-Version: 2026-03-10',
      ],
      { maxBuffer: 4 * 1024 * 1024, timeout: 10_000 }
    )
    const result: unknown = JSON.parse(stdout)
    requests.push({
      path: endpoint,
      lane,
      status: 'passed',
      durationMs: Math.round(performance.now() - started),
    })
    return result
  } catch (error) {
    requests.push({
      path: endpoint,
      lane,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
    })
    throw error
  }
}

const client: NativeClient = {
  async json(path, options) {
    if (options?.body) throw new Error('Acceptance does not permit provider mutations')
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(options?.query ?? {}))
      for (const item of Array.isArray(value) ? value : [value]) query.append(key, item)
    const endpoint = `${path}${query.size ? `?${query}` : ''}`
    return githubApi(endpoint, 'adapter')
  },
  async bytes() {
    throw new Error('Unexpected binary request in a PR read')
  },
  async text() {
    throw new Error('Unexpected text request in a PR read')
  },
}

async function check(name: string, run: () => void | Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
  }
}

function snippet(value: string): string {
  return truncate(
    value
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\[vc\]:[^\n]*/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
    240
  )
}

function latency(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0
  return {
    count: samples.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: percentile(1),
  }
}

async function runQuery(test: QueryCase, repositoryId: string) {
  const native = { provider: 'github', kind: 'issues', query: test.query } as const
  const report: QueryReport = {
    name: test.name,
    question: test.question,
    native,
    filters: test.filters,
    actualProviderQueries: [],
    results: [],
    oracleResultIds: [],
    oracleTotal: 0,
    evidence: [],
    samplesMs: [],
    status: 'failed',
  }
  queries.push(report)
  const firstRequest = requests.length
  try {
    const oracleRows: Record<string, unknown>[] = []
    const start = test.filters?.startDate
      ? new Date(test.filters.startDate).toISOString()
      : undefined
    const end = test.filters?.endDate ? new Date(test.filters.endDate).toISOString() : undefined
    const oracleQueries = test.oracleQueries.flatMap((query) => {
      const typed = (query.match(/"[^"]*"|\S+/g) ?? []).some((token) =>
        /^(?:is|type):(?:issue|pr|pull-request)$/i.test(token)
      )
      return typed ? [query] : [`${query} is:issue`, `${query} is:pr`]
    })
    for (const query of oracleQueries) {
      const nativeDateRange = (query.match(/"[^"]*"|\S+/g) ?? []).some((token) =>
        /^updated:/i.test(token)
      )
      const dateRange = nativeDateRange
        ? undefined
        : start && end
          ? `updated:${start}..${end}`
          : start
            ? `updated:>=${start}`
            : end
              ? `updated:<=${end}`
              : undefined
      const params = new URLSearchParams({
        q: [query, dateRange].filter(Boolean).join(' '),
        per_page: '10',
        page: '1',
        ...(test.filters?.sortBy === 'newest' || test.filters?.sortBy === 'oldest'
          ? { sort: 'updated', order: test.filters.sortBy === 'newest' ? 'desc' : 'asc' }
          : {}),
      })
      const data = object(await githubApi(`/search/issues?${params}`, 'oracle'))
      assert.equal(data.incomplete_results, false, 'GitHub oracle search was incomplete')
      report.oracleTotal += Number(data.total_count)
      const rows = array(data.items)
      if (dateRange) {
        for (const row of rows) {
          const updated = Date.parse(string(row.updated_at))
          assert.ok(
            Number.isFinite(updated) &&
              (!start || updated >= Date.parse(start)) &&
              (!end || updated <= Date.parse(end)),
            'Oracle candidate is outside the inclusive provider date interval'
          )
        }
      }
      oracleRows.push(...rows)
    }
    report.oracleResultIds = [...new Set(oracleRows.map((row) => string(row.number)))].sort()
    let page: NativePage = { documents: [] }
    for (let repetition = 0; repetition < 2; repetition++) {
      const started = performance.now()
      page = await searchGitHub(client, {
        query: test.question,
        native,
        filters: test.filters,
        limit: 10,
        policy: defaultLiveSearchPolicy(),
        scopes: ['repo'],
      })
      report.samplesMs.push(Math.round(performance.now() - started))
      assert.equal(Boolean(page.partial), false, 'Adapter reported partial provider coverage')
      assert.deepEqual(
        [...new Set(page.documents.map((document) => document.id))].sort(),
        report.oracleResultIds,
        'Adapter result IDs differ from independent API query'
      )
      assert.ok(
        page.documents.every((document) => document.container === repository),
        'Result escaped exact repository scope'
      )
    }
    report.results = page.documents.map((document) => ({
      id: document.id,
      title: document.title,
      url: document.url,
      snippet: snippet(document.content),
      container: document.container,
      kind: document.kind,
    }))
    if (test.expectedId)
      assert.ok(
        page.documents.some((document) => document.id === test.expectedId),
        'Known relevant PR was missing'
      )
    if (test.commentFragment) {
      const expected = page.documents.find((document) => document.id === test.expectedId)
      assert.ok(expected, 'Expected discussion result missing')
      const matches = oracleRows
        .filter((row) => string(row.number) === test.expectedId)
        .flatMap((row) => array(row.text_matches))
        .filter((match) => {
          const type = string(match.object_type)
          return (
            (type === 'IssueComment' || type === 'ReviewComment') &&
            match.property === 'body' &&
            string(match.fragment)
          )
        })
      assert.ok(matches.length, 'Oracle did not supply a matched discussion fragment')
      for (const match of matches) {
        assert.ok(
          expected.content.includes(string(match.fragment)),
          'Search preview lost provider matched discussion evidence'
        )
        report.evidence.push({
          type: string(match.object_type),
          url: string(match.object_url),
          snippet: snippet(string(match.fragment)),
        })
      }
      let foundExpectedComment = false
      for (const [type, resource] of [
        ['IssueComment', 'issues'],
        ['ReviewComment', 'pulls'],
      ] as const) {
        const typedMatches = matches.filter((match) => match.object_type === type)
        if (!typedMatches.length) continue
        const comments = array(
          await githubApi(
            `/repos/${repository}/${resource}/${test.expectedId}/comments?per_page=100`,
            'oracle'
          )
        )
        assert.ok(
          comments.length < 100,
          'Comment oracle coverage is incomplete; choose a fixture with fewer than 100 comments per collection'
        )
        for (const match of typedMatches) {
          const url = new URL(string(match.object_url))
          assert.ok(
            url.origin === 'https://api.github.com' &&
              !url.username &&
              !url.password &&
              !url.search &&
              !url.hash,
            'Unexpected matched comment URL'
          )
          const comment = comments.find((row) => {
            const suffix = `/${resource}/comments/${string(row.id)}`
            return (
              url.pathname === `/repos/${repository}${suffix}` ||
              url.pathname === `/repositories/${repositoryId}${suffix}`
            )
          })
          assert.ok(comment, 'Matched comment was not found in the selected discussion')
          if (string(comment.body).toLowerCase().includes(test.commentFragment.toLowerCase())) {
            foundExpectedComment = true
            report.evidence.push({
              type: 'matched-comment-source',
              url: string(comment.html_url),
              snippet: snippet(string(comment.body)),
            })
          }
        }
      }
      assert.ok(foundExpectedComment, 'Matched comment source did not contain expected evidence')
      report.evidence.push({
        type: 'query-semantics',
        snippet:
          'GitHub normalizes hyphenated query terms. A matched review/comment fragment may not contain the literal quoted phrase; read the original before claiming exact wording.',
      })
    }
    if (test.reviewer || test.approved !== undefined) {
      const document = test.expectedId
        ? page.documents.find((document) => document.id === test.expectedId)
        : page.documents[0]
      assert.ok(document, 'Review expectations require a matching PR result')
      const reviews = array(
        await githubApi(`/repos/${repository}/pulls/${document.id}/reviews?per_page=100`, 'oracle')
      )
      assert.ok(
        reviews.length < 100,
        'Review oracle coverage is incomplete; choose a fixture with fewer than 100 reviews'
      )
      const submitted = reviews.filter(
        (review) => review.state !== 'PENDING' && string(review.submitted_at)
      )
      if (test.reviewer)
        assert.ok(
          submitted.some(
            (review) =>
              string(object(review.user).login).toLowerCase() === test.reviewer!.toLowerCase()
          ),
          'Independent review events do not contain the expected reviewer'
        )
      if (test.approved !== undefined)
        assert.equal(
          submitted.some((review) => review.state === 'APPROVED'),
          test.approved,
          'Independent review events do not match the expected APPROVED event presence'
        )
      report.evidence.push({
        type: 'review-events',
        url: document.url,
        snippet: [
          `${submitted.length} submitted review events`,
          test.reviewer && `verified reviewer ${test.reviewer}`,
          test.approved !== undefined && `verified APPROVED event presence: ${test.approved}`,
        ]
          .filter(Boolean)
          .join('; '),
      })
    }
    report.status = 'passed'
  } catch (error) {
    report.error = getErrorMessage(error)
    throw error
  } finally {
    report.actualProviderQueries = [
      ...new Set(
        requests
          .slice(firstRequest)
          .filter((request) => request.lane === 'adapter' && request.path.startsWith('/search/'))
          .map(
            (request) => new URL(request.path, 'https://api.github.com').searchParams.get('q') ?? ''
          )
      ),
    ]
  }
}

try {
  const file = await open(casesPath, 'r')
  let cases: QueryCase[]
  try {
    const buffer = Buffer.alloc(65_537)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    assert.ok(length <= 65_536, 'Case file must not exceed 64 KiB')
    const payload: unknown = JSON.parse(buffer.toString('utf8', 0, length))
    cases = queryCasesSchema.parse(payload)
    for (const test of cases)
      for (const query of [test.query, ...test.oracleQueries]) {
        assertRepositoryScope(query)
        assert.ok(
          !exceedsGitHubTextLimit(query),
          `Case "${test.name}" exceeds GitHub's 256-character search text limit`
        )
      }
  } finally {
    await file.close()
  }
  const repositoryInfo = object(await githubApi(`/repos/${repository}`, 'oracle'))
  assert.equal(
    repositoryInfo.private,
    false,
    'Use a public repository for sanitized acceptance evidence'
  )
  const repositoryId = string(repositoryInfo.id)
  assert.match(repositoryId, /^[1-9]\d*$/, 'Repository metadata did not contain a valid ID')
  const fixture = object(await githubApi(`/repos/${repository}/issues/${number}`, 'oracle'))
  for (const test of cases) await check(test.name, () => runQuery(test, repositoryId))
  const readRequestsStart = requests.length
  const reference = queries.flatMap((query) => query.results).find((result) => result.id === number)
  assert.ok(
    reference,
    'None of the sample searches found the fixture needed for search-to-read validation'
  )
  const readStarted = performance.now()
  const document = await readGitHub(client, reference.id, reference.container, reference.kind)
  readSamplesMs.push(Math.round(performance.now() - readStarted))
  await check('Selected PR identity and source URL survive the read', () => {
    assert.equal(document.id, number)
    assert.equal(document.container, repository)
    assert.equal(document.url, `https://github.com/${repository}/pull/${number}`)
  })
  await check('PR body is preserved', () => {
    const body = string(fixture.body)
    assert.ok(body.length > 0, 'Choose a PR with a nonempty description')
    assert.ok(document.content.includes(body), 'Description missing from read')
  })
  for (const [name, endpoint, review] of [
    ['Conversation comments', `/repos/${repository}/issues/${number}/comments`, false],
    ['Review events', `/repos/${repository}/pulls/${number}/reviews`, true],
    ['Inline review comments', `/repos/${repository}/pulls/${number}/comments`, false],
  ] as const) {
    await check(`${name} retain real provider text, author and permalink`, async () => {
      const rows = array(await githubApi(`${endpoint}?per_page=100`, 'oracle'))
      const entry = rows.find((row) => string(row.body) && (!review || row.state !== 'PENDING'))
      assert.ok(entry, `Choose a PR with a nonempty ${name.toLowerCase()} entry`)
      for (const evidence of [
        string(entry.body),
        string(object(entry.user).login),
        string(entry.html_url),
        ...(review ? [string(entry.state)] : []),
      ]) {
        assert.ok(evidence, 'Expected provider evidence missing from fixture')
        assert.ok(document.content.includes(evidence), 'Provider evidence missing from read')
      }
    })
  }
  await check('Requests and rendered discussion remain bounded', () => {
    assert.ok(
      requests.slice(readRequestsStart).filter((request) => request.lane === 'adapter').length <= 10
    )
    assert.ok(document.content.length < 450_000)
    assert.ok(
      requests.every(({ status }) => status === 'passed'),
      'One or more provider requests failed'
    )
  })
} catch (error) {
  checks.push({
    name: 'Live GitHub acceptance setup or document read',
    status: 'failed',
    durationMs: 0,
    error: getErrorMessage(error),
  })
} finally {
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        repository,
        pullRequest: number,
        boundary:
          'Real searchGitHub/readGitHub adapters over gh-authenticated GitHub API; independent oracle GETs and inclusive native date candidates. Does not exercise application half-open date filtering, model query selection, application authorization, or UI.',
        checks,
        queries,
        requests,
        latency: {
          search: latency(queries.flatMap((query) => query.samplesMs)),
          read: latency(readSamplesMs),
          adapterRequests: latency(
            requests
              .filter((request) => request.lane === 'adapter')
              .map((request) => request.durationMs)
          ),
        },
      },
      null,
      2
    )
  )
}
const failed = checks.filter(({ status }) => status === 'failed').length
logger.info('GitHub live discussion acceptance completed', {
  passed: checks.length - failed,
  failed,
  reportPath,
})
if (failed) process.exitCode = 1
