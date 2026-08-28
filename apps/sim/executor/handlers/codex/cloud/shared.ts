/** Shared clone, Codex-turn, finalize, and credential-boundary helpers. */

import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import type { CodexSandboxRunner } from '@/lib/execution/remote-sandbox'
import { resolveCodexSandboxLifetimeMs } from '@/lib/execution/remote-sandbox/codex-lifetime'
import {
  buildCodexExecCommand,
  CODEX_PROMPT_PATH,
  CODEX_REPO_DIR,
  type CodexModel,
  type CodexReasoningEffort,
} from '@/executor/handlers/codex/core/command'
import {
  applyCodexEvent,
  type CodexEvent,
  type CodexRunTotals,
  createCodexTotals,
  parseCodexJsonLine,
} from '@/executor/handlers/codex/core/events'
import {
  createScrubbedCodexError,
  scrubCodexEvent,
  scrubCodexSecrets,
} from '@/executor/handlers/codex/core/redaction'
import {
  CLONE_TIMEOUT_MS,
  extractMarkerValues,
  FINALIZE_TIMEOUT_MS,
  GIT_CONFIG_DIGEST_LINE,
  MAX_DIFF_BYTES,
  PUSH_ERROR_MAX,
  scrubGitSecrets,
} from '@/executor/handlers/pi/cloud/shared'

export {
  CLONE_TIMEOUT_MS,
  extractMarkerValues,
  FINALIZE_TIMEOUT_MS,
  MAX_DIFF_BYTES,
  PUSH_ERROR_MAX,
  scrubGitSecrets,
}

export const CODEX_DIFF_PATH = '/workspace/codex.diff'
export const CODEX_COMMIT_MSG_PATH = '/workspace/codex-commit.txt'
export const CODEX_PUSH_ERR_PATH = '/workspace/codex-push-err.txt'
export const MIN_CODEX_TIMEOUT_MS = 60 * 1000
export const GIT_CONFIG_VERIFY_TIMEOUT_MS = 60 * 1000

/** Clone script for read-only-in-effect Plan runs. */
export const PLAN_CLONE_SCRIPT = `set -e
rm -rf ${CODEX_REPO_DIR}
git clone --no-tags "https://x-access-token:$GITHUB_TOKEN@github.com/$REPO_OWNER/$REPO_NAME.git" ${CODEX_REPO_DIR}
cd ${CODEX_REPO_DIR}
if [ -n "$BASE_BRANCH" ]; then
  git check-ref-format "refs/heads/$BASE_BRANCH" >/dev/null
  git checkout --detach "origin/$BASE_BRANCH"
else
  git checkout --detach HEAD
fi
git remote remove origin`

/** Clone script for a new branch, with the authenticated remote removed immediately. */
export const CREATE_PR_CLONE_SCRIPT = `set -e
rm -rf ${CODEX_REPO_DIR}
git clone "https://x-access-token:$GITHUB_TOKEN@github.com/$REPO_OWNER/$REPO_NAME.git" ${CODEX_REPO_DIR}
cd ${CODEX_REPO_DIR}
if [ -n "$BASE_BRANCH" ]; then git checkout "$BASE_BRANCH"; fi
git check-ref-format "refs/heads/$BRANCH" >/dev/null
if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  echo "Branch $BRANCH already exists" >&2
  exit 1
fi
git rev-parse HEAD | sed "s/^/__BASE_SHA__=/"
DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed "s#^origin/##" || true)
echo "__DEFAULT_BRANCH__=$DEFAULT_BRANCH"
git checkout -b "$BRANCH"
git remote set-url origin "https://github.com/$REPO_OWNER/$REPO_NAME.git"
${GIT_CONFIG_DIGEST_LINE}`

/** Stages, commits, and captures a bounded diff without either credential in scope. */
export const PREPARE_CODEX_SCRIPT = `set -e
cd ${CODEX_REPO_DIR}
git -c core.hooksPath=/dev/null add -A
git -c core.hooksPath=/dev/null -c user.email="codex@sim.ai" -c user.name="Sim Codex Agent" commit -F ${CODEX_COMMIT_MSG_PATH} >/dev/null 2>&1 || true
git rev-parse HEAD | sed "s/^/__HEAD_SHA__=/"
git -c core.quotePath=false diff --name-only "$BASE_SHA" HEAD | sed "s/^/__CHANGED__=/"
git diff "$BASE_SHA" HEAD > ${CODEX_DIFF_PATH} 2>/dev/null || true
if git diff --quiet "$TURN_BASE_SHA" HEAD; then echo "__NO_TURN_CHANGES__=1"; else echo "__TURN_CHANGED__=1"; fi`

