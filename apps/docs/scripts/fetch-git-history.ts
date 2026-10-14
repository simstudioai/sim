/**
 * Vercel builds from a `--depth=10` clone, and `source.config.ts` refuses to date pages from a
 * shallow clone (every file untouched since the boundary commit would get that commit's date), so
 * the docs sitemap shipped with no `lastModified` at all. Fetch the commit history before the
 * build. `--filter=blob:none` skips file contents: `git log --name-only` needs commits and trees.
 *
 * A failed fetch leaves the clone shallow, so pages ship undated as before. That is logged rather
 * than failing the deploy, because dates are an enhancement and the docs must still ship.
 */
import { execFileSync } from 'node:child_process'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('DocsGitHistory')

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

if (process.env.VERCEL) {
  try {
    if (git(['rev-parse', '--is-shallow-repository']) === 'true') {
      git(['fetch', '--unshallow', '--filter=blob:none', '--no-tags', 'origin'])
      logger.info('Fetched full commit history for docs last-modified dates')
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
