/**
 * Vercel builds from a `--depth=10` clone, and `source.config.ts` refuses to date pages from a
 * shallow clone (every file untouched since the boundary commit would get that commit's date), so
 * the docs sitemap shipped with no `lastModified` at all. Fetch the commit history before the
 * build. `--filter=blob:none` skips file contents: `git log --name-only` needs commits and trees.
 * Vercel's clone has no `origin` remote, so the history comes from the public repository URL its
 * system environment names, pinned to the commit being built.
 *
 * A failed fetch leaves the clone shallow, so pages ship undated as before. That is logged rather
 * than failing the deploy, because dates are an enhancement and the docs must still ship.
 */
import { execFileSync } from 'node:child_process'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

/** A build step's outcome belongs in the build log, which the production default (errors only) would hide. */
const logger = createLogger('DocsGitHistory', { logLevel: 'INFO' })

/** Bounds the fetch so a stalled remote costs at most this much of the deployment, never all of it. */
const FETCH_TIMEOUT_MS = 120_000

function git(args: string[], timeout?: number): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  }).trim()
}

const {
  VERCEL,
  VERCEL_GIT_PROVIDER,
  VERCEL_GIT_REPO_OWNER,
  VERCEL_GIT_REPO_SLUG,
  VERCEL_GIT_COMMIT_SHA,
} = process.env

if (VERCEL) {
  try {
    if (git(['rev-parse', '--is-shallow-repository']) === 'true') {
      if (
        VERCEL_GIT_PROVIDER !== 'github' ||
        !VERCEL_GIT_REPO_OWNER ||
        !VERCEL_GIT_REPO_SLUG ||
        !VERCEL_GIT_COMMIT_SHA
      ) {
        throw new Error('Vercel did not provide the GitHub repository and commit for this build')
      }
      const repositoryUrl = `https://github.com/${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}.git`
      git(
        [
          'fetch',
          '--unshallow',
          '--filter=blob:none',
          '--no-tags',
          repositoryUrl,
          VERCEL_GIT_COMMIT_SHA,
        ],
        FETCH_TIMEOUT_MS
      )
      logger.info('Fetched full commit history for docs last-modified dates')
    } else {
      logger.info('Clone already has full commit history')
    }
  } catch (error) {
    logger.warn(
      'Could not fetch commit history; docs pages will ship without last-modified dates',
      {
        error: getErrorMessage(error),
      }
    )
  }
}
