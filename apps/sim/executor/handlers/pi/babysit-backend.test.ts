/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockWithPiSandbox,
  mockFetchSnapshot,
  mockFetchThreads,
  mockFetchChecks,
  mockFetchDiagnostics,
  mockReplyAndResolve,
  mockRequestReview,
  mockReviewLanded,
  mockResolvePiSandboxLifetime,
  mockSleepUntilAborted,
} = vi.hoisted(() => ({
  mockWithPiSandbox: vi.fn(),
  mockFetchSnapshot: vi.fn(),
  mockFetchThreads: vi.fn(),
  mockFetchChecks: vi.fn(),
  mockFetchDiagnostics: vi.fn(),
  mockReplyAndResolve: vi.fn(),
  mockRequestReview: vi.fn(),
  mockReviewLanded: vi.fn(),
  mockResolvePiSandboxLifetime: vi.fn(),
  mockSleepUntilAborted: vi.fn(),
}))

vi.mock('@/lib/execution/remote-sandbox', () => ({
  withPiSandbox: mockWithPiSandbox,
}))
vi.mock('@/lib/execution/cancellation', () => ({
  isRedisCancellationEnabled: () => false,
  isExecutionCancelled: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/data-drains/destinations/utils', () => ({
  sleepUntilAborted: mockSleepUntilAborted,
}))
vi.mock('@/lib/execution/remote-sandbox/pi-lifetime', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/execution/remote-sandbox/pi-lifetime')>()
  return {
    ...original,
    resolvePiSandboxLifetimeMs: mockResolvePiSandboxLifetime,
  }
})
vi.mock('@/executor/handlers/pi/babysit-github', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/executor/handlers/pi/babysit-github')>()
  return {
    ...original,
    fetchBabysitSnapshot: mockFetchSnapshot,
    fetchBabysitThreads: mockFetchThreads,
    fetchBabysitCheckState: mockFetchChecks,
    fetchBabysitCheckDiagnostics: mockFetchDiagnostics,
    replyAndResolveBabysitThreads: mockReplyAndResolve,
    requestBabysitReview: mockRequestReview,
    babysitReviewLandedSince: mockReviewLanded,
  }
})

import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import {
  resolveBabysitExecutionBudgetMs,
  runBabysitPiWithOptions,
} from '@/executor/handlers/pi/babysit-backend'
import { BABYSIT_ROUND_PATH } from '@/executor/handlers/pi/babysit-round'
import type { PiBabysitContinuationParams } from '@/executor/handlers/pi/backend'
import { DIFF_PATH } from '@/executor/handlers/pi/cloud-shared'

const OLD_SHA = 'a'.repeat(40)
const NEW_SHA = 'c'.repeat(40)
const SECOND_SHA = 'd'.repeat(40)
const snapshot = {
  headSha: OLD_SHA,
  headRef: 'feature',
  headRepoFullName: 'octo/demo',
  baseSha: 'b'.repeat(40),
  baseRef: 'main',
  title: 'PR',
  body: '',
  htmlUrl: 'https://github.com/octo/demo/pull/7',
  state: 'open',
  merged: false,
  mergeable: true,
  mergeConflicted: false,
}
const trustedThread = {
  id: 'thread-1',
  isResolved: false,
  path: 'src/a.ts',
  line: 3,
  commentsTotalCount: 1,
  comments: [
    {
      body: 'Fix it',
      authorAssociation: 'MEMBER',
      authorLogin: 'reviewer',
      authorType: 'User',
    },
  ],
}
const failingCheck = {
  key: 'check:ci',
  name: 'ci',
  type: 'check_run' as const,
  disposition: 'failing' as const,
  required: true,
  status: 'COMPLETED',
  conclusion: 'FAILURE',
  detailsUrl: null,
  databaseId: null,
  title: null,
  summary: null,
}
const failingChecks = {
  checks: [failingCheck],
  failing: [failingCheck],
  pending: [],
  blockingFailing: [failingCheck],
  blockingPending: [],
  checksGreen: false,
  startupFailure: false,
  contextRequirements: new Map([['check:ci', true]]),
}
const greenChecks = {
  ...failingChecks,
  checks: [{ ...failingCheck, disposition: 'passing' as const, conclusion: 'SUCCESS' }],
  failing: [],
  blockingFailing: [],
  checksGreen: true,
}
const noChecksGreen = {
  ...greenChecks,
  checks: [],
  contextRequirements: new Map<string, boolean>(),
}

