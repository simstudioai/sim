/**
 * Cloud authoring backend: runs the Pi CLI inside an E2B sandbox against a
 * cloned GitHub repo, then either opens a PR from a new branch or updates an
 * existing branch. Secrets are isolated per command (S2/KTD10): the GitHub token
 * is present only for the clone and push commands (and stripped from the cloned
 * remote), while the Pi loop runs with a BYOK model key only. The model key is
 * never a Sim-owned hosted key (S1).
 *
 * Untrusted text (the assembled prompt, which folds in workspace-shared skills
 * and memory, and the commit message) is never placed on a shell command line.
 * It is written into sandbox files via the E2B filesystem API and read back from
 * fixed paths (Pi's prompt on stdin, `git commit -F <file>`), so a collaborator-
 * authored skill cannot inject shell into the Pi step where the model key lives.
 *
 * Optional web search adds a second sandbox credential, delivered the same way as
 * the model key, plus a runtime-written Pi extension that performs the provider
 * call. Every text this backend surfaces — events, totals, prompt, commit title,
 * PR body, diff, changed files, thrown errors — is scrubbed against all three
 * credentials.
 */

import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { getMaxExecutionTimeout, getRemainingExecutionMs } from '@/lib/core/execution-limits'
import { withPiSandbox } from '@/lib/execution/remote-sandbox'
import {
  resolvePiRunLifetimeMs,
  resolvePiSandboxLifetimeMs,
} from '@/lib/execution/remote-sandbox/pi-lifetime'
import { runBabysitPi } from '@/executor/handlers/pi/babysit-backend'
import type {
  PiBackendRun,
  PiCloudBranchRunParams,
  PiCloudRunParams,
  PiRunContext,
  PiRunResult,
} from '@/executor/handlers/pi/backend'
import {
  buildPiScript,
  CLONE_TIMEOUT_MS,
  COMMIT_MSG_PATH,
  DIFF_PATH,
  extractMarkerValues,
  FINALIZE_TIMEOUT_MS,
  GIT_CONFIG_DIGEST_LINE,
  MAX_DIFF_BYTES,
  PREPARE_SCRIPT,
  PROMPT_PATH,
  PUSH_ERR_PATH,
  PUSH_ERROR_MAX,
  PUSH_SCRIPT,
  REPO_DIR,
  raceAbort,
  resolvePiTimeoutMs,
  scrubGitSecrets,
} from '@/executor/handlers/pi/cloud-shared'
import { buildPiPrompt } from '@/executor/handlers/pi/context'
import {
  applyPiEvent,
  createPiTotals,
  type PiRunTotals,
  parseJsonLine,
} from '@/executor/handlers/pi/events'
import {
  type BranchPullRequest,
  fetchOpenPrForBranch,
  findOpenPrForBranch,
  setPullRequestDraftState,
} from '@/executor/handlers/pi/github-pr'
import { mapThinkingLevel, providerApiKeyEnvVar } from '@/executor/handlers/pi/keys'
import {
  createScrubbedPiError,
  scrubPiEvent,
  scrubPiSecrets,
} from '@/executor/handlers/pi/redaction'
import {
  PI_SEARCH_API_KEY_ENV_VAR,
  PI_SEARCH_EXTENSION_PATH,
  PI_SEARCH_EXTENSION_SOURCE,
  PI_SEARCH_PROVIDER_ENV_VAR,
} from '@/executor/handlers/pi/search/extension-source'
import { getPiProviderId } from '@/providers/pi-providers'
import { executeTool } from '@/tools'
import { isRecord, requiredRecord, requiredTrimmedString } from '@/tools/github/response-parsers'

const logger = createLogger('PiCloudBackend')

const COMMIT_TITLE_MAX = 72
const PR_SUMMARY_MAX = 2000

interface OpenedPullRequest {
  url?: string
  number?: number
}

interface AuthoringPhaseResult extends PiRunResult {
  pullNumber?: number
}

