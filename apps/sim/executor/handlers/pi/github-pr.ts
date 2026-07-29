/**
 * Shared pull-request reads for the Pi cloud modes. Review Code pins a snapshot
 * before cloning and re-validates it before submitting; Babysit pins one per
 * round. Keeping the coordinate validation,
 * fetch, and parse here stops the two from drifting on checks that decide which
 * repository a credential is pointed at and which commit a write lands on.
 */

import { executeTool } from '@/tools'
import { GITHUB_GRAPHQL_URL, githubGraphQlHeaders, readGraphQlData } from '@/tools/github/graphql'
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

export type PullRequestDraftState = 'draft' | 'ready'

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
 * Verifies that an open pull request still belongs to the requested branch in
 * the requested repository.
 */
export async function fetchOpenPrForBranch(
  params: PullRequestCoordinates & { branch: string },
  signal?: AbortSignal
): Promise<BranchPullRequest> {
  const snapshot = await fetchOpenPrSnapshot(params, signal)
  const expectedRepo = `${params.owner}/${params.repo}`.toLowerCase()
  if (
    snapshot.headRef !== params.branch ||
    snapshot.headRepoFullName?.toLowerCase() !== expectedRepo
  ) {
    throw new Error(
      `PR #${params.pullNumber} no longer points to ${params.owner}/${params.repo}:${params.branch}`
    )
  }
  return { pullNumber: params.pullNumber, snapshot }
}

/**
 * Finds the single open, same-repository pull request whose head is exactly the
 * requested branch. No match is valid because Update PR can create the missing
 * pull request after it has safely pushed the branch.
 */
export async function findOpenPrForBranch(
  params: Omit<PullRequestCoordinates, 'pullNumber'> & { branch: string },
  signal?: AbortSignal
): Promise<BranchPullRequest | undefined> {
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
    return undefined
  }
  if (items.length > 1) {
    throw new Error(`Update PR found multiple open pull requests for branch ${params.branch}`)
  }

  if (!isRecord(items[0])) {
    throw new Error('GitHub pull request list response item must be an object')
  }
  const pullNumber = requiredNumber(items[0], 'number', 'GitHub pull request list response item')
  if (pullNumber < 1) {
    throw new Error('GitHub pull request list response item.number must be positive')
  }

  return fetchOpenPrForBranch(
    {
      owner: params.owner,
      repo: params.repo,
      pullNumber,
      githubToken: params.githubToken,
      branch: params.branch,
    },
    signal
  )
}

/**
 * Changes only the draft/ready state. GitHub's REST pull-request update API
 * cannot perform this transition, so the host uses the corresponding GraphQL
 * mutation while keeping the token out of Pi's environment.
 */
export async function setPullRequestDraftState(
  params: PullRequestCoordinates & { state: PullRequestDraftState },
  signal?: AbortSignal
): Promise<void> {
  validateRepositoryCoordinates(params)
  const variables = {
    owner: params.owner,
    repo: params.repo,
    pullNumber: params.pullNumber,
  }
  const queryResponse = await fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: githubGraphQlHeaders(params.githubToken),
    body: JSON.stringify({
      query: `query PiPullRequestDraftState($owner: String!, $repo: String!, $pullNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pullNumber) {
            id
            isDraft
          }
        }
      }`,
      variables,
    }),
    signal,
  })
  const queryData = await readGraphQlData(queryResponse, 'GitHub pull request draft-state query')
  const repository = requiredRecord(
    queryData,
    'repository',
    'GitHub pull request draft-state query.data'
  )
  const pullRequest = requiredRecord(
    repository,
    'pullRequest',
    'GitHub pull request draft-state query.data.repository'
  )
  const pullRequestId = requiredTrimmedString(
    pullRequest,
    'id',
    'GitHub pull request draft-state query.data.repository.pullRequest'
  )
  const isDraft = requiredBoolean(
    pullRequest,
    'isDraft',
    'GitHub pull request draft-state query.data.repository.pullRequest'
  )
  const shouldBeDraft = params.state === 'draft'
  if (isDraft === shouldBeDraft) return

  const mutationName = shouldBeDraft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview'
  const mutationResponse = await fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: githubGraphQlHeaders(params.githubToken),
    body: JSON.stringify({
      query: `mutation PiSetPullRequestDraftState($pullRequestId: ID!) {
        ${mutationName}(input: { pullRequestId: $pullRequestId }) {
          pullRequest {
            id
            isDraft
          }
        }
      }`,
      variables: { pullRequestId },
    }),
    signal,
  })
  await readGraphQlData(mutationResponse, 'GitHub pull request draft-state mutation')
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
