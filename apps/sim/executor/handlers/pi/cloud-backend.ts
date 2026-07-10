/**
 * Cloud PR backend: runs the Pi CLI inside an E2B sandbox against a cloned
 * GitHub repo, then pushes a branch and opens a PR. Secrets are isolated per
 * command (S2/KTD10): the GitHub token is present only for the clone and push
 * commands (and stripped from the cloned remote), while the Pi loop runs with a
 * BYOK model key only. The model key is never a Sim-owned hosted key (S1).
 *
 * Untrusted text (the assembled prompt, which folds in workspace-shared skills
 * and memory, and the commit message) is never placed on a shell command line.
 * It is written into sandbox files via the E2B filesystem API and read back from
 * fixed paths (Pi's prompt on stdin, `git commit -F <file>`), so a collaborator-
 * authored skill cannot inject shell into the Pi step where the model key lives.
 */

import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { withPiSandbox } from '@/lib/execution/e2b'
import type { PiBackendRun, PiCloudRunParams } from '@/executor/handlers/pi/backend'
import {
  CLONE_TIMEOUT_MS,
  extractMarkerValues,
  PI_SCRIPT,
  PI_TIMEOUT_MS,
  PROMPT_PATH,
  REPO_DIR,
  raceAbort,
  scrubGitSecrets,
} from '@/executor/handlers/pi/cloud-shared'
import { buildPiPrompt } from '@/executor/handlers/pi/context'
import {
  applyPiEvent,
  createPiTotals,
  type PiRunTotals,
  parseJsonLine,
} from '@/executor/handlers/pi/events'
import { mapThinkingLevel, providerApiKeyEnvVar } from '@/executor/handlers/pi/keys'
import { executeTool } from '@/tools'

const logger = createLogger('PiCloudBackend')

const DIFF_PATH = '/workspace/pi.diff'
const COMMIT_MSG_PATH = '/workspace/pi-commit.txt'
const PUSH_ERR_PATH = '/workspace/pi-push-err.txt'
const FINALIZE_TIMEOUT_MS = 10 * 60 * 1000
const MAX_DIFF_BYTES = 200_000
const COMMIT_TITLE_MAX = 72
const PR_SUMMARY_MAX = 2000
const PUSH_ERROR_MAX = 1000

// The agent only edits files; Sim commits, pushes, and opens the PR after the run.
// Without this, the coding agent tries to git push / open a PR / run the test
// toolchain itself and fails — the sandbox has no GitHub auth (the token is
// stripped from the remote after clone) and may lack the project's tooling.
const CLOUD_GUIDANCE =
  'You are running inside an automated sandbox. Make only the file changes needed to complete the task. ' +
  'Do not run git commands (commit, push, branch, remote), do not configure git credentials or authenticate ' +
  'with GitHub, and do not open a pull request — after you finish, Sim automatically commits your changes, ' +
  "pushes the branch, and opens the pull request. The project's package manager and test tooling may not be " +
  'installed, so do not block on running the full build or test suite; focus on correct, minimal edits.'

const CLONE_SCRIPT = `set -e
rm -rf ${REPO_DIR}
git clone "https://x-access-token:$GITHUB_TOKEN@github.com/$REPO_OWNER/$REPO_NAME.git" ${REPO_DIR}
cd ${REPO_DIR}
if [ -n "$BASE_BRANCH" ]; then git checkout "$BASE_BRANCH"; fi
git rev-parse HEAD | sed "s/^/__BASE_SHA__=/"
DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed "s#^origin/##" || true)
echo "__DEFAULT_BRANCH__=$DEFAULT_BRANCH"
git checkout -b "$BRANCH"
git remote set-url origin "https://github.com/$REPO_OWNER/$REPO_NAME.git"`

// Finalize is split so the GitHub token is in scope for ONLY the push. `git add`,
// `commit`, and `diff` run repo-config-driven programs that `core.hooksPath` does
// NOT disable — gitattributes clean/smudge filters (on add), `core.fsmonitor`
// (on add/diff), and `diff.external`/textconv (on diff). The untrusted Pi loop can
// plant `.gitattributes` + `.git/config` to run code during these. Keeping the
// token out of PREPARE's env means a planted program has no credential to steal;
// hooks are disabled too as defense-in-depth. Commit runs unconditionally
// (`|| true` tolerates an empty commit); the push decision is gated on HEAD
// advancing past base, so commits the agent made itself are still pushed.
const PREPARE_SCRIPT = `set -e
cd ${REPO_DIR}
git -c core.hooksPath=/dev/null add -A
git -c core.hooksPath=/dev/null -c user.email="pi@sim.ai" -c user.name="Sim Pi Agent" commit -F ${COMMIT_MSG_PATH} >/dev/null 2>&1 || true
git diff --name-only "$BASE_SHA" HEAD | sed "s/^/__CHANGED__=/"
git diff "$BASE_SHA" HEAD > ${DIFF_PATH} 2>/dev/null || true
if git diff --quiet "$BASE_SHA" HEAD; then echo "__NO_CHANGES__=1"; else echo "__NEEDS_PUSH__=1"; fi`

