import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import type { BabysitRoundDecision } from '@/executor/handlers/pi/babysit-round'
import {
  fetchPrSnapshot,
  type PullRequestCoordinates,
  type PullRequestSnapshot,
  validateRepositoryCoordinates,
} from '@/executor/handlers/pi/github-pr'
import { scrubPiSecrets } from '@/executor/handlers/pi/redaction'
import { executeTool } from '@/tools'
import {
  isRecord,
  nullableNumber,
  nullableString,
  requiredBoolean,
  requiredNumber,
  requiredString,
  requiredTrimmedString,
} from '@/tools/github/response-parsers'
import type {
  ReviewThread,
  StatusCheckRollupContext,
  SubmittedReviewSummary,
} from '@/tools/github/types'

const MAX_PAGES = 10
const MAX_COMMENTS_PER_THREAD = 50
const MAX_CHECK_DIAGNOSTIC_BYTES = 20_000
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const NON_FAILING_CHECK_CONCLUSIONS = new Set([
  'SUCCESS',
  'NEUTRAL',
  'SKIPPED',
  'CANCELLED',
  'STALE',
])
const KNOWN_ROLLUP_STATES = new Set(['EXPECTED', 'ERROR', 'FAILURE', 'PENDING', 'SUCCESS'])
const REF_FORBIDDEN = /[\u0000-\u0020\u007f~^:?*[\\]/

export type BabysitStopReason =
  | 'clean'
  | 'closed_or_merged'
  | 'fork_pr'
  | 'head_moved'
  | 'check_read_failed'
  | 'skipped_threads'
  | 'stuck_threads'
  | 'stuck_checks'
  | 'startup_failure'
  | 'refused_content'
  | 'bounds_exceeded'
  | 'push_rejected'
  | 'pushed_awaiting_confirmation'
  | 'agent_failure'
  | 'rounds_exhausted'
  | 'budget_exhausted'
  | 'awaiting_review'
  | 'awaiting_checks'

export interface BabysitSnapshot extends PullRequestSnapshot {
  mergeConflicted: boolean
}

export interface TrustedReviewThread extends ReviewThread {
  comments: ReviewThread['comments']
}

export interface BabysitThreadsState {
  actionable: TrustedReviewThread[]
  skipped: ReviewThread[]
  totalUnresolved: number
  latestReview: SubmittedReviewSummary | null
}

export type BabysitCheckDisposition = 'passing' | 'pending' | 'failing'

export interface BabysitCheck {
  key: string
  name: string
  type: 'check_run' | 'status_context'
  disposition: BabysitCheckDisposition
  required: boolean
  status: string
  conclusion: string | null
  detailsUrl: string | null
  databaseId: number | null
  title: string | null
  summary: string | null
}

export interface BabysitCheckState {
  checks: BabysitCheck[]
  failing: BabysitCheck[]
  pending: BabysitCheck[]
  blockingFailing: BabysitCheck[]
  blockingPending: BabysitCheck[]
  checksGreen: boolean
  startupFailure: boolean
  contextRequirements: Map<string, boolean>
}

export interface BabysitReplyResolveResult {
  repliesPosted: number
  threadsResolved: number
  replyFailures: string[]
  resolveFailures: string[]
  headMoved: boolean
  awaitingConfirmation: boolean
  stopReason?: BabysitStopReason
  phaseError?: string
}

export interface BabysitReviewRequestResult {
  requestedAt: string
  commentIds: Set<number>
  posted: number
  failures: string[]
}

/** Error whose code is safe for the backend to turn into a partial-success stop report. */
export class BabysitGitHubError extends Error {
  constructor(
    public readonly reason: BabysitStopReason,
    message: string
  ) {
    super(message)
    this.name = 'BabysitGitHubError'
  }
}

function validHeadRef(ref: string): boolean {
  return (
    ref.length <= 255 &&
    !REF_FORBIDDEN.test(ref) &&
    !ref.startsWith('.') &&
    !ref.startsWith('/') &&
    !ref.endsWith('.') &&
    !ref.endsWith('/') &&
    !ref.endsWith('.lock') &&
    !ref.includes('..') &&
    !ref.includes('//') &&
    !ref.includes('@{') &&
    ref !== '@'
  )
}

/** Fetches the strict state needed to pin a same-repository Babysit run. */
export async function fetchBabysitSnapshot(
  params: PullRequestCoordinates,
  signal?: AbortSignal
): Promise<BabysitSnapshot> {
  validateRepositoryCoordinates(params)
  const snapshot = await fetchPrSnapshot(params, signal)
  if (!validHeadRef(snapshot.headRef)) {
    throw new BabysitGitHubError(
      'head_moved',
      'The pull request head branch is not a valid Git ref'
    )
  }
  if (snapshot.headRepoFullName?.toLowerCase() !== `${params.owner}/${params.repo}`.toLowerCase()) {
    throw new BabysitGitHubError('fork_pr', 'Babysit does not support fork pull requests')
  }
  return { ...snapshot, mergeConflicted: snapshot.mergeable === false }
}

/** Revalidates all mutable snapshot fields that constrain a host-side write. */
export function assertBabysitPinned(
  pin: Pick<BabysitSnapshot, 'headSha' | 'headRef' | 'baseRef'>,
  current: BabysitSnapshot
): void {
  if (current.state !== 'open' || current.merged) {
    throw new BabysitGitHubError('closed_or_merged', 'The pull request is closed or merged')
  }
  if (
    current.headSha !== pin.headSha ||
    current.headRef !== pin.headRef ||
    current.baseRef !== pin.baseRef
  ) {
    throw new BabysitGitHubError('head_moved', 'The pull request changed outside Babysit')
  }
}

function toolFailure(label: string, error: unknown): Error {
  return new Error(
    `${label}: ${typeof error === 'string' && error ? error : 'unknown GitHub error'}`
  )
}

function parseReviewThread(value: unknown, index: number): ReviewThread {
  if (!isRecord(value)) throw new Error(`Review thread ${index} must be an object`)
  const commentsValue = value.comments
  if (!Array.isArray(commentsValue))
    throw new Error(`Review thread ${index}.comments must be an array`)
  const comments = commentsValue.map((comment, commentIndex) => {
    if (!isRecord(comment)) {
      throw new Error(`Review thread ${index}.comments[${commentIndex}] must be an object`)
    }
    return {
      body: requiredString(comment, 'body', `Review thread ${index}.comments[${commentIndex}]`),
      authorAssociation: requiredString(
        comment,
        'authorAssociation',
        `Review thread ${index}.comments[${commentIndex}]`
      ),
      authorLogin: nullableString(
        comment,
        'authorLogin',
        `Review thread ${index}.comments[${commentIndex}]`
      ),
      authorType: nullableString(
        comment,
        'authorType',
        `Review thread ${index}.comments[${commentIndex}]`
      ),
    }
  })
  return {
    id: requiredTrimmedString(value, 'id', `Review thread ${index}`),
    isResolved: requiredBoolean(value, 'isResolved', `Review thread ${index}`),
    path: requiredString(value, 'path', `Review thread ${index}`),
    line: nullableNumber(value, 'line', `Review thread ${index}`),
    commentsTotalCount: requiredNumber(value, 'commentsTotalCount', `Review thread ${index}`),
    comments,
  }
}

function parseLatestReview(value: unknown): SubmittedReviewSummary | null {
  if (value === null) return null
  if (!isRecord(value)) throw new Error('latestReview must be an object or null')
  return {
    state: requiredString(value, 'state', 'latestReview'),
    submittedAt: requiredString(value, 'submittedAt', 'latestReview'),
    authorLogin: nullableString(value, 'authorLogin', 'latestReview'),
    authorType: nullableString(value, 'authorType', 'latestReview'),
  }
}

function threadTrusted(thread: ReviewThread): boolean {
  return (
    thread.comments.length > 0 &&
    thread.commentsTotalCount === thread.comments.length &&
    thread.comments.every(
      (comment) =>
        comment.authorType === 'Bot' || TRUSTED_ASSOCIATIONS.has(comment.authorAssociation)
    )
  )
}

/** Pages all review threads and skips a thread whole if any content is missing or untrusted. */
export async function fetchBabysitThreads(
  params: PullRequestCoordinates,
  signal?: AbortSignal
): Promise<BabysitThreadsState> {
  const threads: ReviewThread[] = []
  let cursor: string | undefined
  let expectedTotal: number | undefined
  let latestReview: SubmittedReviewSummary | null = null

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await executeTool(
      'github_list_review_threads',
      {
        owner: params.owner,
        repo: params.repo,
        pullNumber: params.pullNumber,
        threadsPerPage: 100,
        commentsPerThread: MAX_COMMENTS_PER_THREAD,
        ...(cursor ? { cursor } : {}),
        apiKey: params.githubToken,
      },
      { signal }
    )
    if (!result.success) throw toolFailure('Failed to fetch review threads', result.error)
    const output = result.output
    if (!isRecord(output) || !Array.isArray(output.threads)) {
      throw new Error('Review thread response is incomplete')
    }
    const totalCount = requiredNumber(output, 'totalCount', 'Review thread response')
    expectedTotal ??= totalCount
    if (expectedTotal !== totalCount) throw new Error('Review thread count changed while paging')
    const parsed = output.threads.map(parseReviewThread)
    threads.push(...parsed)
    latestReview = parseLatestReview(output.latestReview)
    const hasNextPage = requiredBoolean(output, 'hasNextPage', 'Review thread response')
    if (!hasNextPage) {
      if (threads.length !== expectedTotal) throw new Error('Review thread response was partial')
      const unresolved = threads.filter((thread) => !thread.isResolved)
      return {
        actionable: unresolved.filter(threadTrusted),
        skipped: unresolved.filter((thread) => !threadTrusted(thread)),
        totalUnresolved: unresolved.length,
        latestReview,
      }
    }
    const endCursor = nullableString(output, 'endCursor', 'Review thread response')
    if (!endCursor) throw new Error('Review thread response omitted its next cursor')
    cursor = endCursor
  }
  throw new Error(`Review thread listing exceeded ${MAX_PAGES} pages`)
}

