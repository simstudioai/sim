/**
 * Shared helpers for the Pi sandbox backends.
 * Keeps E2B path constants, the finalize/push scripts, abort racing, marker
 * parsing, and secret scrubbing in one place so the backends cannot drift on
 * security-sensitive details.
 */

import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { resolvePiSandboxLifetimeMs } from '@/lib/execution/remote-sandbox/pi-lifetime'
import { scrubPiSecrets } from '@/executor/handlers/pi/redaction'

export const REPO_DIR = '/workspace/repo'
export const PROMPT_PATH = '/workspace/pi-prompt.txt'
export const DIFF_PATH = '/workspace/pi.diff'
export const COMMIT_MSG_PATH = '/workspace/pi-commit.txt'
export const PUSH_ERR_PATH = '/workspace/pi-push-err.txt'
export const CLONE_TIMEOUT_MS = 10 * 60 * 1000
export const FINALIZE_TIMEOUT_MS = 10 * 60 * 1000
export const MAX_DIFF_BYTES = 200_000
export const PUSH_ERROR_MAX = 1000

/**
 * How long one Pi CLI invocation may run. Bounded by the sandbox lifetime: the
 * platform's max execution timeout is longer, so an uncapped hung CLI would sit
 * there until the sandbox was reaped and surface as an opaque SDK error rather
 * than as a timeout. The sandbox clock starts at create and the clone runs
 * first, so this bounds the command rather than guaranteeing it times out.
 */
export const PI_TIMEOUT_MS = Math.min(getMaxExecutionTimeout(), resolvePiSandboxLifetimeMs())

/**
 * Marker carrying a digest of the cloned repository's git config. A clone script
 * emits it as its *last* line, after any `git remote set-url` rewrite — a digest
 * taken before that rewrite mismatches at push time and every push fails.
 *
 * Every mode that clones in order to push emits it; only Babysit re-verifies it
 * before pushing, because verification is not a pure tightening: a run that
 * legitimately writes repo-local config would fail its push.
 */
export const GIT_CONFIG_DIGEST_MARKER = '__GIT_CONFIG_DIGEST__='

/**
 * Digests the only git-config scope a sandbox agent can still write once
 * `GIT_CONFIG_NOSYSTEM` and `GIT_CONFIG_GLOBAL` neutralize the system and global
 * scopes. One comparison covers every dangerous key — `url.*.insteadOf`,
 * `url.*.pushInsteadOf`, `http.proxy`, `core.sshCommand`, `include.path` —
 * including keys nobody enumerated. Runs with the repository as its working
 * directory, and tolerates a missing `.git/config.worktree`.
 */
export const GIT_CONFIG_DIGEST_LINE = `cat .git/config .git/config.worktree 2>/dev/null | sha256sum | cut -d' ' -f1 | sed "s/^/${GIT_CONFIG_DIGEST_MARKER}/"`

/**
 * Stages, commits, and diffs without the GitHub token because repository config
 * can execute filters, fsmonitor, external diffs, or textconv during these git
 * operations. Commit tolerates an empty tree; the marker checks whether HEAD
 * advanced before the separately authenticated push.
 */
export const PREPARE_SCRIPT = `set -e
cd ${REPO_DIR}
git -c core.hooksPath=/dev/null add -A
git -c core.hooksPath=/dev/null -c user.email="pi@sim.ai" -c user.name="Sim Pi Agent" commit -F ${COMMIT_MSG_PATH} >/dev/null 2>&1 || true
git diff --name-only "$BASE_SHA" HEAD | sed "s/^/__CHANGED__=/"
git diff "$BASE_SHA" HEAD > ${DIFF_PATH} 2>/dev/null || true
if git diff --quiet "$BASE_SHA" HEAD; then echo "__NO_CHANGES__=1"; else echo "__NEEDS_PUSH__=1"; fi`

/**
 * The only token-bearing command. It neutralizes repository-configured hooks,
 * credential helpers, and fsmonitor before pushing agent-authored changes, and
 * must be run with `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL=/dev/null` in
 * its env — those cover config-driven URL rewriting, which would send the
 * token's userinfo to another host and which the `-c` flags do not reach.
 *
 * Git is invoked by absolute path so a shim planted earlier on `$PATH` is not
 * what runs. Both sandbox images apt-install git on Debian (see
 * `scripts/pi-sandbox-packages.ts`), so this is an image-shape dependency. It
 * reduces rather than removes exposure — every sandbox command runs as root, so
 * the binary itself is writable too.
 *
 * The refspec is explicit: `HEAD:refs/heads/$BRANCH` pushes the commit that was
 * just verified rather than whatever the local branch ref happens to point at,
 * which differ if the agent left HEAD detached or on another branch.
 */
export const PUSH_SCRIPT = `cd ${REPO_DIR}
/usr/bin/git -c core.hooksPath=/dev/null -c credential.helper= -c core.fsmonitor= push "https://x-access-token:$GITHUB_TOKEN@github.com/$REPO_OWNER/$REPO_NAME.git" "HEAD:refs/heads/$BRANCH" >/dev/null 2>${PUSH_ERR_PATH} && echo "__PUSHED__=1"`

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