/**
 * Keeps git authentication out of the agent loop by reserving commit, push, and
 * PR creation for Sim's credential-scoped finalization step.
 */
const CLOUD_GUIDANCE_PREFIX =
  'You are running inside an automated sandbox. Make only the file changes needed to complete the task. ' +
  'Do not run git commands (commit, push, branch, remote), do not configure git credentials or authenticate ' +
  'with GitHub, and do not open a pull request — after you finish, Sim automatically commits your changes and '
const CLOUD_GUIDANCE_SUFFIX =
  "The project's package manager and test tooling may not be " +
  'installed, so do not block on running the full build or test suite; focus on correct, minimal edits.'

const CREATE_PR_CLONE_SCRIPT = `set -e
rm -rf ${REPO_DIR}
git clone "https://x-access-token:$GITHUB_TOKEN@github.com/$REPO_OWNER/$REPO_NAME.git" ${REPO_DIR}
cd ${REPO_DIR}
if [ -n "$BASE_BRANCH" ]; then git checkout "$BASE_BRANCH"; fi
git rev-parse HEAD | sed "s/^/__BASE_SHA__=/"
DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed "s#^origin/##" || true)
echo "__DEFAULT_BRANCH__=$DEFAULT_BRANCH"
git checkout -b "$BRANCH"
git remote set-url origin "https://github.com/$REPO_OWNER/$REPO_NAME.git"
${GIT_CONFIG_DIGEST_LINE}`

const UPDATE_BRANCH_CLONE_SCRIPT = `set -e
rm -rf ${REPO_DIR}
git check-ref-format "refs/heads/$BRANCH" >/dev/null
git clone --no-tags --single-branch --branch "$BRANCH" "https://x-access-token:$GITHUB_TOKEN@github.com/$REPO_OWNER/$REPO_NAME.git" ${REPO_DIR}
cd ${REPO_DIR}
CURRENT_BRANCH=$(git symbolic-ref --quiet --short HEAD || true)
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  echo "Target $BRANCH is not an existing branch" >&2
  exit 1
fi
git rev-parse HEAD | sed "s/^/__BASE_SHA__=/"
git remote set-url origin "https://github.com/$REPO_OWNER/$REPO_NAME.git"
${GIT_CONFIG_DIGEST_LINE}`

function buildPrBody(task: string, finalText: string): string {
  const summary = finalText.trim()
    ? truncate(finalText.trim(), PR_SUMMARY_MAX)
    : 'Automated changes by the Pi Coding Agent.'
  return `## Task\n\n${task}\n\n## Summary\n\n${summary}`
}

type PiCloudAuthoringRunParams = PiCloudRunParams | PiCloudBranchRunParams

/** The commit message and PR title share one default, derived from the PR title or task. */
function defaultTitle(params: PiCloudAuthoringRunParams): string {
  return params.prTitle?.trim() || truncate(`Pi: ${params.task}`, COMMIT_TITLE_MAX)
}

function guidanceFor(params: PiCloudAuthoringRunParams): string {
  const finalization =
    params.mode === 'cloud'
      ? 'pushes the branch, and opens the pull request. '
      : 'pushes them back to the configured branch without force-pushing, then creates or updates its pull request. '
  return `${CLOUD_GUIDANCE_PREFIX}${finalization}${CLOUD_GUIDANCE_SUFFIX}`
}