function checkKey(context: StatusCheckRollupContext): string {
  return context.__typename === 'CheckRun' ? `check:${context.name}` : `status:${context.context}`
}

function normalizeCheck(context: StatusCheckRollupContext): BabysitCheck {
  if (context.__typename === 'CheckRun') {
    const disposition: BabysitCheckDisposition =
      context.status !== 'COMPLETED'
        ? 'pending'
        : context.conclusion && NON_FAILING_CHECK_CONCLUSIONS.has(context.conclusion)
          ? 'passing'
          : 'failing'
    return {
      key: checkKey(context),
      name: context.name,
      type: 'check_run',
      disposition,
      required: context.isRequired,
      status: context.status,
      conclusion: context.conclusion,
      detailsUrl: context.detailsUrl,
      databaseId: context.databaseId,
      title: context.title,
      summary: context.summary,
    }
  }
  const disposition: BabysitCheckDisposition =
    context.state === 'SUCCESS'
      ? 'passing'
      : context.state === 'PENDING' || context.state === 'EXPECTED'
        ? 'pending'
        : 'failing'
  return {
    key: checkKey(context),
    name: context.context,
    type: 'status_context',
    disposition,
    required: context.isRequired,
    status: context.state,
    conclusion: context.state,
    detailsUrl: context.targetUrl,
    databaseId: null,
    title: null,
    summary: context.description,
  }
}

