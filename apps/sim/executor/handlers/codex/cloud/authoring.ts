/** Codex Create PR backend with credential-separated git finalization. */

import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { resolveCodexRunLifetimeMs } from '@/lib/execution/remote-sandbox/codex-lifetime'
import {
  CLONE_TIMEOUT_MS,
  CODEX_COMMIT_MSG_PATH,
  CODEX_DIFF_PATH,
  CODEX_PUSH_ERR_PATH,
  CREATE_PR_CLONE_SCRIPT,
  extractMarkerValues,
  FINALIZE_TIMEOUT_MS,
  GIT_CONFIG_VERIFY_TIMEOUT_MS,
  MAX_DIFF_BYTES,
  PREPARE_CODEX_SCRIPT,
  PUSH_CODEX_SCRIPT,
  PUSH_ERROR_MAX,
  raceCodexAbort,
  resolveCodexTimeoutMs,
  runCodexTurn,
  scrubGitSecrets,
  VERIFY_GIT_CONFIG_SCRIPT,
  validateCodexBranchName,
} from '@/executor/handlers/codex/cloud/shared'
import type { CodexBackendRun, CodexCloudRunParams } from '@/executor/handlers/codex/core/backend'
import {
  createScrubbedCodexError,
  scrubCodexSecrets,
} from '@/executor/handlers/codex/core/redaction'
import { executeTool } from '@/tools'
import { requiredRecord, requiredTrimmedString } from '@/tools/github/response-parsers'

const logger = createLogger('CodexCloudAuthoringBackend')
const COMMIT_TITLE_MAX = 72
const PR_SUMMARY_MAX = 2_000

const AUTHORING_GUIDANCE =
  'You are running inside an automated sandbox. Make only the file changes needed to complete the task. ' +
  'Do not run git commands (commit, push, branch, remote), configure git credentials, authenticate with ' +
  'GitHub, or open a pull request. After you finish, Sim commits the changes, pushes a new branch, and ' +
  'opens the pull request. Keep edits focused and run relevant checks when the repository supports them.'

function defaultTitle(params: CodexCloudRunParams, secrets: readonly string[]): string {
  return scrubCodexSecrets(
    params.prTitle?.trim() || truncate(`Codex: ${params.task}`, COMMIT_TITLE_MAX),
    secrets
  )
}

function buildPrBody(
  params: CodexCloudRunParams,
  finalText: string,
  secrets: readonly string[]
): string {
  if (params.prBody?.trim()) return scrubCodexSecrets(params.prBody.trim(), secrets)
  const summary = finalText.trim()
    ? truncate(finalText.trim(), PR_SUMMARY_MAX)
    : 'Automated changes by the Codex Coding Agent.'
  return scrubCodexSecrets(`## Task\n\n${params.task}\n\n## Summary\n\n${summary}`, secrets)
}

async function openPullRequest(
  params: CodexCloudRunParams,
  branch: string,
  base: string,
  finalText: string,
  secrets: readonly string[],
  signal?: AbortSignal
): Promise<string> {
  const result = await executeTool(
    'github_create_pr',
    {
      owner: params.owner,
      repo: params.repo,
      title: defaultTitle(params, secrets),
      head: branch,
      base,
      body: buildPrBody(params, finalText, secrets),
      draft: params.draft,
      apiKey: params.githubToken,
    },
    { signal }
  )
  if (!result.success) {
    throw new Error(`PR creation failed for branch ${branch}: ${result.error ?? 'unknown error'}`)
  }
  if (!isRecordLike(result.output)) {
    throw new Error(`PR creation returned an invalid response for branch ${branch}`)
  }
  const metadata = requiredRecord(result.output, 'metadata', 'GitHub create pull request response')
  return requiredTrimmedString(metadata, 'html_url', 'GitHub create pull request response.metadata')
}

