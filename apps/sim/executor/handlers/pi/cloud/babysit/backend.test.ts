import { resetEnvMock, setEnv } from '@sim/testing'
import { remoteSandboxMock, remoteSandboxMockFns } from '@sim/testing/mocks/remote-sandbox.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
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

vi.mock('@/lib/execution/remote-sandbox', () => remoteSandboxMock)
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
vi.mock('@/executor/handlers/pi/cloud/babysit/github', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/executor/handlers/pi/cloud/babysit/github')>()
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
import { runBabysitPiWithOptions } from '@/executor/handlers/pi/cloud/babysit/backend'
import { BABYSIT_ROUND_PATH } from '@/executor/handlers/pi/cloud/babysit/round'
import { DIFF_PATH } from '@/executor/handlers/pi/cloud/shared'
import type { PiBabysitContinuationParams } from '@/executor/handlers/pi/core/backend'

const { mockWithPiSandbox } = remoteSandboxMockFns

afterAll(resetEnvMock)

const OLD_SHA = 'a'.repeat(40)
const NEW_SHA = 'c'.repeat(40)
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
    setEnv({ SANDBOX_PROVIDER: 'e2b' })
    mockWithPiSandbox.mockReset()
    mockFetchSnapshot.mockReset()
    mockFetchThreads.mockReset()
    mockFetchChecks.mockReset()
    mockFetchDiagnostics.mockReset()
    mockReplyAndResolve.mockReset()
    mockRequestReview.mockReset()
    mockReviewLanded.mockReset()
    mockResolvePiSandboxLifetime.mockReturnValue(getMaxExecutionTimeout())
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
    mockWithPiSandbox.mockImplementation(async (_options, callback) => callback(runner))

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
      expect.any(AbortSignal)
    )
    expect(mockWithPiSandbox).toHaveBeenCalledTimes(1)
    expect(mockReviewLanded).toHaveBeenCalledTimes(1)
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
    mockWithPiSandbox.mockImplementation(async (_options, callback) => callback(runner))

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
    mockWithPiSandbox.mockImplementation(async (_options, callback) => callback(runner))

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
    // The refspec names the validated SHA, not HEAD. Asserting only HEAD's shape
    // left every host-side check describing a commit other than the pushed one,
    // because `commit --amend` preserves branch, count, and ancestry.
    expect(pushCall?.command).toContain('"$NEW_SHA:refs/heads/$HEAD_REF"')
    expect(pushCall?.command).toContain('test "$(/usr/bin/git rev-parse HEAD)" = "$NEW_SHA"')
    expect(pushCall?.envs).toMatchObject({
      GITHUB_TOKEN: 'github-secret',
      ORIGINAL_GIT_CONFIG_DIGEST: 'digest-1',
      PINNED_SHA: OLD_SHA,
      NEW_SHA,
      GIT_NO_REPLACE_OBJECTS: '1',
    })
  })

  // A one-line `.git/info/attributes` saying `* -diff` made a 500 KB change report
  // ~119 bytes to the cumulative bound and wrote "Binary files differ" into the diff
  // the user reviews. `.git/` is never committed, so the config digest does not see it.
  it('measures diffs immune to repository-supplied attributes', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshot)
    mockFetchThreads.mockResolvedValue({
      actionable: [trustedThread],
      skipped: [],
      totalUnresolved: 1,
      latestReview: null,
    })
    mockFetchChecks.mockResolvedValue(greenChecks)
    const { runner, runCalls } = makeRunner({})
    mockWithPiSandbox.mockImplementation(async (_options, callback) => callback(runner))

    await runBabysitPiWithOptions(params(), { onEvent: vi.fn() })

    const prepare = runCalls.find(({ command }) => command.includes('__CUMULATIVE_CHANGED__'))
    expect(prepare?.command).toContain('core.attributesFile=/dev/null')
    expect(prepare?.command).toContain('--text --no-ext-diff --no-textconv')
    expect(prepare?.envs).toMatchObject({ GIT_NO_REPLACE_OBJECTS: '1' })
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
    mockWithPiSandbox.mockImplementation(async (_options, callback) => callback(runner))

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
    mockWithPiSandbox.mockImplementation(async (_options, callback) => callback(runner))

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() })

    expect(result).toMatchObject({ stopReason: 'refused_content', commitsPushed: 0 })
    expect(runCalls.some(({ command }) => command.includes('CURRENT_DIGEST='))).toBe(false)
    const prepare = runCalls.find(({ command }) => command.includes('__CUMULATIVE_CHANGED__'))
    expect(prepare?.command).toContain('core.quotePath=false')
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
    mockWithPiSandbox.mockImplementation(async (_options, callback) => callback(runner))

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
    mockWithPiSandbox.mockImplementation(async (_options, callback) => callback(runner))

    const result = await runBabysitPiWithOptions(params(), { onEvent: vi.fn() })

    expect(result).toMatchObject({
      stopReason: 'head_moved',
      rounds: 1,
      commitsPushed: 0,
    })
    expect(runCalls.some(({ command }) => command.includes('CURRENT_DIGEST='))).toBe(false)
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
    mockWithPiSandbox.mockImplementation(async (_options, callback) => callback(runner))

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
    mockWithPiSandbox.mockImplementation(async (_options, callback) => callback(runner))

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
