/**
 * Shared pull-request reads for the Pi cloud modes. Review Code pins a snapshot
 * before cloning and re-validates it before submitting; Babysit pins one per
 * round. Keeping the coordinate validation,
 * fetch, and parse here stops the two from drifting on checks that decide which
 * repository a credential is pointed at and which commit a write lands on.
 */

import { executeTool } from '@/tools'
import {
  isRecord,
  nullableBoolean,
  nullableString,
  requiredBoolean,
  requiredNumber,
  requiredRecord,
  requiredTrimmedString,
} from '@/tools/github/response-parsers'

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9_.-]+$/
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i
const PULL_REQUEST_RESPONSE_CONTEXT = 'GitHub pull request response'

/** Bound on untrusted pull-request-authored text folded into a Pi prompt. */
export const MAX_REVIEW_BODY_LENGTH = 8_000

/** Everything a pull-request read needs, independent of which mode asked for it. */
export interface PullRequestCoordinates {
  owner: string
  repo: string
  pullNumber: number
  githubToken: string
}

export interface PullRequestSnapshot {
  headSha: string
  headRef: string
  headRepoFullName: string | null
  baseSha: string
  baseRef: string
  baseRepoFullName: string | null
  title: string
  body: string
  htmlUrl: string
  state: string
  merged: boolean
  mergeable: boolean | null
}

export interface BranchPullRequest {
  pullNumber: number
  snapshot: PullRequestSnapshot
}

function requiredSha(record: Record<string, unknown>, field: string, context: string): string {
  const value = requiredTrimmedString(record, field, context)
  if (!COMMIT_SHA_PATTERN.test(value)) {
    throw new Error(`${context}.${field} must be a full commit SHA`)
  }
  return value
}

export function parsePullRequestSnapshot(value: unknown): PullRequestSnapshot {
  if (!isRecord(value)) throw new Error(`${PULL_REQUEST_RESPONSE_CONTEXT} must be an object`)

  const head = requiredRecord(value, 'head', PULL_REQUEST_RESPONSE_CONTEXT)
  const base = requiredRecord(value, 'base', PULL_REQUEST_RESPONSE_CONTEXT)
  const headContext = `${PULL_REQUEST_RESPONSE_CONTEXT}.head`
  const baseContext = `${PULL_REQUEST_RESPONSE_CONTEXT}.base`

  return {
    headSha: requiredSha(head, 'sha', headContext),
    headRef: requiredTrimmedString(head, 'ref', headContext),
    headRepoFullName: nullableString(head, 'repo_full_name', headContext),
    baseSha: requiredSha(base, 'sha', baseContext),
    baseRef: requiredTrimmedString(base, 'ref', baseContext),
    baseRepoFullName: nullableString(base, 'repo_full_name', baseContext),
    title: requiredTrimmedString(value, 'title', PULL_REQUEST_RESPONSE_CONTEXT),
    body: nullableString(value, 'body', PULL_REQUEST_RESPONSE_CONTEXT) ?? '',
    htmlUrl: requiredTrimmedString(value, 'html_url', PULL_REQUEST_RESPONSE_CONTEXT),
    state: requiredTrimmedString(value, 'state', PULL_REQUEST_RESPONSE_CONTEXT),
    merged: requiredBoolean(value, 'merged', PULL_REQUEST_RESPONSE_CONTEXT),
    mergeable: nullableBoolean(value, 'mergeable', PULL_REQUEST_RESPONSE_CONTEXT),
  }
}

/**
 * Reads and validates the pull request without judging its state. A mode that
 * must report a closed PR gracefully rather than throw builds on this form.
 */
export async function fetchPrSnapshot(
  params: PullRequestCoordinates,
  signal?: AbortSignal
): Promise<PullRequestSnapshot> {
  const result = await executeTool(
    'github_pr_v2',
    {
      owner: params.owner,
      repo: params.repo,
      pullNumber: params.pullNumber,
      includeFiles: false,
      apiKey: params.githubToken,
    },
    { signal }
  )

  if (!result.success) {
    throw new Error(`Failed to fetch PR #${params.pullNumber}: ${result.error ?? 'unknown error'}`)
  }

  return parsePullRequestSnapshot(result.output)
}

/** {@link fetchPrSnapshot} for callers that cannot proceed on a non-open PR. */
export async function fetchOpenPrSnapshot(
  params: PullRequestCoordinates,
  signal?: AbortSignal
): Promise<PullRequestSnapshot> {
  const snapshot = await fetchPrSnapshot(params, signal)
  if (snapshot.state !== 'open') {
    throw new Error(`PR #${params.pullNumber} is ${snapshot.state}; only open PRs can be reviewed`)
  }
  return snapshot
}

/**
 * Finds the single open, same-repository pull request whose head is exactly the
 * requested branch. Update Branch uses this before starting a sandbox so
 * Babysit never guesses which pull request to monitor.
 */
export async function findOpenPrForBranch(
  params: Omit<PullRequestCoordinates, 'pullNumber'> & { branch: string },
  signal?: AbortSignal
): Promise<BranchPullRequest> {
  validateRepositoryCoordinates({ ...params, pullNumber: 1 })
  const result = await executeTool(
    'github_list_prs_v2',
    {
      owner: params.owner,
      repo: params.repo,
      state: 'open',
      head: `${params.owner}:${params.branch}`,
      per_page: 2,
      page: 1,
      apiKey: params.githubToken,
    },
    { signal }
  )
  if (!result.success) {
    throw new Error(
      `Failed to find an open PR for branch ${params.branch}: ${result.error ?? 'unknown error'}`
    )
  }

  const output = result.output
  if (!isRecord(output)) {
    throw new Error('GitHub pull request list response.output must be an object')
  }
  const items = output.items
  if (!Array.isArray(items)) {
    throw new Error('GitHub pull request list response.output.items must be an array')
  }
  if (items.length === 0) {
    throw new Error(
      `Update Branch Babysit requires one open pull request for branch ${params.branch}, but none was found`
    )
  }
  if (items.length > 1) {
    throw new Error(
      `Update Branch Babysit found multiple open pull requests for branch ${params.branch}`
    )
  }

  if (!isRecord(items[0])) {
    throw new Error('GitHub pull request list response item must be an object')
  }
  const pullNumber = requiredNumber(items[0], 'number', 'GitHub pull request list response item')
  if (pullNumber < 1) {
    throw new Error('GitHub pull request list response item.number must be positive')
  }

  const snapshot = await fetchOpenPrSnapshot(
    {
      owner: params.owner,
      repo: params.repo,
      pullNumber,
      githubToken: params.githubToken,
    },
    signal
  )
  const expectedRepo = `${params.owner}/${params.repo}`.toLowerCase()
  if (
    snapshot.headRef !== params.branch ||
    snapshot.headRepoFullName?.toLowerCase() !== expectedRepo
  ) {
    throw new Error(
      `PR #${pullNumber} no longer points to ${params.owner}/${params.repo}:${params.branch}`
    )
  }

  return { pullNumber, snapshot }
}

export function validateRepositoryCoordinates(params: PullRequestCoordinates): void {
  if (
    !GITHUB_OWNER_PATTERN.test(params.owner) ||
    !GITHUB_REPO_PATTERN.test(params.repo) ||
    params.repo === '.' ||
    params.repo === '..' ||
    !Number.isSafeInteger(params.pullNumber) ||
    params.pullNumber < 1
  ) {
    throw new Error('Invalid GitHub repository coordinates or pull request number')
  }
}