function params(overrides: Partial<PiBabysitContinuationParams> = {}): PiBabysitContinuationParams {
  return {
    model: 'claude',
    piModel: 'claude',
    providerId: 'anthropic',
    apiKey: 'model-secret',
    isBYOK: true,
    task: '',
    skills: [],
    initialMessages: [],
    owner: 'octo',
    repo: 'demo',
    githubToken: 'github-secret',
    pullNumber: 7,
    maxRounds: 3,
    reviewMentions: ['@review-bot'],
    executionBudgetMs: 40 * 60 * 1000,
    ...overrides,
  }
}

function commandResult(stdout = '', stderr = '', exitCode = 0) {
  return { stdout, stderr, exitCode }
}

function makeRunner(options: {
  cloneResult?: ReturnType<typeof commandResult>
  prepareStdout?: string | string[]
  pushResult?: ReturnType<typeof commandResult>
  roundFile?: string
  diff?: string | string[]
}) {
  const runCalls: Array<{
    command: string
    envs?: Record<string, string>
    timeoutMs?: number
  }> = []
  let prepareCall = 0
  let diffRead = 0
  const runner = {
    run: vi.fn(
      async (
        command: string,
        runOptions: {
          envs?: Record<string, string>
          onStdout?: (chunk: string) => void
          timeoutMs?: number
        }
      ) => {
        runCalls.push({ command, envs: runOptions.envs, timeoutMs: runOptions.timeoutMs })
        if (command.includes('git clone')) {
          return options.cloneResult ?? commandResult('__GIT_CONFIG_DIGEST__=digest-1\n')
        }
        if (command.includes('pi -p --mode json')) {
          runOptions.onStdout?.('{"type":"agent_end"}\n')
          return commandResult()
        }
        if (command.includes('git -c core.hooksPath=/dev/null add -A')) {
          const configuredPrepare = Array.isArray(options.prepareStdout)
            ? (options.prepareStdout[prepareCall++] ?? options.prepareStdout.at(-1))
            : options.prepareStdout
          return commandResult(
            configuredPrepare ??
              `__CUMULATIVE_CHANGED__=src/a.ts\n__CUMULATIVE_DIFF_BYTES__=20\n__CHANGED__=src/a.ts\n__NEW_SHA__=${NEW_SHA}\n__NEEDS_PUSH__=1\n`
          )
        }
        if (command.includes('CURRENT_DIGEST=')) {
          return options.pushResult ?? commandResult('__PUSHED__=1\n')
        }
        return commandResult()
      }
    ),
    writeFile: vi.fn(),
    readFile: vi.fn(async (path: string) => {
      if (path === DIFF_PATH) {
        if (Array.isArray(options.diff)) {
          return options.diff[diffRead++] ?? options.diff.at(-1) ?? ''
        }
        return options.diff ?? 'diff --git a/src/a.ts b/src/a.ts'
      }
      if (path === BABYSIT_ROUND_PATH) {
        return (
          options.roundFile ??
          JSON.stringify({
            threads: [
              { threadId: 'thread-1', classification: 'fixed', reply: 'Fixed in the new commit.' },
            ],
          })
        )
      }
      throw new Error(`Unexpected read ${path}`)
    }),
  }
  return { runner, runCalls }
}