function parseCheckContext(value: unknown, index: number): StatusCheckRollupContext {
  if (!isRecord(value)) throw new Error(`Check context ${index} must be an object`)
  const type = requiredString(value, '__typename', `Check context ${index}`)
  if (type === 'CheckRun') {
    return {
      __typename: 'CheckRun',
      name: requiredTrimmedString(value, 'name', `Check context ${index}`),
      status: requiredTrimmedString(value, 'status', `Check context ${index}`),
      conclusion: nullableString(value, 'conclusion', `Check context ${index}`),
      detailsUrl: nullableString(value, 'detailsUrl', `Check context ${index}`),
      databaseId: nullableNumber(value, 'databaseId', `Check context ${index}`),
      isRequired: requiredBoolean(value, 'isRequired', `Check context ${index}`),
      title: nullableString(value, 'title', `Check context ${index}`),
      summary: nullableString(value, 'summary', `Check context ${index}`),
    }
  }
  if (type === 'StatusContext') {
    return {
      __typename: 'StatusContext',
      context: requiredTrimmedString(value, 'context', `Check context ${index}`),
      state: requiredTrimmedString(value, 'state', `Check context ${index}`),
      description: nullableString(value, 'description', `Check context ${index}`),
      targetUrl: nullableString(value, 'targetUrl', `Check context ${index}`),
      isRequired: requiredBoolean(value, 'isRequired', `Check context ${index}`),
    }
  }
  throw new Error(`Check context ${index} has an unknown type`)
}

