import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  channelForDeploymentEnvironment,
  type DesktopReleaseCandidate,
  releaseRepositoryForChannel,
  releasesApiUrl,
  resolveLatestRelease,
  resolveReleaseAssets,
} from '@/lib/desktop/update-feed'

const logger = createLogger('DesktopUpdateDownloadAPI')

/** Matches the manifest feed so both paths resolve the same release. */
const REVALIDATE_SECONDS = 300

/**
 * Redirects to the installer for the newest release of this deployment's
 * channel (see `lib/desktop/update-feed.ts`).
 *
 * This is the manual escape hatch behind the blocking update gate: shells too
 * old to expose the updater bridge send the user here instead of
 * self-updating. It resolves through the same channel selection as the
 * manifest feed, so a manual download lands on exactly the build
 * electron-updater would have installed — never an intermediate version, and
 * never a repository release carrying no desktop artifact.
 *
 * Public by the same reasoning as the manifest feed: it only points at public
 * GitHub release assets.
 */
export const GET = withRouteHandler(async (_request: NextRequest): Promise<Response> => {
  const channel = channelForDeploymentEnvironment(env.APPCONFIG_ENVIRONMENT)
  const releaseRepository = releaseRepositoryForChannel(channel)

  const githubToken = env.GITHUB_TOKEN
  const resolved = await resolveLatestRelease(
    channel,
    async (page) => {
      try {
        const response = await fetch(releasesApiUrl(releaseRepository, page), {
          headers: {
            accept: 'application/vnd.github+json',
            ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
          },
          next: { revalidate: REVALIDATE_SECONDS },
        })
        if (!response.ok) {
          logger.error('GitHub releases lookup failed', {
            status: response.status,
            page,
            channel,
            releaseRepository,
          })
          return null
        }
        return (await response.json()) as DesktopReleaseCandidate[]
      } catch (error) {
        logger.error('GitHub releases response could not be read', {
          message: getErrorMessage(error),
          page,
          channel,
          releaseRepository,
        })
        return null
      }
    },
    async (release) => {
      const assets = await resolveReleaseAssets(release, releaseRepository, (url) =>
        fetch(url, {
          next: { revalidate: REVALIDATE_SECONDS },
        })
      )
      if (!assets) {
        logger.warn('Skipping incomplete or invalid desktop release', {
          tag: release.tag_name,
          channel,
        })
      }
      return assets?.installer ?? null
    }
  )
  if ('error' in resolved) {
    return NextResponse.json({ error: 'Release feed unavailable' }, { status: 502 })
  }

  if (!resolved.release) {
    return NextResponse.json(
      { error: `No desktop release for channel ${channel}` },
      { status: 404 }
    )
  }

  return NextResponse.redirect(resolved.value.browser_download_url, {
    status: 302,
    headers: { 'cache-control': `public, max-age=${REVALIDATE_SECONDS}` },
  })
})