describe('runBabysitPiWithOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWithPiSandbox.mockReset()
    mockFetchSnapshot.mockReset()
    mockFetchThreads.mockReset()
    mockFetchChecks.mockReset()
    mockFetchDiagnostics.mockReset()
    mockReplyAndResolve.mockReset()
    mockRequestReview.mockReset()
    mockReviewLanded.mockReset()
    mockResolvePiSandboxLifetime.mockReturnValue(undefined)
    mockSleepUntilAborted.mockResolvedValue(undefined)
    mockFetchDiagnostics.mockResolvedValue(new Map([['check:ci', 'failure output']]))
    mockReplyAndResolve.mockResolvedValue({
      repliesPosted: 1,
      threadsResolved: 1,
      resolvedThreadIds: ['thread-1'],
      replyFailures: [],
      resolveFailures: [],
      headMoved: false,
      awaitingConfirmation: false,
    })
    mockRequestReview.mockResolvedValue({
      requestedAt: '2026-07-25T12:00:00.000Z',
      commentIds: new Set([10]),
      posted: 1,
      failures: [],
    })
    mockReviewLanded.mockResolvedValue(true)
  })

  it('uses the platform execution budget when the provider has no absolute lifetime', () => {
    expect(resolveBabysitExecutionBudgetMs()).toBe(getMaxExecutionTimeout())
  })

  it('returns budget_exhausted when Create PR leaves less than one minute', async () => {
    const result = await runBabysitPiWithOptions(params({ executionBudgetMs: 30_000 }), {
      onEvent: vi.fn(),
    })

    expect(result).toMatchObject({
      stopReason: 'budget_exhausted',
      rounds: 0,
      commitsPushed: 0,
    })
    expect(mockFetchSnapshot).not.toHaveBeenCalled()
    expect(mockRequestReview).not.toHaveBeenCalled()
    expect(mockWithPiSandbox).not.toHaveBeenCalled()
  })

  it('requests the initial review and waits without consuming a round when the PR starts clean', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [],
      skipped: [],
      totalUnresolved: 0,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    const { runner } = makeRunner({})
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() }, { roundWaitMs: 0 })

    expect(result).toMatchObject({
      rounds: 0,
      threadsClean: true,
      checksGreen: true,
      stopReason: 'clean',
    })
    expect(mockRequestReview).toHaveBeenCalledWith(
      expect.objectContaining({ pullNumber: 7 }),
      ['@review-bot'],
      expect.any(Array),
      expect.any(AbortSignal)
    )
    expect(mockWithPiSandbox).toHaveBeenCalledTimes(1)
    expect(mockReviewLanded).toHaveBeenCalledTimes(1)
  })

  it('preserves known clean flags when the Babysit clone fails after the review request', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [],
      skipped: [],
      totalUnresolved: 0,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    const { runner } = makeRunner({
      cloneResult: commandResult('', 'clone failed', 1),
    })
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() })

    expect(result).toMatchObject({
      stopReason: 'agent_failure',
      threadsClean: true,
      checksGreen: true,
      rounds: 0,
      commitsPushed: 0,
    })
  })

  it('uses remaining time for wait-only polling without reserving an agent round', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [],
      skipped: [],
      totalUnresolved: 0,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    const { runner } = makeRunner({})
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(
      params({ executionBudgetMs: 2 * 60 * 1000 }),
      { onEvent: vi.fn() },
      { roundWaitMs: 30_000 }
    )

    expect(mockReviewLanded).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      stopReason: 'clean',
      threadsClean: true,
      checksGreen: true,
      rounds: 0,
    })
  })

  it('waits for the requested bot review before stopping on skipped threads', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [],
      skipped: [trustedThread],
      totalUnresolved: 1,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    const { runner } = makeRunner({})
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() }, { roundWaitMs: 0 })

    expect(mockReviewLanded).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      stopReason: 'skipped_threads',
      threadsClean: false,
      checksGreen: true,
      rounds: 0,
    })
  })

  it('refuses excess failing checks before fetching discarded diagnostics', async () => {
    const failures = Array.from({ length: 21 }, (_, index) => ({
      ...failingCheck,
      key: `check:ci-${index}`,
      name: `ci-${index}`,
    }))
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [],
      skipped: [],
      totalUnresolved: 0,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue({
      ...failingChecks,
      checks: failures,
      failing: failures,
      blockingFailing: failures,
      contextRequirements: new Map(failures.map((check) => [check.key, true])),
    })
    const { runner, runCalls } = makeRunner({})
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() })

    expect(result).toMatchObject({
      stopReason: 'bounds_exceeded',
      rounds: 0,
      commitsPushed: 0,
    })
    expect(mockFetchDiagnostics).not.toHaveBeenCalled()
    expect(runCalls.some(({ command }) => command.includes('pi -p --mode json'))).toBe(false)
  })

  it('advances the pin after one exact hardened push and resolves the round', async () => {
    mockFetchSnapshot
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, headSha: NEW_SHA })
      .mockResolvedValue({ ...snapshot, headSha: NEW_SHA })
    mockFetchThreads
      .mockResolvedValueOnce({
        actionable: [trustedThread],
        skipped: [],
        totalUnresolved: 1,
        latestReview: null,
      })
      .mockResolvedValueOnce({
        actionable: [],
        skipped: [],
        totalUnresolved: 0,
        latestReview: null,
      })
    mockFetchChecks.mockResolvedValueOnce(failingChecks).mockResolvedValueOnce(greenChecks)

    const runCalls: Array<{
      command: string
      envs?: Record<string, string>
      timeoutMs?: number
    }> = []
    const runner = {
      run: vi.fn(
        async (
          command: string,
          options: {
            envs?: Record<string, string>
            onStdout?: (chunk: string) => void
            timeoutMs?: number
          }
        ) => {
          runCalls.push({ command, envs: options.envs, timeoutMs: options.timeoutMs })
          if (command.includes('git clone')) {
            return commandResult('__GIT_CONFIG_DIGEST__=digest-1\n')
          }
          if (command.includes('pi -p --mode json')) {
            options.onStdout?.('{"type":"agent_end"}\n')
            return commandResult()
          }
          if (command.includes('git -c core.hooksPath=/dev/null add -A')) {
            return commandResult(
              `__CUMULATIVE_CHANGED__=src/a.ts\n__CUMULATIVE_DIFF_BYTES__=20\n__CHANGED__=src/a.ts\n__NEW_SHA__=${NEW_SHA}\n__NEEDS_PUSH__=1\n`
            )
          }
          if (command.includes('CURRENT_DIGEST=')) return commandResult('__PUSHED__=1\n')
          return commandResult()
        }
      ),
      writeFile: vi.fn(),
      readFile: vi.fn(async (path: string) => {
        if (path === DIFF_PATH) return 'diff --git a/src/a.ts b/src/a.ts'
        if (path === BABYSIT_ROUND_PATH) {
          return JSON.stringify({
            threads: [
              { threadId: 'thread-1', classification: 'fixed', reply: 'Fixed in the new commit.' },
            ],
          })
        }
        throw new Error(`Unexpected read ${path}`)
      }),
    }
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(
      params(),
      { onEvent: vi.fn() },
      { convergenceWaitMs: 0, roundWaitMs: 0 }
    )

    expect(result).toMatchObject({
      rounds: 1,
      commitsPushed: 1,
      threadsResolved: 1,
      threadsClean: true,
      checksGreen: true,
      stopReason: 'clean',
    })
    const piCall = runCalls.find(({ command }) => command.includes('pi -p --mode json'))
    expect(piCall?.command).toContain(
      '--no-extensions --no-prompt-templates --no-skills --no-approve'
    )
    expect(piCall?.timeoutMs).toBeGreaterThan(19 * 60 * 1000)
    expect(piCall?.timeoutMs).toBeLessThanOrEqual(20 * 60 * 1000)
    expect(piCall?.envs).not.toHaveProperty('GITHUB_TOKEN')
    const pushCall = runCalls.find(({ command }) => command.includes('CURRENT_DIGEST='))
    expect(pushCall?.command.indexOf('CURRENT_DIGEST=')).toBeLessThan(
      pushCall?.command.indexOf('/usr/bin/git') ?? 0
    )
    expect(pushCall?.command).toContain('HEAD:refs/heads/$HEAD_REF')
    expect(pushCall?.envs).toMatchObject({
      GITHUB_TOKEN: 'github-secret',
      ORIGINAL_GIT_CONFIG_DIGEST: 'digest-1',
      PINNED_SHA: OLD_SHA,
    })
  })

  it('aggregates pushed rounds while enforcing cumulative markers', async () => {
    mockFetchSnapshot
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, headSha: NEW_SHA })
      .mockResolvedValueOnce({ ...snapshot, headSha: NEW_SHA })
      .mockResolvedValueOnce({ ...snapshot, headSha: NEW_SHA })
      .mockResolvedValueOnce({ ...snapshot, headSha: NEW_SHA })
      .mockResolvedValueOnce({ ...snapshot, headSha: SECOND_SHA })
      .mockResolvedValueOnce({ ...snapshot, headSha: SECOND_SHA })
      .mockResolvedValueOnce({ ...snapshot, headSha: SECOND_SHA })
    mockFetchThreads.mockResolvedValue({
      actionable: [],
      skipped: [],
      totalUnresolved: 0,
      latestReview: null,
    })
    mockFetchChecks
      .mockResolvedValueOnce(failingChecks)
      .mockResolvedValueOnce(failingChecks)
      .mockResolvedValueOnce(greenChecks)
    mockReplyAndResolve.mockResolvedValue({
      repliesPosted: 0,
      threadsResolved: 0,
      replyFailures: [],
      resolveFailures: [],
      headMoved: false,
      awaitingConfirmation: false,
    })
    mockRequestReview
      .mockResolvedValueOnce({
        requestedAt: '2026-07-25T12:00:00.000Z',
        commentIds: new Set([11]),
        posted: 1,
        failures: [],
      })
      .mockResolvedValueOnce({
        requestedAt: '2026-07-25T12:05:00.000Z',
        commentIds: new Set(),
        posted: 0,
        failures: ['@review-bot'],
      })
    mockReviewLanded.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { runner, runCalls } = makeRunner({
      prepareStdout: [
        `__CUMULATIVE_CHANGED__=src/a.ts\n__CUMULATIVE_DIFF_BYTES__=20\n__CHANGED__=src/a.ts\n__NEW_SHA__=${NEW_SHA}\n__NEEDS_PUSH__=1\n`,
        `__CUMULATIVE_CHANGED__=src/a.ts\n__CUMULATIVE_CHANGED__=src/b.ts\n__CUMULATIVE_DIFF_BYTES__=40\n__CHANGED__=src/b.ts\n__NEW_SHA__=${SECOND_SHA}\n__NEEDS_PUSH__=1\n`,
      ],
      roundFile: JSON.stringify({ threads: [] }),
      diff: ['round-one-diff', 'round-two-diff'],
    })
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(
      params({ reviewMentions: ['@review-bot'] }),
      { onEvent: vi.fn() },
      { convergenceWaitMs: 0, roundWaitMs: 0 }
    )

    expect(result).toMatchObject({
      stopReason: 'clean',
      rounds: 2,
      commitsPushed: 2,
      changedFiles: ['src/a.ts', 'src/b.ts'],
      diff: 'round-one-diff\nround-two-diff',
    })
    expect(
      runCalls
        .filter(({ command }) => command.includes('CURRENT_DIGEST='))
        .map(({ envs }) => envs?.PINNED_SHA)
    ).toEqual([OLD_SHA, NEW_SHA])
    expect(mockRequestReview).toHaveBeenCalledTimes(3)
    expect(mockReviewLanded).toHaveBeenCalledTimes(2)
  })

  it('refuses .github changes before the credentialed push', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [trustedThread],
      skipped: [],
      totalUnresolved: 1,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    const { runner, runCalls } = makeRunner({
      prepareStdout: `__CUMULATIVE_CHANGED__=.github/workflows/ci.yml\n__CUMULATIVE_DIFF_BYTES__=20\n__CHANGED__=.github/workflows/ci.yml\n__NEW_SHA__=${NEW_SHA}\n__NEEDS_PUSH__=1\n`,
    })
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() })

    expect(result).toMatchObject({
      stopReason: 'refused_content',
      rounds: 1,
      commitsPushed: 0,
      threadsClean: false,
      checksGreen: true,
    })
    expect(runCalls.some(({ command }) => command.includes('CURRENT_DIGEST='))).toBe(false)
  })

  // The prepare script pins `core.quotePath=false`, so a non-ASCII path arrives verbatim
  // rather than as git's default `".github/workflows/\303\251vil.yml"` rendering — which
  // begins with a quote character and so matched neither `.github` nor `.github/`.
  it('refuses a .github path that git would otherwise C-quote', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [trustedThread],
      skipped: [],
      totalUnresolved: 1,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    const unicodePath = '.github/workflows/évil.yml'
    const { runner, runCalls } = makeRunner({
      prepareStdout: `__CUMULATIVE_CHANGED__=${unicodePath}\n__CUMULATIVE_DIFF_BYTES__=20\n__CHANGED__=${unicodePath}\n__NEW_SHA__=${NEW_SHA}\n__NEEDS_PUSH__=1\n`,
    })
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() })

    expect(result).toMatchObject({ stopReason: 'refused_content', commitsPushed: 0 })
    expect(runCalls.some(({ command }) => command.includes('CURRENT_DIGEST='))).toBe(false)
    const prepare = runCalls.find(({ command }) => command.includes('__CUMULATIVE_CHANGED__'))
    expect(prepare?.command).toContain('core.quotePath=false')
  })

  // `core.quotePath=false` stops the non-ASCII escaping but Git still quotes a path
  // containing a newline, quote, backslash, or tab — which arrives with a leading `"`
  // and so slips past a `.github/` prefix test. Any quoted path is refused outright.
  it.each([
    ['newline', '".github/workflows/new\\nline.yml"'],
    ['double quote', '".github/quo\\"te.yml"'],
    ['backslash', '".github/back\\\\slash.yml"'],
    ['tab', '".github/tab\\tx.yml"'],
  ])('refuses a %s path that Git could not report literally', async (_label, quotedPath) => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [trustedThread],
      skipped: [],
      totalUnresolved: 1,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    const { runner, runCalls } = makeRunner({
      prepareStdout: `__CUMULATIVE_CHANGED__=${quotedPath}\n__CUMULATIVE_DIFF_BYTES__=20\n__CHANGED__=${quotedPath}\n__NEW_SHA__=${NEW_SHA}\n__NEEDS_PUSH__=1\n`,
    })
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() })

    expect(result).toMatchObject({ stopReason: 'refused_content', commitsPushed: 0 })
    expect(runCalls.some(({ command }) => command.includes('CURRENT_DIGEST='))).toBe(false)
  })

  it('reports a hardened push rejection without losing partial counters', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [trustedThread],
      skipped: [],
      totalUnresolved: 1,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    const { runner } = makeRunner({
      pushResult: commandResult('', 'rejected by remote', 1),
    })
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() })

    expect(result).toMatchObject({
      stopReason: 'push_rejected',
      rounds: 1,
      commitsPushed: 0,
      threadsResolved: 0,
      threadsClean: false,
      checksGreen: true,
    })
  })

  it('reports missing finalize protocol markers as an agent failure', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [trustedThread],
      skipped: [],
      totalUnresolved: 1,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    const { runner, runCalls } = makeRunner({
      prepareStdout: '__NEEDS_PUSH__=1\n',
    })
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() })

    expect(result).toMatchObject({
      stopReason: 'agent_failure',
      rounds: 1,
      commitsPushed: 0,
    })
    expect(runCalls.some(({ command }) => command.includes('CURRENT_DIGEST='))).toBe(false)
  })

  it('stops on head movement at the pre-push phase boundary', async () => {
    mockFetchSnapshot
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, headSha: 'd'.repeat(40) })
    mockFetchThreads.mockResolvedValue({
      actionable: [trustedThread],
      skipped: [],
      totalUnresolved: 1,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    const { runner, runCalls } = makeRunner({})
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() })

    expect(result).toMatchObject({
      stopReason: 'head_moved',
      rounds: 1,
      commitsPushed: 0,
    })
    expect(runCalls.some(({ command }) => command.includes('CURRENT_DIGEST='))).toBe(false)
  })

  it('waits for pending required checks despite optional failures without consuming a round', async () => {
    const pendingCheck = {
      ...failingCheck,
      disposition: 'pending' as const,
      status: 'IN_PROGRESS',
      conclusion: null,
    }
    const optionalFailure = {
      ...failingCheck,
      key: 'check:optional-lint',
      name: 'optional-lint',
      required: false,
    }
    const pendingChecks = {
      ...failingChecks,
      checks: [pendingCheck, optionalFailure],
      failing: [optionalFailure],
      pending: [pendingCheck],
      blockingFailing: [],
      blockingPending: [pendingCheck],
    }
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [],
      skipped: [],
      totalUnresolved: 0,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValueOnce(pendingChecks).mockResolvedValueOnce(greenChecks)
    const { runner, runCalls } = makeRunner({})
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(
      params({ maxRounds: 1 }),
      { onEvent: vi.fn() },
      { roundWaitMs: 1 }
    )

    expect(result).toMatchObject({ stopReason: 'clean', rounds: 0, checksGreen: true })
    expect(runCalls.some(({ command }) => command.includes('pi -p --mode json'))).toBe(false)
    expect(mockSleepUntilAborted).toHaveBeenCalledWith(1, expect.any(AbortSignal))
    expect(runCalls.some(({ command }) => command === 'true')).toBe(true)
  })

  it('returns pushed_awaiting_confirmation after replying against a lagging GitHub record', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [trustedThread],
      skipped: [],
      totalUnresolved: 1,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(failingChecks)
    mockReplyAndResolve.mockResolvedValue({
      repliesPosted: 1,
      threadsResolved: 0,
      replyFailures: [],
      resolveFailures: [],
      headMoved: false,
      awaitingConfirmation: true,
    })
    const { runner } = makeRunner({})
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(
      params(),
      { onEvent: vi.fn() },
      { convergenceAttempts: 1, convergenceWaitMs: 0 }
    )

    expect(result).toMatchObject({
      stopReason: 'pushed_awaiting_confirmation',
      rounds: 1,
      commitsPushed: 1,
      threadsResolved: 0,
    })
    expect(mockReplyAndResolve.mock.calls[0][4]).toBe(OLD_SHA)
  })

  it('preserves known clean flags when the pin moves after successful writes', async () => {
    mockFetchSnapshot
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, headSha: NEW_SHA })
      .mockResolvedValueOnce({ ...snapshot, headSha: SECOND_SHA })
    mockFetchThreads.mockResolvedValue({
      actionable: [trustedThread],
      skipped: [],
      totalUnresolved: 1,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(noChecksGreen)
    const { runner } = makeRunner({})
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(
      params({ reviewMentions: ['@review-bot'] }),
      { onEvent: vi.fn() },
      { convergenceWaitMs: 0, roundWaitMs: 0 }
    )

    expect(result).toMatchObject({
      stopReason: 'head_moved',
      rounds: 1,
      commitsPushed: 1,
      threadsResolved: 1,
      threadsClean: true,
      checksGreen: true,
    })
  })

  it('reports a confirmed push when the convergence read fails transiently', async () => {
    mockFetchSnapshot
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValueOnce(new Error('temporary GitHub read failure'))
    mockFetchThreads.mockResolvedValue({
      actionable: [trustedThread],
      skipped: [],
      totalUnresolved: 1,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(noChecksGreen)
    const { runner } = makeRunner({})
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(
      params(),
      { onEvent: vi.fn() },
      { convergenceAttempts: 1, convergenceWaitMs: 0, roundWaitMs: 0 }
    )

    expect(result).toMatchObject({
      stopReason: 'pushed_awaiting_confirmation',
      rounds: 1,
      commitsPushed: 1,
      threadsResolved: 0,
      checksGreen: true,
    })
    expect(result.totals.finalText).toContain('temporary GitHub read failure')
  })

  it('marks required checks non-green when a pushed round file is invalid', async () => {
    mockFetchSnapshot
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValue({ ...snapshot, headSha: NEW_SHA })
    mockFetchThreads.mockResolvedValue({
      actionable: [trustedThread],
      skipped: [],
      totalUnresolved: 1,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    const { runner } = makeRunner({ roundFile: 'not json' })
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(
      params(),
      { onEvent: vi.fn() },
      { convergenceWaitMs: 0, roundWaitMs: 0 }
    )

    expect(result).toMatchObject({
      stopReason: 'agent_failure',
      rounds: 1,
      commitsPushed: 1,
      checksGreen: false,
    })
  })

  it('returns startup_failure without a sandbox when every initial review request fails', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [],
      skipped: [],
      totalUnresolved: 0,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    mockRequestReview.mockResolvedValue({
      requestedAt: '2026-07-25T12:00:00.000Z',
      commentIds: new Set(),
      posted: 0,
      failures: ['@review-bot'],
    })

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() })

    expect(result).toMatchObject({ stopReason: 'startup_failure', rounds: 0, commitsPushed: 0 })
    expect(result.totals.finalText).toContain('1 initial review requests failed.')
    expect(mockWithPiSandbox).not.toHaveBeenCalled()
    expect(mockReviewLanded).not.toHaveBeenCalled()
  })

  it('continues when at least one initial review request succeeds', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [],
      skipped: [],
      totalUnresolved: 0,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    mockRequestReview.mockResolvedValue({
      requestedAt: '2026-07-25T12:00:00.000Z',
      commentIds: new Set([10]),
      posted: 1,
      failures: ['@missing-bot'],
    })
    const { runner } = makeRunner({})
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(
      params({ reviewMentions: ['@review-bot', '@missing-bot'] }),
      { onEvent: vi.fn() },
      { roundWaitMs: 0 }
    )

    expect(result).toMatchObject({ stopReason: 'clean', rounds: 0 })
    expect(result.totals.finalText).toContain('1 initial review requests failed.')
    expect(mockWithPiSandbox).toHaveBeenCalledTimes(1)
  })

  it('detects stuck threads only after two refreshed unchanged rounds', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [trustedThread],
      skipped: [],
      totalUnresolved: 1,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    mockReplyAndResolve.mockResolvedValue({
      repliesPosted: 1,
      threadsResolved: 0,
      replyFailures: [],
      resolveFailures: ['thread-1'],
      headMoved: false,
      awaitingConfirmation: false,
    })
    const { runner } = makeRunner({
      prepareStdout: '__NO_CHANGES__=1\n',
      roundFile: JSON.stringify({
        threads: [
          {
            threadId: 'thread-1',
            classification: 'already_addressed',
            reply: 'This is already addressed.',
          },
        ],
      }),
    })
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() }, { roundWaitMs: 0 })

    expect(result).toMatchObject({
      stopReason: 'stuck_threads',
      rounds: 2,
      commitsPushed: 0,
      threadsResolved: 0,
      threadsClean: false,
      checksGreen: true,
    })
    expect(mockFetchThreads).toHaveBeenCalledTimes(3)
  })

  it('preserves clean threads when checks are stuck', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [],
      skipped: [],
      totalUnresolved: 0,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(failingChecks)
    mockReplyAndResolve.mockResolvedValue({
      repliesPosted: 0,
      threadsResolved: 0,
      replyFailures: [],
      resolveFailures: [],
      headMoved: false,
      awaitingConfirmation: false,
    })
    const { runner } = makeRunner({
      prepareStdout: '__NO_CHANGES__=1\n',
      roundFile: JSON.stringify({ threads: [] }),
    })
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() }, { roundWaitMs: 0 })

    expect(result).toMatchObject({
      stopReason: 'stuck_checks',
      rounds: 2,
      commitsPushed: 0,
      threadsClean: true,
      checksGreen: false,
    })
  })

  it('does not count a push round toward unchanged-pin stuck detection', async () => {
    mockFetchSnapshot
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValue({ ...snapshot, headSha: NEW_SHA })
    mockFetchThreads.mockResolvedValue({
      actionable: [trustedThread],
      skipped: [],
      totalUnresolved: 1,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    mockReplyAndResolve.mockResolvedValue({
      repliesPosted: 1,
      threadsResolved: 0,
      replyFailures: [],
      resolveFailures: ['thread-1'],
      headMoved: false,
      awaitingConfirmation: false,
    })
    const { runner } = makeRunner({
      prepareStdout: [
        `__CUMULATIVE_CHANGED__=src/a.ts\n__CUMULATIVE_DIFF_BYTES__=20\n__CHANGED__=src/a.ts\n__NEW_SHA__=${NEW_SHA}\n__NEEDS_PUSH__=1\n`,
        '__NO_CHANGES__=1\n',
        '__NO_CHANGES__=1\n',
      ],
      roundFile: JSON.stringify({
        threads: [
          {
            threadId: 'thread-1',
            classification: 'already_addressed',
            reply: 'This is already addressed.',
          },
        ],
      }),
    })
    mockWithPiSandbox.mockImplementation(async (callback) => callback(runner))

    const result = await runBabysitPiWithOptions(
      params(),
      { onEvent: vi.fn() },
      { convergenceWaitMs: 0, roundWaitMs: 0 }
    )

    expect(result).toMatchObject({
      stopReason: 'stuck_threads',
      rounds: 3,
      commitsPushed: 1,
      threadsResolved: 0,
    })
    expect(mockFetchThreads).toHaveBeenCalledTimes(4)
  })

  it('propagates cancellation instead of returning a success-shaped report', async () => {
    const controller = new AbortController()
    controller.abort('user cancelled')

    await expect(
      runBabysitPiWithOptions(params(), {
        onEvent: vi.fn(),
        signal: controller.signal,
      })
    ).rejects.toThrow(/aborted|cancelled/i)
    expect(mockWithPiSandbox).not.toHaveBeenCalled()
  })
})