/**
 * Reads the complete check rollup for a pinned SHA.
 *
 * Unknown states fail closed. Contexts seen on the initial SHA but missing after a push are
 * synthesized as pending until GitHub registers the new runs.
 */
export async function fetchBabysitCheckState(
  params: PullRequestCoordinates,
  sha: string,
  initialRequirements?: ReadonlyMap<string, boolean>,
  signal?: AbortSignal
): Promise<BabysitCheckState> {
  const contexts: StatusCheckRollupContext[] = []
  let cursor: string | undefined
  let expectedTotal: number | undefined
  let rollupState: string | null | undefined
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await executeTool(
        'github_status_check_rollup',
        {
          owner: params.owner,
          repo: params.repo,
          pullNumber: params.pullNumber,
          sha,
          ...(cursor ? { cursor } : {}),
          apiKey: params.githubToken,
        },
        { signal }
      )
      if (!result.success) throw toolFailure('Failed to fetch checks', result.error)
      const output = result.output
      if (!isRecord(output) || !Array.isArray(output.contexts)) {
        throw new Error('Check response is incomplete')
      }
      const totalCount = requiredNumber(output, 'totalCount', 'Check response')
      const pageRollupState = nullableString(output, 'state', 'Check response')
      if (pageRollupState !== null && !KNOWN_ROLLUP_STATES.has(pageRollupState)) {
        throw new Error(`Check response has unknown rollup state ${pageRollupState}`)
      }
      if (rollupState !== undefined && rollupState !== pageRollupState) {
        throw new Error('Check rollup state changed while paging')
      }
      rollupState = pageRollupState
      expectedTotal ??= totalCount
      if (expectedTotal !== totalCount) throw new Error('Check count changed while paging')
      contexts.push(...output.contexts.map(parseCheckContext))
      const hasNextPage = requiredBoolean(output, 'hasNextPage', 'Check response')
      if (!hasNextPage) {
        if (contexts.length !== expectedTotal) throw new Error('Check response was partial')
        break
      }
      const endCursor = nullableString(output, 'endCursor', 'Check response')
      if (!endCursor) throw new Error('Check response omitted its next cursor')
      cursor = endCursor
      if (page === MAX_PAGES - 1) throw new Error('Check listing exceeded its page bound')
    }
    const canSynthesizeMissingContexts = !!initialRequirements?.size
    if (expectedTotal === undefined || (expectedTotal === 0 && !canSynthesizeMissingContexts)) {
      throw new Error('GitHub returned no check rollup for the pinned commit')
    }
    if (
      (rollupState === null || rollupState === undefined) &&
      !(expectedTotal === 0 && canSynthesizeMissingContexts)
    ) {
      throw new Error('GitHub returned checks without a rollup state')
    }
  } catch (error) {
    if (error instanceof BabysitGitHubError) throw error
    throw new BabysitGitHubError(
      'check_read_failed',
      getErrorMessage(error, 'Failed to read checks')
    )
  }

  const checks = contexts.map(normalizeCheck)
  const present = new Set(checks.map((check) => check.key))
  if (initialRequirements) {
    for (const [key, required] of initialRequirements) {
      if (present.has(key)) continue
      checks.push({
        key,
        name: key.replace(/^[^:]+:/, ''),
        type: key.startsWith('check:') ? 'check_run' : 'status_context',
        disposition: 'pending',
        required,
        status: 'MISSING',
        conclusion: null,
        detailsUrl: null,
        databaseId: null,
        title: null,
        summary: 'This context existed on the initial PR head but has not appeared for this SHA.',
      })
    }
  }
  const contextRequirements = new Map(checks.map((check) => [check.key, check.required]))
  const failing = checks.filter((check) => check.disposition === 'failing')
  const pending = checks.filter((check) => check.disposition === 'pending')
  const blockingFailing = failing.filter((check) => check.required)
  const blockingPending = pending.filter((check) => check.required)
  return {
    checks,
    failing,
    pending,
    blockingFailing,
    blockingPending,
    checksGreen: blockingFailing.length === 0 && blockingPending.length === 0,
    startupFailure: checks.some(
      (check) => check.type === 'check_run' && check.conclusion === 'STARTUP_FAILURE'
    ),
    contextRequirements,
  }
}

