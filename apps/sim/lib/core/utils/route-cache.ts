import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('RouteCache')

const BUILD_MARKER = '.build-id'

/**
 * Clears Next's route cache when it was written by a different build. Its keys carry no build
 * id, and the image declares the directory a volume, so a container recreated from a newer
 * image would otherwise serve pages the old build rendered, pointing at chunks it no longer
 * ships. Never throws: a cache that cannot be read or cleared is left to Next, with a warning
 * unless there was simply no build id or cache to read.
 */
export async function clearRouteCacheFromOtherBuild(nextDirectory: string): Promise<void> {
  const routeCache = join(nextDirectory, 'server', 'route-cache')
  try {
    const buildId = (await readFile(join(nextDirectory, 'BUILD_ID'), 'utf8')).trim()
    if (!buildId) return
    const cachedBuildId = await readFile(join(routeCache, BUILD_MARKER), 'utf8').catch(() => null)
    if (cachedBuildId?.trim() === buildId) return
    const entries = await readdir(routeCache)
    await Promise.all(
      entries.map((entry) => rm(join(routeCache, entry), { recursive: true, force: true }))
    )
    await writeFile(join(routeCache, BUILD_MARKER), buildId)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    logger.error('Could not clear the route cache from an earlier build', {
      error: getErrorMessage(error),
    })
  }
}