async function openPullRequest(
  params: PiCloudAuthoringRunParams,
  branch: string,
  base: string,
  draft: boolean,
  totals: PiRunTotals,
  secrets: readonly string[],
  signal?: AbortSignal
): Promise<OpenedPullRequest> {
  const title = scrubPiSecrets(defaultTitle(params), secrets)
  const body = scrubPiSecrets(
    params.prBody?.trim() || buildPrBody(params.task, totals.finalText),
    secrets
  )

  const result = await executeTool(
    'github_create_pr',
    {
      owner: params.owner,
      repo: params.repo,
      title,
      head: branch,
      base,
      body,
      draft,
      apiKey: params.githubToken,
    },
    { signal }
  )

  if (!result.success) {
    throw new Error(`PR creation failed for branch ${branch}: ${result.error ?? 'unknown error'}`)
  }

  if (!isRecord(result.output)) {
    throw new Error(`PR creation returned an invalid response for branch ${branch}`)
  }
  const metadata = requiredRecord(result.output, 'metadata', 'GitHub create pull request response')
  const rawNumber = metadata.number
  const number =
    typeof rawNumber === 'number' && Number.isSafeInteger(rawNumber) && rawNumber > 0
      ? rawNumber
      : undefined
  return {
    url: requiredTrimmedString(
      metadata,
      'html_url',
      'GitHub create pull request response.metadata'
    ),
    ...(number ? { number } : {}),
  }
}

async function repositoryDefaultBranch(
  params: PiCloudAuthoringRunParams,
  signal?: AbortSignal
): Promise<string> {
  const result = await executeTool(
    'github_repo_info_v2',
    {
      owner: params.owner,
      repo: params.repo,
      apiKey: params.githubToken,
    },
    { signal }
  )
  if (!result.success) {
    throw new Error(
      `Failed to determine the repository default branch: ${result.error ?? 'unknown error'}`
    )
  }
  if (!isRecord(result.output)) {
    throw new Error('GitHub repository response must be an object')
  }
  return requiredTrimmedString(result.output, 'default_branch', 'GitHub repository response')
}

async function updatePullRequest(
  params: PiCloudBranchRunParams,
  pullRequest: BranchPullRequest,
  secrets: readonly string[],
  signal?: AbortSignal
): Promise<OpenedPullRequest> {
  const verified = await fetchOpenPrForBranch(
    {
      owner: params.owner,
      repo: params.repo,
      pullNumber: pullRequest.pullNumber,
      branch: params.targetBranch,
      githubToken: params.githubToken,
    },
    signal
  )
  const title = params.prTitle?.trim() ? scrubPiSecrets(params.prTitle.trim(), secrets) : undefined
  const body = params.prBody?.trim() ? scrubPiSecrets(params.prBody.trim(), secrets) : undefined
  const base = params.baseBranch?.trim()
  if (title || body || base) {
    const result = await executeTool(
      'github_update_pr',
      {
        owner: params.owner,
        repo: params.repo,
        pullNumber: pullRequest.pullNumber,
        ...(title ? { title } : {}),
        ...(body ? { body } : {}),
        ...(base ? { base } : {}),
        apiKey: params.githubToken,
      },
      { signal }
    )
    if (!result.success) {
      throw new Error(
        `PR update failed for branch ${params.targetBranch}: ${result.error ?? 'unknown error'}`
      )
    }
  }

  const requestedState = params.babysit ? 'ready' : params.prState
  if (requestedState !== 'preserve') {
    await setPullRequestDraftState(
      {
        owner: params.owner,
        repo: params.repo,
        pullNumber: pullRequest.pullNumber,
        githubToken: params.githubToken,
        state: requestedState,
      },
      signal
    )
  }
  return { number: pullRequest.pullNumber, url: verified.snapshot.htmlUrl }
}

async function ensureUpdatePullRequest(
  params: PiCloudBranchRunParams,
  branch: string,
  totals: PiRunTotals,
  secrets: readonly string[],
  signal?: AbortSignal
): Promise<OpenedPullRequest> {
  const currentPullRequest = await findOpenPrForBranch(
    {
      owner: params.owner,
      repo: params.repo,
      branch,
      githubToken: params.githubToken,
    },
    signal
  )
  if (currentPullRequest) {
    return updatePullRequest(params, currentPullRequest, secrets, signal)
  }
  const base = params.baseBranch?.trim() || (await repositoryDefaultBranch(params, signal))
  const draft = params.babysit ? false : params.prState !== 'ready'
  return openPullRequest(params, branch, base, draft, totals, secrets, signal)
}

