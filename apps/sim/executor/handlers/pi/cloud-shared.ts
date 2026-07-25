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
 * Floor for {@link PI_TIMEOUT_MS}. Only reachable by configuring a sandbox
 * lifetime too short to reserve every surrounding command's worst-case ceiling.
 * Such a run can still finish, since those ceilings are pessimistic, so the floor
 * leaves a short turn rather than refusing one.
 */
const MIN_PI_TIMEOUT_MS = 60 * 1000

/**
 * How long one Pi CLI invocation may run. The platform's max execution timeout
 * outlives the sandbox, so without this a hung CLI would sit there until E2B
 * reaped the sandbox and surface as an opaque SDK error.
 *
 * The reserve matters as much as the cap. The sandbox clock starts at create,
 * and three commands bracket the agent turn: the clone before it, then the
 * commit and the push after it, the last two sharing
 * {@link FINALIZE_TIMEOUT_MS}. Capping at the bare lifetime would mean the
 * sandbox always died first, taking the agent's finished work with it unpushed.
 *
 * What is reserved is each command's timeout ceiling, not its measured elapsed
 * time — a clone takes seconds in practice — so this is a budget that adds up,
 * not a guarantee that the sandbox outlives the run.
 */
export const PI_TIMEOUT_MS = Math.min(
  getMaxExecutionTimeout(),
  Math.max(
    resolvePiSandboxLifetimeMs() - CLONE_TIMEOUT_MS - 2 * FINALIZE_TIMEOUT_MS,
    MIN_PI_TIMEOUT_MS
  )
)

/**
 * Marker carrying a digest of the cloned repository's git config. A clone script
 * emits it as its *last* line, after any `git remote set-url` rewrite — a digest
 * taken before that rewrite mismatches at push time and every push fails.
 *
 * Every mode that clones in order to push emits it. No mode verifies it yet;
 * Babysit will, and deliberately alone, because verification is not a pure
 * tightening — a run that legitimately writes repo-local config would fail its
 * push.
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
 * its env, which the `-c` flags cannot substitute for.
 *
 * Be precise about what that pair buys. It closes system- and global-scope
 * config, so it removes two of the three places a `url.*.insteadOf` rewrite
 * could send the token's userinfo to another host. Repository-local config —
 * the scope a root agent inside the checkout can actually write — still
 * rewrites the push URL, and stays open until a mode compares the
 * {@link GIT_CONFIG_DIGEST_MARKER} digest before pushing. No mode does yet;
 * Babysit will, and Create PR will not, keeping the exposure it always had.
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