// The only token-bearing command. The agent-planted `.git/config` is still active,
// so neutralize every config key that could run a program during push: hooks
// (pre-push), `credential.helper` (runs during auth), and `core.fsmonitor`.
// Filters/textconv don't run on push (no checkout/add/diff here).
const PUSH_SCRIPT = `cd ${REPO_DIR}
git -c core.hooksPath=/dev/null -c credential.helper= -c core.fsmonitor= push "https://x-access-token:$GITHUB_TOKEN@github.com/$REPO_OWNER/$REPO_NAME.git" "$BRANCH" >/dev/null 2>${PUSH_ERR_PATH} && echo "__PUSHED__=1"`

function buildPrBody(task: string, finalText: string): string {
  const summary = finalText.trim()
    ? truncate(finalText.trim(), PR_SUMMARY_MAX)
    : 'Automated changes by the Pi Coding Agent.'
  return `## Task\n\n${task}\n\n## Summary\n\n${summary}`
}

/** The commit message and PR title share one default, derived from the PR title or task. */
function defaultTitle(params: PiCloudRunParams): string {
  return params.prTitle?.trim() || truncate(`Pi: ${params.task}`, COMMIT_TITLE_MAX)
}

async function openPullRequest(
  params: PiCloudRunParams,
  branch: string,
  detectedBase: string | undefined,
  totals: PiRunTotals
): Promise<string | undefined> {
  const base = params.baseBranch?.trim() || detectedBase
  if (!base) {
    throw new Error(
      `Branch ${branch} pushed, but the base branch could not be determined — set "Base Branch" on the block and re-run.`
    )
  }
  const title = defaultTitle(params)
  const body = params.prBody?.trim() || buildPrBody(params.task, totals.finalText)

  const result = await executeTool('github_create_pr', {
    owner: params.owner,
    repo: params.repo,
    title,
    head: branch,
    base,
    body,
    draft: params.draft,
    apiKey: params.githubToken,
  })

  if (!result.success) {
    throw new Error(
      `Branch ${branch} pushed but PR creation failed: ${result.error ?? 'unknown error'}`
    )
  }

  const output = result.output as { metadata?: { html_url?: string } } | undefined
  return output?.metadata?.html_url
}

export const runCloudPi: PiBackendRun<PiCloudRunParams> = async (params, context) => {
  if (!params.isBYOK) {
    throw new Error(
      'Cloud mode requires your own provider API key (BYOK). Set one in Settings > BYOK.'
    )
  }
  const keyEnvVar = providerApiKeyEnvVar(params.providerId)
  if (!keyEnvVar) {
    throw new Error(
      `Provider "${params.providerId}" is not supported in cloud mode. Use a key-based provider or run in local mode.`
    )
  }

  const branch = params.branchName?.trim() || `pi/${generateShortId(8)}`
  const commitMessage = defaultTitle(params)
  const prompt = buildPiPrompt({
    skills: params.skills,
    initialMessages: params.initialMessages,
    task: params.task,
    guidance: CLOUD_GUIDANCE,
  })
  const totals = createPiTotals()
  const thinking = mapThinkingLevel(params.thinkingLevel) ?? 'medium'

  return withPiSandbox(async (runner) => {
    try {
      const clone = await raceAbort(
        runner.run(CLONE_SCRIPT, {
          envs: {
            GITHUB_TOKEN: params.githubToken,
            REPO_OWNER: params.owner,
            REPO_NAME: params.repo,
            BASE_BRANCH: params.baseBranch?.trim() ?? '',
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
      const detectedBase = extractMarkerValues(clone.stdout, '__DEFAULT_BRANCH__=')[0]

      // Deliver the prompt as a file (read back on Pi's stdin), not a CLI
      // arg/env, so its skill/memory content can't be parsed by the shell that
      // launches the Pi loop.
      await runner.writeFile(PROMPT_PATH, prompt)

      let buffer = ''
      const handleChunk = (chunk: string) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const event = parseJsonLine(line)
          if (!event) continue
          applyPiEvent(totals, event)
          context.onEvent(event)
        }
      }
      const piRun = await raceAbort(
        runner.run(PI_SCRIPT, {
          envs: {
            [keyEnvVar]: params.apiKey,
            PI_PROVIDER: params.providerId,
            PI_MODEL: params.model,
            PI_THINKING: thinking,
          },
          timeoutMs: PI_TIMEOUT_MS,
          onStdout: handleChunk,
        }),
        context.signal
      )
      const remaining = buffer.trim() ? parseJsonLine(buffer) : null
      if (remaining) {
        applyPiEvent(totals, remaining)
        context.onEvent(remaining)
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
      const changedFiles = extractMarkerValues(prepare.stdout, '__CHANGED__=')
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
        const raw = await runner.readFile(DIFF_PATH)
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
        return { totals, changedFiles, diff }
      }

      // PUSH is the only command that carries the token, hardened against any
      // git-config program execution the agent may have planted.
      const push = await raceAbort(
        runner.run(PUSH_SCRIPT, {
          envs: {
            GITHUB_TOKEN: params.githubToken,
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

      const prUrl = await openPullRequest(params, branch, detectedBase, totals)
      return { totals, changedFiles, diff, prUrl, branch }
    } catch (error) {
      // Aborts propagate as errors so a cancelled/timed-out run is not reported as
      // success and no partial memory turn is persisted (local mode mirrors this).
      if (context.signal?.aborted) {
        logger.info('Pi cloud run aborted', { owner: params.owner, repo: params.repo })
      }
      throw error
    }
  })
}