/** Fetches bounded, agent-visible diagnostics for failing required and optional checks. */
export async function fetchBabysitCheckDiagnostics(
  params: PullRequestCoordinates,
  failing: readonly BabysitCheck[],
  secrets: readonly string[],
  signal?: AbortSignal
): Promise<Map<string, string>> {
  const diagnostics = new Map<string, string>()
  for (const check of failing) {
    let text = [check.title, check.summary, check.detailsUrl].filter(Boolean).join('\n')
    if (check.type === 'check_run' && check.databaseId && check.detailsUrl?.includes('/actions/')) {
      const result = await executeTool(
        'github_job_logs',
        {
          owner: params.owner,
          repo: params.repo,
          job_id: check.databaseId,
          maxCharacters: MAX_CHECK_DIAGNOSTIC_BYTES,
          apiKey: params.githubToken,
        },
        { signal }
      )
      if (result.success && isRecord(result.output) && typeof result.output.logs === 'string') {
        text = result.output.logs
      } else {
        text = `${text}\n[Actions log unavailable: ${result.error ?? 'unknown error'}]`
      }
    }
    diagnostics.set(
      check.key,
      scrubPiSecrets(
        truncate(text || 'No diagnostic text was reported.', MAX_CHECK_DIAGNOSTIC_BYTES),
        secrets
      )
    )
  }
  return diagnostics
}

async function postThreadReply(
  params: PullRequestCoordinates,
  decision: BabysitRoundDecision,
  signal?: AbortSignal
): Promise<boolean> {
  const result = await executeTool(
    'github_reply_review_thread',
    { threadId: decision.threadId, body: decision.reply, apiKey: params.githubToken },
    { signal }
  )
  return result.success
}

/** Posts all replies, revalidates the pin once, then resolves only successful replies. */
export async function replyAndResolveBabysitThreads(
  params: PullRequestCoordinates,
  pin: Pick<BabysitSnapshot, 'headSha' | 'headRef' | 'baseRef'>,
  decisions: readonly BabysitRoundDecision[],
  signal?: AbortSignal,
  laggingHeadSha?: string
): Promise<BabysitReplyResolveResult> {
  const replySuccesses: BabysitRoundDecision[] = []
  const replyFailures: string[] = []
  for (const decision of decisions) {
    let succeeded = false
    try {
      succeeded = await postThreadReply(params, decision, signal)
    } catch (error) {
      if (signal?.aborted) throw error
    }
    if (!succeeded) {
      replyFailures.push(decision.threadId)
    } else {
      replySuccesses.push(decision)
    }
  }

  try {
    const current = await fetchBabysitSnapshot(params, signal)
    if (
      laggingHeadSha &&
      current.headSha === laggingHeadSha &&
      current.state === 'open' &&
      !current.merged &&
      current.headRef === pin.headRef &&
      current.baseRef === pin.baseRef
    ) {
      return {
        repliesPosted: replySuccesses.length,
        threadsResolved: 0,
        replyFailures,
        resolveFailures: [],
        headMoved: false,
        awaitingConfirmation: true,
      }
    }
    assertBabysitPinned(pin, current)
  } catch (error) {
    if (signal?.aborted) throw error
    return {
      repliesPosted: replySuccesses.length,
      threadsResolved: 0,
      replyFailures,
      resolveFailures: [],
      headMoved: error instanceof BabysitGitHubError && error.reason === 'head_moved',
      awaitingConfirmation: false,
      ...(error instanceof BabysitGitHubError
        ? { stopReason: error.reason }
        : {
            phaseError: scrubPiSecrets(
              getErrorMessage(error, 'Failed to revalidate the pull request after replying'),
              [params.githubToken]
            ),
          }),
    }
  }

  let threadsResolved = 0
  const resolveFailures: string[] = []
  for (const decision of replySuccesses.filter((item) => item.resolvable)) {
    try {
      const result = await executeTool(
        'github_resolve_review_thread',
        { threadId: decision.threadId, apiKey: params.githubToken },
        { signal }
      )
      if (result.success) threadsResolved += 1
      else resolveFailures.push(decision.threadId)
    } catch (error) {
      if (signal?.aborted) throw error
      resolveFailures.push(decision.threadId)
    }
  }
  return {
    repliesPosted: replySuccesses.length,
    threadsResolved,
    replyFailures,
    resolveFailures,
    headMoved: false,
    awaitingConfirmation: false,
  }
}

