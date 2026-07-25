/**
 * Create PR backend: runs the Pi CLI inside an E2B sandbox against a cloned
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
import { withPiSandbox } from '@/lib/execution/remote-sandbox'
import type { PiBackendRun, PiCloudRunParams } from '@/executor/handlers/pi/backend'
import {
  buildPiScript,
  CLONE_TIMEOUT_MS,
  COMMIT_MSG_PATH,
  DIFF_PATH,
  extractMarkerValues,
  FINALIZE_TIMEOUT_MS,
  GIT_CONFIG_DIGEST_LINE,
  MAX_DIFF_BYTES,
  PI_TIMEOUT_MS,
  PREPARE_SCRIPT,
  PROMPT_PATH,
  PUSH_ERR_PATH,
  PUSH_ERROR_MAX,
  PUSH_SCRIPT,
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

const logger = createLogger('PiCloudBackend')

const COMMIT_TITLE_MAX = 72
const PR_SUMMARY_MAX = 2000

/**
 * Keeps git authentication out of the agent loop by reserving commit, push, and
 * PR creation for Sim's credential-scoped finalization step.
 */
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
git remote set-url origin "https://github.com/$REPO_OWNER/$REPO_NAME.git"
${GIT_CONFIG_DIGEST_LINE}`

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
  totals: PiRunTotals,
  secrets: readonly string[]
): Promise<string | undefined> {
  const base = params.baseBranch?.trim() || detectedBase
  if (!base) {
    throw new Error(
      `Branch ${branch} pushed, but the base branch could not be determined — set "Base Branch" on the block and re-run.`
    )
  }
  const title = scrubPiSecrets(defaultTitle(params), secrets)
  const body = scrubPiSecrets(
    params.prBody?.trim() || buildPrBody(params.task, totals.finalText),
    secrets
  )

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
      'Create PR requires your own provider API key (BYOK). Set one in Settings > BYOK.'
    )
  }
  const keyEnvVar = providerApiKeyEnvVar(params.providerId)
  if (!keyEnvVar) {
    throw new Error(
      `Provider "${params.providerId}" is not supported in Create PR. Use a key-based provider or run in Local Dev.`
    )
  }

  // Every credential that reaches this run, scrubbed from agent-visible and GitHub-visible text.
  // The guarantee covers the paths the key travels by design; it deliberately does not extend to a
  // key wired into `branchName`, which becomes a git ref and could not be substituted without
  // failing the checkout outright.
  const secrets = [params.apiKey, params.githubToken, params.search?.apiKey ?? '']

  const branch = params.branchName?.trim() || `pi/${generateShortId(8)}`
  const commitMessage = scrubPiSecrets(defaultTitle(params), secrets)
  const prompt = scrubPiSecrets(
    buildPiPrompt({
      skills: params.skills,
      initialMessages: params.initialMessages,
      task: params.task,
      guidance: CLOUD_GUIDANCE,
    }),
    secrets
  )
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
          timeoutMs: PI_TIMEOUT_MS,
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
        return { totals, changedFiles, diff }
      }

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

      const prUrl = await openPullRequest(params, branch, detectedBase, totals, secrets)
      return { totals, changedFiles, diff, prUrl, branch }
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
}
