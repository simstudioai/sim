/**
 * Filesystem contract shared by every layer that touches a sandbox mount: the
 * resolver that plans mount paths, the sandbox layer that creates the output
 * directory and enumerates it, and the tool description that teaches a model
 * where to write.
 *
 * Deliberately under `/tmp` rather than a home directory. E2B's default user is
 * `user` with workdir `/home/user`, but the Daytona image is built from
 * `python:3.13-slim-trixie` with no `useradd`, `USER`, or `WORKDIR`, so
 * `/home/user` does not exist there and Daytona resolves relative paths against
 * its own working directory. `/tmp` is present and writable by any user on any
 * Linux image, which keeps one literal correct on both providers — and lets the
 * tool description name that literal to the model instead of a path that has to
 * be resolved per provider before it can be quoted.
 */

/**
 * Where mounted input files are materialized before user code runs.
 *
 * Both directories sit under `/tmp/sim/`, while the runtime's own scratch files
 * (`/tmp/.sim-private-input-*`, `/tmp/.sim-env-*`, `/tmp/.sim-command-*`) are
 * dotfiles at the `/tmp` root — so enumerating the output directory cannot reach
 * them.
 */
export const SANDBOX_INPUT_DIR = '/tmp/sim/inputs'

/** One-shot exports use this directory; persistent workbenches allocate per-call children. */
export const SANDBOX_OUTPUT_DIR = '/tmp/sim/outputs'

/**
 * Sentinel written to bring the output directory into existence before user code
 * runs, and skipped when the directory is harvested.
 *
 * A directory cannot be created through the providers' filesystem APIs directly,
 * but writing a file creates its parents — the same trick the Copilot directory
 * mount already uses to materialize an empty folder. Doing it this way keeps the
 * cost at one filesystem write; a `mkdir -p` command would instead cost a whole
 * session on Daytona, which creates and tears one down per command.
 *
 * The suffix is not decoration: the harvest filters this name out, so a plainer
 * one like `.sim-keep` would silently swallow a user file that happened to share
 * it.
 */
export const SANDBOX_OUTPUT_DIR_SENTINEL = '.sim-keep-97f2c1a4'

/**
 * How deep the output directory is enumerated, counted in path segments — a file
 * at `a/b/leaf.txt` is depth 3.
 *
 * Set far above any plausible layout rather than close to it, because the
 * providers' listings take a depth and give no signal that they stopped. A file
 * below the limit is one the code successfully wrote and the caller never
 * receives, so the harvest also refuses outright when it sees a directory
 * sitting at the limit — that entry is the evidence the listing was cut short.
 */
export const SANDBOX_OUTPUT_DIR_MAX_DEPTH = 12

/**
 * How many files one Function block invocation may mount. Far below the Copilot
 * ceiling: a block names its inputs one at a time, so a large count is a mistake
 * rather than a legitimate bulk mount.
 *
 * Lives here, with the other mount bounds, because the boundary contract needs it
 * too — and this module imports nothing, so a contract can read it without
 * pulling the server-only mount resolver into a client-reachable graph.
 */
export const MAX_BLOCK_MOUNTED_FILES = 20

/** Trailing-slash-insensitive directory prefix, for joining and stripping. */
function withTrailingSlash(dir: string): string {
  return dir.endsWith('/') ? dir : `${dir}/`
}

/**
 * Resolves one provider directory entry to an absolute path plus its path
 * relative to the listed directory.
 *
 * Providers disagree on whether a listing reports absolute or directory-relative
 * paths, and Daytona resolves relative paths against its own working directory
 * rather than the listed one — so a relative entry is joined to the directory we
 * asked for instead of being trusted as-is. Returns null when the result escapes
 * that directory, which is what keeps a `..` component in a provider-reported
 * name from reaching a reader.
 */
export function resolveSandboxDirectoryEntryPath(
  dir: string,
  reportedPath: string
): { path: string; relativePath: string } | null {
  const prefix = withTrailingSlash(dir)
  const absolute = reportedPath.startsWith('/') ? reportedPath : `${prefix}${reportedPath}`

  const segments: string[] = []
  for (const segment of absolute.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  const normalized = `/${segments.join('/')}`

  if (!normalized.startsWith(prefix)) return null
  return { path: normalized, relativePath: normalized.slice(prefix.length) }
}
