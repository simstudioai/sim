/**
 * Cloud Plan backend: clones a GitHub repository into an ephemeral sandbox,
 * removes its authenticated remote, and lets Pi inspect the disposable checkout
 * before returning an implementation plan. There is deliberately no finalize,
 * push, pull-request, review, or other GitHub-write phase.
 */

import { createLogger } from '@sim/logger'
import { withPiSandbox } from '@/lib/execution/remote-sandbox'
import { resolvePiRunLifetimeMs } from '@/lib/execution/remote-sandbox/pi-lifetime'
import {
  PI_EVENT_FILTER_PATH,
  PI_EVENT_FILTER_SOURCE,
} from '@/executor/handlers/pi/cloud/event-filter-source'
import {
  buildPiScript,
  CLONE_TIMEOUT_MS,
  PROMPT_PATH,
  REPO_DIR,
  raceAbort,
  resolvePiTimeoutMs,
  scrubGitSecrets,
} from '@/executor/handlers/pi/cloud/shared'
import type { PiBackendRun, PiCloudPlanRunParams } from '@/executor/handlers/pi/core/backend'
import { buildPiPrompt } from '@/executor/handlers/pi/core/context'
import { applyPiEvent, createPiTotals, parseJsonLine } from '@/executor/handlers/pi/core/events'
import { mapThinkingLevel, providerApiKeyEnvVar } from '@/executor/handlers/pi/core/keys'
import {
  createScrubbedPiError,
  scrubPiEvent,
  scrubPiSecrets,
} from '@/executor/handlers/pi/core/redaction'
import {
  PI_SEARCH_API_KEY_ENV_VAR,
  PI_SEARCH_EXTENSION_PATH,
  PI_SEARCH_EXTENSION_SOURCE,
  PI_SEARCH_PROVIDER_ENV_VAR,
} from '@/executor/handlers/pi/search/extension-source'
import { getPiProviderId } from '@/providers/pi-providers'

const logger = createLogger('PiCloudPlanBackend')

const PLAN_GUIDANCE =
  'Explore the repository thoroughly and produce an implementation plan for the task. You may read and search files, run shell commands and tests, use web_search when available, and make scratch edits when useful; the checkout is disposable. Do not commit, push, open or modify pull requests, submit reviews, or make any other external write. Your final response must be a Markdown plan covering the recommended approach, relevant files and symbols, ordered implementation steps, tests, and material risks or open questions.'

const PLAN_CLONE_SCRIPT = `set -e
rm -rf ${REPO_DIR}
git clone --no-tags "https://x-access-token:$GITHUB_TOKEN@github.com/$REPO_OWNER/$REPO_NAME.git" ${REPO_DIR}
cd ${REPO_DIR}
if [ -n "$BASE_BRANCH" ]; then
  git check-ref-format "refs/heads/$BASE_BRANCH" >/dev/null
  git checkout --detach "origin/$BASE_BRANCH"
else
  git checkout --detach HEAD
fi
git remote remove origin`

export const runCloudPlanPi: PiBackendRun<PiCloudPlanRunParams> = async (params, context) => {
  if (!params.isBYOK) {
    throw new Error('Plan requires your own provider API key (BYOK). Set one in Settings > BYOK.')
  }
  const keyEnvVar = providerApiKeyEnvVar(params.providerId)
  if (!keyEnvVar) {
    throw new Error(
      `Provider "${params.providerId}" is not supported in Plan. Use a key-based provider.`
    )
  }

  const secrets = [params.apiKey, params.githubToken, params.search?.apiKey ?? '']
  const prompt = scrubPiSecrets(
    buildPiPrompt({
      skills: params.skills,
      initialMessages: params.initialMessages,
      task: params.task,
      guidance: PLAN_GUIDANCE,
    }),
    secrets
  )
  const totals = createPiTotals()
  const thinking = mapThinkingLevel(params.thinkingLevel) ?? 'medium'
  const lifetimeMs = resolvePiRunLifetimeMs(context.signal)

  return withPiSandbox({ lifetimeMs }, async (runner) => {
    try {
      const clone = await raceAbort(
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
          `git clone failed: ${scrubGitSecrets(clone.stderr || clone.stdout || 'unknown error', params.githubToken)}`
        )
      }

      await runner.writeFile(PROMPT_PATH, prompt)
      await runner.writeFile(PI_EVENT_FILTER_PATH, PI_EVENT_FILTER_SOURCE)
      if (params.search) {
        await runner.writeFile(PI_SEARCH_EXTENSION_PATH, PI_SEARCH_EXTENSION_SOURCE)
      }

      let buffer = ''
      const handleEvent = (raw: ReturnType<typeof parseJsonLine>) => {
        const event = scrubPiEvent(raw, secrets)
        if (!event) return
        applyPiEvent(totals, event)
        if (event.type === 'final' && event.text) {
          totals.finalText = event.text
        }
        context.onEvent(event)
      }
      const handleChunk = (chunk: string) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) handleEvent(parseJsonLine(line))
      }

      const piRun = await raceAbort(
        runner.run(
          buildPiScript(params.search ? PI_SEARCH_EXTENSION_PATH : undefined, {
            disableRepositoryResources: true,
          }),
          {
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
            timeoutMs: resolvePiTimeoutMs(lifetimeMs, { finalizePhases: 0 }),
            onStdout: handleChunk,
          }
        ),
        context.signal
      )
      if (buffer.trim()) handleEvent(parseJsonLine(buffer))
      if (piRun.exitCode !== 0) {
        throw new Error(
          `Pi agent failed (exit ${piRun.exitCode}): ${piRun.stderr || piRun.stdout}`.trim()
        )
      }
      if (totals.errorMessage) throw new Error(`Pi agent failed: ${totals.errorMessage}`)

      return { totals }
    } catch (error) {
      if (context.signal?.aborted) {
        logger.info('Pi cloud plan run aborted', { owner: params.owner, repo: params.repo })
      }
      throw createScrubbedPiError(error, secrets, 'Pi cloud plan run failed')
    }
  })
}