function mergeChangedFiles(
  createFiles: readonly string[] | undefined,
  babysitFiles: readonly string[] | undefined
): string[] {
  return [...new Set([...(createFiles ?? []), ...(babysitFiles ?? [])])]
}

/**
 * Joins both phases' diffs under the same ceiling each already respects
 * individually — without the re-cap, two 200 KB diffs produced a 400 KB output.
 */
function mergePhaseDiffs(createDiff: string | undefined, babysitDiff: string | undefined): string {
  const merged = [createDiff, babysitDiff].filter((diff): diff is string => !!diff).join('\n')
  return merged.length > MAX_DIFF_BYTES
    ? `${merged.slice(0, MAX_DIFF_BYTES)}\n[diff truncated]`
    : merged
}

function combineAuthoringAndBabysit(
  label: 'Create PR' | 'Update PR',
  authored: AuthoringPhaseResult,
  babysit: PiRunResult
): PiRunResult {
  const authoringText = authored.totals.finalText
  return {
    totals: {
      finalText: `${label}:\n${authoringText}\n\nBabysit:\n${babysit.totals.finalText}`,
      inputTokens: authored.totals.inputTokens + babysit.totals.inputTokens,
      outputTokens: authored.totals.outputTokens + babysit.totals.outputTokens,
      toolCalls: [...authored.totals.toolCalls, ...babysit.totals.toolCalls],
      ...(authored.totals.errorMessage || babysit.totals.errorMessage
        ? { errorMessage: authored.totals.errorMessage ?? babysit.totals.errorMessage }
        : {}),
    },
    memoryText: authoringText,
    changedFiles: mergeChangedFiles(authored.changedFiles, babysit.changedFiles),
    diff: mergePhaseDiffs(authored.diff, babysit.diff),
    ...(authored.prUrl ? { prUrl: authored.prUrl } : {}),
    ...(authored.branch ? { branch: authored.branch } : {}),
    ...(typeof babysit.rounds === 'number' ? { rounds: babysit.rounds } : {}),
    ...(typeof babysit.threadsClean === 'boolean' ? { threadsClean: babysit.threadsClean } : {}),
    ...(typeof babysit.checksGreen === 'boolean' ? { checksGreen: babysit.checksGreen } : {}),
    ...(typeof babysit.threadsResolved === 'number'
      ? { threadsResolved: babysit.threadsResolved }
      : {}),
    ...(typeof babysit.commitsPushed === 'number' ? { commitsPushed: babysit.commitsPushed } : {}),
    ...(typeof babysit.stopReason === 'string' ? { stopReason: babysit.stopReason } : {}),
  }
}

function skippedBabysitResult(reason: 'no_pr_created' | 'startup_failure'): PiRunResult {
  return {
    totals: {
      finalText:
        reason === 'no_pr_created'
          ? 'Babysit stopped: no_pr_created. Create PR produced no changes, so no pull request was opened.'
          : 'Babysit stopped: startup_failure. GitHub did not return the new pull request number.',
      inputTokens: 0,
      outputTokens: 0,
      toolCalls: [],
    },
    rounds: 0,
    threadsClean: false,
    checksGreen: false,
    threadsResolved: 0,
    commitsPushed: 0,
    stopReason: reason,
  }
}