export const runCloudCodex: CodexBackendRun<CodexCloudRunParams> = async (params, context) => {
  const secrets = [params.apiKey, params.githubToken]
  const commitMessage = defaultTitle(params, secrets)
  const lifetimeMs = resolveCodexRunLifetimeMs(context.signal)
  const { session } = context
  const runner = session.runner

  try {
    const state = session.authoring
    if (!state.initialized) {
      const branch = validateCodexBranchName(
        params.branchName?.trim() || `codex/${generateShortId(8)}`
      )
      const clone = await raceCodexAbort(
        runner.run(CREATE_PR_CLONE_SCRIPT, {
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
          `git clone failed: ${scrubGitSecrets(
            clone.stderr || clone.stdout || 'unknown error',
            params.githubToken
          )}`
        )
      }
      const baseSha = extractMarkerValues(clone.stdout, '__BASE_SHA__=')[0]
      const detectedBase = extractMarkerValues(clone.stdout, '__DEFAULT_BRANCH__=')[0]
      const gitConfigDigest = extractMarkerValues(clone.stdout, '__GIT_CONFIG_DIGEST__=')[0]
      if (!baseSha || !gitConfigDigest) throw new Error('Clone did not report repository state')

      Object.assign(state, {
        initialized: true,
        branch,
        baseSha,
        headSha: baseSha,
        detectedBase,
        gitConfigDigest,
      })
    } else if (
      params.branchName?.trim() &&
      validateCodexBranchName(params.branchName.trim()) !== state.branch
    ) {
      throw new Error(
        `Codex Agent "${params.agentId}" is already using branch ${state.branch}. Use another Agent ID for a different branch.`
      )
    }

    const { branch, baseSha, gitConfigDigest } = state
    if (!branch || !baseSha || !gitConfigDigest) {
      throw new Error('Codex authoring session is missing repository state')
    }
    const turnBaseSha = state.headSha ?? baseSha

    const totals = await runCodexTurn({
      runner,
      prompt: `${AUTHORING_GUIDANCE}\n\nTask:\n${params.task}`,
      model: params.model,
      reasoningEffort: params.reasoningEffort,
      networkAccess: params.networkAccess,
      apiKey: params.apiKey,
      secrets,
      timeoutMs: resolveCodexTimeoutMs(lifetimeMs),
      threadId: session.threadId,
      signal: context.signal,
      onEvent: (event) => {
        if (event.type === 'thread_started') session.threadId = event.threadId
        context.onEvent(event)
      },
    })
    session.threadId = totals.threadId

    const configCheck = await raceCodexAbort(
      runner.run(VERIFY_GIT_CONFIG_SCRIPT, {
        envs: {},
        timeoutMs: GIT_CONFIG_VERIFY_TIMEOUT_MS,
      }),
      context.signal
    )
    const currentDigest = extractMarkerValues(configCheck.stdout, '__GIT_CONFIG_DIGEST__=')[0]
    if (!currentDigest || currentDigest !== gitConfigDigest) {
      throw new Error('Repository git config changed during the Codex run; refusing to finalize')
    }

    await runner.writeFile(CODEX_COMMIT_MSG_PATH, commitMessage)
    const prepare = await raceCodexAbort(
      runner.run(PREPARE_CODEX_SCRIPT, {
        envs: { BASE_SHA: baseSha, TURN_BASE_SHA: turnBaseSha },
        timeoutMs: FINALIZE_TIMEOUT_MS,
      }),
      context.signal
    )
    const changedFiles = extractMarkerValues(prepare.stdout, '__CHANGED__=')
    const headSha = extractMarkerValues(prepare.stdout, '__HEAD_SHA__=')[0]
    const reportedTurnStatus =
      prepare.stdout.includes('__NO_TURN_CHANGES__=1') ||
      prepare.stdout.includes('__TURN_CHANGED__=1')
    if (!headSha || !reportedTurnStatus) {
      throw new Error(
        `Codex finalize failed: ${truncate(
          (prepare.stderr || prepare.stdout || 'no status reported').trim(),
          PUSH_ERROR_MAX
        )}`
      )
    }
    state.headSha = headSha

    let diff: string | undefined
    try {
      const raw = await runner.readFile(CODEX_DIFF_PATH)
      diff = raw.length > MAX_DIFF_BYTES ? `${raw.slice(0, MAX_DIFF_BYTES)}\n[diff truncated]` : raw
    } catch {
      diff = undefined
    }
    if (headSha === baseSha) {
      logger.info('Codex cloud run produced no changes to push', {
        agentId: params.agentId,
        owner: params.owner,
        repo: params.repo,
      })
      return { totals, status: 'completed', changedFiles, diff }
    }

    if (state.pushedHeadSha !== headSha) {
      const push = await raceCodexAbort(
        runner.run(PUSH_CODEX_SCRIPT, {
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
        let reason = push.stderr.trim()
        try {
          reason = (await runner.readFile(CODEX_PUSH_ERR_PATH)).trim() || reason
        } catch {}
        throw new Error(
          `git push failed: ${truncate(
            scrubGitSecrets(reason || 'unknown error', params.githubToken),
            PUSH_ERROR_MAX
          )}`
        )
      }
      state.pushedHeadSha = headSha
    }

    if (!state.prUrl) {
      const base = params.baseBranch?.trim() || state.detectedBase
      if (!base) {
        throw new Error(
          `Branch ${branch} pushed, but the base branch could not be determined; set Base Branch and re-run.`
        )
      }
      state.prUrl = await openPullRequest(
        params,
        branch,
        base,
        totals.finalText,
        secrets,
        context.signal
      )
    }
    return { totals, status: 'completed', changedFiles, diff, branch, prUrl: state.prUrl }
  } catch (error) {
    if (context.signal?.aborted) {
      logger.info('Codex cloud run aborted', {
        agentId: params.agentId,
        owner: params.owner,
        repo: params.repo,
      })
    }
    throw createScrubbedCodexError(error, secrets, 'Codex cloud run failed')
  }
}