/** Recomputes the credential-free repository config digest before finalization. */
export const VERIFY_GIT_CONFIG_SCRIPT = `set -e
cd ${CODEX_REPO_DIR}
${GIT_CONFIG_DIGEST_LINE}`

/** The only Codex backend command that carries a GitHub token. */
export const PUSH_CODEX_SCRIPT = `cd ${CODEX_REPO_DIR}
/usr/bin/git -c core.hooksPath=/dev/null -c credential.helper= -c core.fsmonitor= push "https://x-access-token:$GITHUB_TOKEN@github.com/$REPO_OWNER/$REPO_NAME.git" "HEAD:refs/heads/$BRANCH" >/dev/null 2>${CODEX_PUSH_ERR_PATH} && echo "__PUSHED__=1"`

/** Computes one Codex turn's timeout from the exact sandbox lifetime requested. */
export function resolveCodexTimeoutMs(
  lifetimeMs = resolveCodexSandboxLifetimeMs(),
  options?: { finalizePhases?: number }
): number {
  const finalizePhases = options?.finalizePhases ?? 2
  const configVerificationReserve = finalizePhases > 0 ? GIT_CONFIG_VERIFY_TIMEOUT_MS : 0
  return Math.min(
    getMaxExecutionTimeout(),
    Math.max(
      lifetimeMs -
        CLONE_TIMEOUT_MS -
        finalizePhases * FINALIZE_TIMEOUT_MS -
        configVerificationReserve,
      MIN_CODEX_TIMEOUT_MS
    )
  )
}

/** Rejects promptly on cancellation; sandbox cleanup terminates the live process. */
export function raceCodexAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new Error('Codex run aborted'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('Codex run aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

interface RunCodexTurnOptions {
  runner: CodexSandboxRunner
  prompt: string
  model: CodexModel
  reasoningEffort: CodexReasoningEffort
  networkAccess: boolean
  apiKey: string
  secrets: readonly string[]
  timeoutMs: number
  threadId?: string
  signal?: AbortSignal
  onEvent: (event: CodexEvent) => void
}

/** Writes the prompt, runs Codex, parses JSONL, and verifies a successful terminal event. */
export async function runCodexTurn(options: RunCodexTurnOptions): Promise<CodexRunTotals> {
  const totals = createCodexTotals()
  const prompt = scrubCodexSecrets(options.prompt, options.secrets)
  await options.runner.writeFile(CODEX_PROMPT_PATH, prompt)

  const exec = buildCodexExecCommand({
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    networkAccess: options.networkAccess,
    threadId: options.threadId,
  })
  let buffer = ''
  let receivedStreamChunk = false
  const handleLine = (line: string) => {
    for (const rawEvent of parseCodexJsonLine(line)) {
      const event = scrubCodexEvent(rawEvent, options.secrets)
      applyCodexEvent(totals, event)
      options.onEvent(event)
    }
  }
  const handleChunk = (chunk: string) => {
    receivedStreamChunk = true
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    lines.forEach(handleLine)
  }

  const result = await raceCodexAbort(
    options.runner.run(exec.command, {
      envs: { ...exec.envs, OPENAI_API_KEY: options.apiKey },
      timeoutMs: options.timeoutMs,
      onStdout: handleChunk,
    }),
    options.signal
  )
  if (receivedStreamChunk) {
    if (buffer.trim()) handleLine(buffer)
  } else {
    result.stdout.split('\n').forEach(handleLine)
  }

  if (result.exitCode !== 0) {
    throw createScrubbedCodexError(
      new Error(
        `Codex agent failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`.trim()
      ),
      options.secrets
    )
  }
  if (totals.errorMessage) throw new Error(`Codex agent failed: ${totals.errorMessage}`)
  if (!totals.turnCompleted) {
    throw new Error('Codex agent exited without a turn.completed event')
  }
  if (!totals.threadId && options.threadId) totals.threadId = options.threadId
  if (!totals.threadId) throw new Error('Codex agent completed without a thread id')
  if (!totals.finalText.trim()) throw new Error('Codex agent completed without a final message')
  return totals
}

/** Validates the GitHub owner/repository slug used in credential-bearing URLs. */
export function validateGitHubRepositoryPart(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value)) {
    throw new Error(`Invalid GitHub ${label}`)
  }
  return value
}

/** Restricts new branch names before they enter git commands. */
export function validateCodexBranchName(value: string): string {
  const invalid =
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value) ||
    value.includes('..') ||
    value.includes('//') ||
    value.includes('@{') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.endsWith('.lock')
  if (invalid) throw new Error('Invalid Codex branch name')
  return value
}