async function runCloudAuthoringPi(
  params: PiCloudAuthoringRunParams,
  context: PiRunContext
): Promise<PiRunResult> {
  const startedAt = Date.now()
  const modeLabel = params.mode === 'cloud' ? 'Create PR' : 'Update PR'
  if (!params.isBYOK) {
    throw new Error(
      `${modeLabel} requires your own provider API key (BYOK). Set one in Settings > BYOK.`
    )
  }
  const keyEnvVar = providerApiKeyEnvVar(params.providerId)
  if (!keyEnvVar) {
    throw new Error(
      `Provider "${params.providerId}" is not supported in ${modeLabel}. Use a key-based provider or run in Local Dev.`
    )
  }

  // Every credential that reaches this run, scrubbed from agent-visible and GitHub-visible text.
  // The guarantee covers the paths the key travels by design; it deliberately does not extend to a
  // key wired into a branch input, which becomes a git ref and could not be substituted without
  // failing the checkout outright.
  const secrets = [params.apiKey, params.githubToken, params.search?.apiKey ?? '']

  const branch =
    params.mode === 'cloud'
      ? params.branchName?.trim() || `pi/${generateShortId(8)}`
      : params.targetBranch
  const commitMessage = scrubPiSecrets(defaultTitle(params), secrets)
  const prompt = scrubPiSecrets(
    buildPiPrompt({
      skills: params.skills,
      initialMessages: params.initialMessages,
      task: params.task,
      guidance: guidanceFor(params),
    }),
    secrets
  )
  const totals = createPiTotals()
  const thinking = mapThinkingLevel(params.thinkingLevel) ?? 'medium'
  if (params.mode === 'cloud_branch') {
    try {
      await findOpenPrForBranch(
        {
          owner: params.owner,
          repo: params.repo,
          branch,
          githubToken: params.githubToken,
        },
        context.signal
      )
    } catch (error) {
      throw createScrubbedPiError(error, secrets, 'Pi cloud run failed')
    }
  }

  // Resolved once and shared: the sandbox is created with this lifetime and the
  // agent turn reserves its finalize budget against the same number.
  const lifetimeMs = resolvePiRunLifetimeMs(context.signal)
  const piTimeoutMs = resolvePiTimeoutMs(lifetimeMs)

  const authored = await withPiSandbox<AuthoringPhaseResult>({ lifetimeMs }, async (runner) => {
    try {
      const clone = await raceAbort(
        runner.run(params.mode === 'cloud' ? CREATE_PR_CLONE_SCRIPT : UPDATE_BRANCH_CLONE_SCRIPT, {
          envs: {
            GITHUB_TOKEN: params.githubToken,
            REPO_OWNER: params.owner,
            REPO_NAME: params.repo,
            BASE_BRANCH: params.mode === 'cloud' ? (params.baseBranch?.trim() ?? '') : '',
            BRANCH: branch,
          },
          timeoutMs: CLONE_TIMEOUT_MS,
        }),
        context.signal
      )
      if (clone.exitCode !== 0) {
        throw new Error(
          `git clone failed: ${scrubGitSecrets(clone.stderr || clone.stdout || 'unknown error', params.githubToken)}`
        )
      }
      const baseSha = extractMarkerValues(clone.stdout, '__BASE_SHA__=')[0]
      if (!baseSha) {
        throw new Error('Clone did not report a base commit')
      }
      const detectedBase =
        params.mode === 'cloud'
          ? extractMarkerValues(clone.stdout, '__DEFAULT_BRANCH__=')[0]
          : undefined

      // Deliver the prompt as a file (read back on Pi's stdin), not a CLI
      // arg/env, so its skill/memory content can't be parsed by the shell that
      // launches the Pi loop.
      await runner.writeFile(PROMPT_PATH, prompt)

      // Outside REPO_DIR: a path inside the cloned tree would be staged by `git add -A` into the
      // user's pull request, and the agent holds write/edit/bash on that tree for the whole run.
      if (params.search) {
        await runner.writeFile(PI_SEARCH_EXTENSION_PATH, PI_SEARCH_EXTENSION_SOURCE)
      }

      let buffer = ''
      // Scrubbed before `applyPiEvent`, not just before `onEvent`: `totals.finalText` accumulates
      // from text events and becomes both the block output and the PR body.
      const handleEvent = (raw: ReturnType<typeof parseJsonLine>) => {
        const event = scrubPiEvent(raw, secrets)
        if (!event) return
        applyPiEvent(totals, event)
        context.onEvent(event)
      }
      const handleChunk = (chunk: string) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          handleEvent(parseJsonLine(line))
        }
      }
      const piRun = await raceAbort(
        runner.run(buildPiScript(params.search ? PI_SEARCH_EXTENSION_PATH : undefined), {
          envs: {
            [keyEnvVar]: params.apiKey,
            PI_PROVIDER: getPiProviderId(params.providerId),
            PI_MODEL: params.piModel,
            PI_THINKING: thinking,
            ...(params.search
              ? {
                  [PI_SEARCH_PROVIDER_ENV_VAR]: params.search.provider,
                  [PI_SEARCH_API_KEY_ENV_VAR]: params.search.apiKey,
                }
              : {}),
          },
          timeoutMs: piTimeoutMs,
          onStdout: handleChunk,
        }),
        context.signal
      )
      if (buffer.trim()) {
        handleEvent(parseJsonLine(buffer))
      }
      if (piRun.exitCode !== 0) {
        throw new Error(
          `Pi agent failed (exit ${piRun.exitCode}): ${piRun.stderr || piRun.stdout}`.trim()
        )
      }

      if (totals.errorMessage) {
        throw new Error(`Pi agent failed: ${totals.errorMessage}`)
      }

      // Same rationale as the prompt: keep the commit message off the command line.
      await runner.writeFile(COMMIT_MSG_PATH, commitMessage)

      // PREPARE stages, commits, and diffs WITHOUT the GitHub token in scope, so a
      // repo-config-driven program the agent may have planted can't exfiltrate it.
      const prepare = await raceAbort(
        runner.run(PREPARE_SCRIPT, {
          envs: { BASE_SHA: baseSha },
          timeoutMs: FINALIZE_TIMEOUT_MS,
        }),
        context.signal
      )
      const changedFiles = extractMarkerValues(prepare.stdout, '__CHANGED__=').map((file) =>
        scrubPiSecrets(file, secrets)
      )
      const noChanges = prepare.stdout.includes('__NO_CHANGES__=1')
      const needsPush = prepare.stdout.includes('__NEEDS_PUSH__=1')
      // PREPARE (`set -e`) emits exactly one of the two markers on success. Neither
      // means the finalize step itself failed (e.g. the repo dir vanished mid-run) —
      // surface that rather than silently reporting success with no push.
      if (!noChanges && !needsPush) {
        const reason = (prepare.stderr || prepare.stdout || 'no status reported').trim()
        throw new Error(`Pi finalize failed: ${truncate(reason, PUSH_ERROR_MAX)}`)
      }

      let diff: string | undefined
      try {
        const raw = scrubPiSecrets(await runner.readFile(DIFF_PATH), secrets)
        diff =
          raw.length > MAX_DIFF_BYTES ? `${raw.slice(0, MAX_DIFF_BYTES)}\n[diff truncated]` : raw
      } catch {
        diff = undefined
      }

      if (noChanges) {
        logger.info('Pi cloud run produced no changes to push', {
          owner: params.owner,
          repo: params.repo,
        })
        if (params.mode === 'cloud') {
          return { totals, changedFiles, diff }
        }
      } else {
        // PUSH is the only command that carries the token, hardened against any
        // git-config program execution the agent may have planted.
        const push = await raceAbort(
          runner.run(PUSH_SCRIPT, {
            envs: {
              GITHUB_TOKEN: params.githubToken,
              GIT_CONFIG_NOSYSTEM: '1',
              GIT_CONFIG_GLOBAL: '/dev/null',
              REPO_OWNER: params.owner,
              REPO_NAME: params.repo,
              BRANCH: branch,
            },
            timeoutMs: FINALIZE_TIMEOUT_MS,
          }),
          context.signal
        )
        if (!push.stdout.includes('__PUSHED__=1')) {
          let reason = push.stderr?.trim()
          try {
            const pushErr = (await runner.readFile(PUSH_ERR_PATH)).trim()
            if (pushErr) reason = pushErr
          } catch {}
          const scrubbed = scrubGitSecrets(reason || 'unknown error', params.githubToken)
          throw new Error(`git push failed: ${truncate(scrubbed, PUSH_ERROR_MAX)}`)
        }
      }

      let pullRequest: OpenedPullRequest
      if (params.mode === 'cloud_branch') {
        pullRequest = await ensureUpdatePullRequest(params, branch, totals, secrets, context.signal)
      } else {
        const base = params.baseBranch?.trim() || detectedBase
        if (!base) {
          throw new Error(
            `Branch ${branch} pushed, but the base branch could not be determined — set "Base Branch" on the block and re-run.`
          )
        }
        pullRequest = await openPullRequest(
          params,
          branch,
          base,
          params.babysit ? false : params.draft,
          totals,
          secrets,
          context.signal
        )
      }
      return {
        totals,
        changedFiles,
        diff,
        ...(pullRequest.url ? { prUrl: pullRequest.url } : {}),
        ...(pullRequest.number ? { pullNumber: pullRequest.number } : {}),
        branch,
      }
    } catch (error) {
      // Aborts propagate as errors so a cancelled/timed-out run is not reported as
      // success and no partial memory turn is persisted (Local Dev mirrors this).
      if (context.signal?.aborted) {
        logger.info('Pi cloud run aborted', { owner: params.owner, repo: params.repo })
      }
      // The Pi step's failure path rethrows the sandbox's stderr verbatim, and a misconfigured
      // provider key is exactly a non-zero exit with stderr.
      throw createScrubbedPiError(error, secrets, 'Pi cloud run failed')
    }
  })

  if (!params.babysit) return authored
  if (!authored.branch) {
    return combineAuthoringAndBabysit(modeLabel, authored, skippedBabysitResult('no_pr_created'))
  }
  if (!authored.pullNumber) {
    return combineAuthoringAndBabysit(modeLabel, authored, skippedBabysitResult('startup_failure'))
  }

  // The run's own deadline when the platform set one, because Babysit spends this
  // budget sitting in waits: planning against `getMaxExecutionTimeout()` — the
  // longest-lived plan's async ceiling — meant a sync run was killed mid-loop with
  // the PR already opened, its review comments already posted, and none of the
  // `rounds`/`stopReason` outputs produced. The ceiling stays as the fallback for an
  // untimed execution, where it is the only bound available.
  const remainingExecutionMs =
    getRemainingExecutionMs(context.signal) ??
    Math.max(0, getMaxExecutionTimeout() - (Date.now() - startedAt))
  const sandboxBudgetMs = resolvePiSandboxLifetimeMs() ?? getMaxExecutionTimeout()
  const babysit = await runBabysitPi(
    {
      model: params.model,
      piModel: params.piModel,
      providerId: params.providerId,
      apiKey: params.apiKey,
      isBYOK: params.isBYOK,
      task: params.task,
      thinkingLevel: params.thinkingLevel,
      ...(params.search ? { search: params.search } : {}),
      skills: params.skills,
      initialMessages: [],
      owner: params.owner,
      repo: params.repo,
      githubToken: params.githubToken,
      pullNumber: authored.pullNumber,
      maxRounds: params.babysit.maxRounds,
      reviewMentions: params.babysit.reviewMentions,
      ...(params.babysit.executionId ? { executionId: params.babysit.executionId } : {}),
      executionBudgetMs: Math.min(remainingExecutionMs, sandboxBudgetMs),
    },
    context
  )
  return combineAuthoringAndBabysit(modeLabel, authored, babysit)
}

export const runCloudPi: PiBackendRun<PiCloudRunParams> = (params, context) =>
  runCloudAuthoringPi(params, context)

export const runCloudBranchPi: PiBackendRun<PiCloudBranchRunParams> = (params, context) =>
  runCloudAuthoringPi(params, context)
