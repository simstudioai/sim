/** Disposable cloud checkout used by the Codex Plan mode. */

import { createLogger } from '@sim/logger'
import { resolveCodexRunLifetimeMs } from '@/lib/execution/remote-sandbox/codex-lifetime'
import {
  CLONE_TIMEOUT_MS,
  PLAN_CLONE_SCRIPT,
  raceCodexAbort,
  resolveCodexTimeoutMs,
  runCodexTurn,
  scrubGitSecrets,
} from '@/executor/handlers/codex/cloud/shared'
import type {
  CodexBackendRun,
  CodexCloudPlanRunParams,
} from '@/executor/handlers/codex/core/backend'
import { createScrubbedCodexError } from '@/executor/handlers/codex/core/redaction'

const logger = createLogger('CodexCloudPlanBackend')

const PLAN_GUIDANCE =
  'Explore the repository thoroughly and produce an implementation plan for the task. ' +
  'You may read and search files, run shell commands and tests, and make scratch edits when useful; ' +
  'the checkout is disposable. Do not commit, push, open or modify pull requests, submit reviews, ' +
  'or make any other external write. Your final response must be a Markdown plan covering the ' +
  'recommended approach, relevant files and symbols, ordered implementation steps, tests, and ' +
  'material risks or open questions.'

export const runCloudPlanCodex: CodexBackendRun<CodexCloudPlanRunParams> = async (
  params,
  context
) => {
  const secrets = [params.apiKey, params.githubToken]
  const lifetimeMs = resolveCodexRunLifetimeMs(context.signal)
  const { session } = context
  const runner = session.runner

  try {
    if (!session.planInitialized) {
      const clone = await raceCodexAbort(
        runner.run(PLAN_CLONE_SCRIPT, {
          envs: {
            GITHUB_TOKEN: params.githubToken,
            REPO_OWNER: params.owner,
            REPO_NAME: params.repo,
            BASE_BRANCH: params.baseBranch?.trim() ?? '',
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
      session.planInitialized = true
    }

    const totals = await runCodexTurn({
      runner,
      prompt: `${PLAN_GUIDANCE}\n\nTask:\n${params.task}`,
      model: params.model,
      reasoningEffort: params.reasoningEffort,
      networkAccess: params.networkAccess,
      apiKey: params.apiKey,
      secrets,
      timeoutMs: resolveCodexTimeoutMs(lifetimeMs, { finalizePhases: 0 }),
      threadId: session.threadId,
      signal: context.signal,
      onEvent: (event) => {
        if (event.type === 'thread_started') session.threadId = event.threadId
        context.onEvent(event)
      },
    })
    session.threadId = totals.threadId
    return { totals, status: 'completed' }
  } catch (error) {
    if (context.signal?.aborted) {
      logger.info('Codex cloud plan run aborted', {
        agentId: params.agentId,
        owner: params.owner,
        repo: params.repo,
      })
    }
    throw createScrubbedCodexError(error, secrets, 'Codex cloud plan run failed')
  }
}
