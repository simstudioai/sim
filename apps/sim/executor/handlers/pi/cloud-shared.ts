/**
 * Shared helpers for the Create PR and Review Code backends.
 * Keeps E2B path constants, abort racing, marker parsing, and secret scrubbing
 * in one place so the two backends cannot drift on security-sensitive details.
 */

import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { scrubPiSecrets } from '@/executor/handlers/pi/redaction'

export const REPO_DIR = '/workspace/repo'
export const PROMPT_PATH = '/workspace/pi-prompt.txt'
export const CLONE_TIMEOUT_MS = 10 * 60 * 1000
export const PI_TIMEOUT_MS = getMaxExecutionTimeout()

/**
 * The Pi CLI invocation for Create PR. With no extension path it emits exactly what it always did.
 *
 * With one, `--no-extensions` drops any extension the cloned repository ships while leaving the
 * explicit `-e` path loaded, so the loaded set is exactly Sim's own extension. That is deliberate —
 * a repository must not be able to register tools into a run holding the workspace's keys — but it
 * does mean enabling search also stops loading a repository's own Pi extensions, which is why the
 * flag is not passed on the no-search path.
 */
export function buildPiScript(extensionPath?: string): string {
  const extensionArgs = extensionPath ? ` --no-extensions -e ${extensionPath}` : ''
  return `cd ${REPO_DIR}
pi -p --mode json --provider "$PI_PROVIDER" --model "$PI_MODEL" --thinking "$PI_THINKING"${extensionArgs} < ${PROMPT_PATH}`
}

export function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new Error('Pi run aborted'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('Pi run aborted'))
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

export function extractMarkerValues(stdout: string, prefix: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim())
    .filter(Boolean)
}

/**
 * Redacts the GitHub token from git output before it is surfaced in an error.
 * Removes the literal token and any URL userinfo (`//user:token@`), so a failure
 * message can quote git's real stderr without leaking the credential.
 */
export function scrubGitSecrets(text: string, token: string): string {
  const withoutToken = scrubPiSecrets(text, [token])
  return withoutToken.replace(/\/\/[^/@\s]+@/g, '//***@')
}