/** Posts one issue comment per configured mention and retains ids for self-comment filtering. */
export async function requestBabysitReview(
  params: PullRequestCoordinates,
  mentions: readonly string[],
  secrets: readonly string[],
  signal?: AbortSignal
): Promise<BabysitReviewRequestResult> {
  const requestedAt = new Date().toISOString()
  const commentIds = new Set<number>()
  const failures: string[] = []
  for (const mention of mentions) {
    try {
      const result = await executeTool(
        'github_issue_comment_v2',
        {
          owner: params.owner,
          repo: params.repo,
          issue_number: params.pullNumber,
          body: scrubPiSecrets(mention, secrets),
          apiKey: params.githubToken,
        },
        { signal }
      )
      if (
        result.success &&
        isRecord(result.output) &&
        typeof result.output.id === 'number' &&
        Number.isSafeInteger(result.output.id)
      ) {
        commentIds.add(result.output.id)
      } else {
        failures.push(mention)
      }
    } catch (error) {
      if (signal?.aborted) throw error
      failures.push(mention)
    }
  }
  return { requestedAt, commentIds, posted: commentIds.size, failures }
}

/** Detects later bot activity, excluding the mode's own re-review comments. */
export async function babysitReviewLandedSince(
  params: PullRequestCoordinates,
  requestedAt: string,
  ownCommentIds: ReadonlySet<number>,
  signal?: AbortSignal
): Promise<boolean> {
  const threadResult = await executeTool(
    'github_list_review_threads',
    {
      owner: params.owner,
      repo: params.repo,
      pullNumber: params.pullNumber,
      threadsPerPage: 1,
      commentsPerThread: 1,
      apiKey: params.githubToken,
    },
    { signal }
  )
  if (threadResult.success && isRecord(threadResult.output)) {
    const latest = parseLatestReview(threadResult.output.latestReview)
    if (latest?.authorType === 'Bot' && Date.parse(latest.submittedAt) > Date.parse(requestedAt)) {
      return true
    }
  }

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await executeTool(
      'github_list_issue_comments_v2',
      {
        owner: params.owner,
        repo: params.repo,
        issue_number: params.pullNumber,
        since: requestedAt,
        per_page: 100,
        page,
        apiKey: params.githubToken,
      },
      { signal }
    )
    if (!result.success || !isRecord(result.output) || !Array.isArray(result.output.items)) {
      return false
    }
    for (const item of result.output.items) {
      if (!isRecord(item) || !isRecord(item.user)) continue
      const id = item.id
      const createdAt = item.created_at
      if (
        typeof id === 'number' &&
        !ownCommentIds.has(id) &&
        item.user.type === 'Bot' &&
        typeof createdAt === 'string' &&
        Date.parse(createdAt) > Date.parse(requestedAt)
      ) {
        return true
      }
    }
    if (result.output.items.length < 100) return false
  }
  return false
}
