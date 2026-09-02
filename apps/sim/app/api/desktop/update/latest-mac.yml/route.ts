import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  channelForDeploymentEnvironment,
  type DesktopReleaseCandidate,
  MANIFEST_ASSET_NAME,
  MAX_DESKTOP_UPDATE_MANIFEST_BYTES,
  releaseRepositoryForChannel,
  releasesApiUrl,
  resolveLatestRelease,
  rewriteManifestUrls,
} from '@/lib/desktop/update-feed'

const logger = createLogger('DesktopUpdateFeedAPI')

/**
 * How long a resolved feed may be stale. A fresh release becomes visible to
 * shells within this window (their own check cadence is hours anyway).
 */
const REVALIDATE_SECONDS = 300
const FEED_STATUS_HEADER = 'x-sim-desktop-update-feed'

/**
 * The per-environment desktop update feed (see `lib/desktop/update-feed.ts`).
 *
 * electron-updater's generic provider on installed shells requests this
 * exact path from the origin the shell is pointed at. The route is public by
 * design: the updater's HTTP client carries no session, and the response
 * only describes public GitHub release artifacts.
 */
export const GET = withRouteHandler(async (_request: NextRequest): Promise<Response> => {
  /**
   * Hosted deployments inject APPCONFIG_ENVIRONMENT independently at runtime,
   * so it stays correct when the same image is promoted across environments.
   * Request host headers are intentionally excluded: this public route must not
   * let a caller choose which app-identity release the feed serves.
   */
  const channel = channelForDeploymentEnvironment(env.APPCONFIG_ENVIRONMENT)
  const releaseRepository = releaseRepositoryForChannel(channel)

  // A token raises the GitHub API quota from 60/h per NAT IP to 5000/h.
  // Optional: the repo is public, so the feed works without one.
  const githubToken = env.GITHUB_TOKEN
  const resolved = await resolveLatestRelease(channel, async (page) => {
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
  })
  if ('error' in resolved) {
    return NextResponse.json({ error: 'Release feed unavailable' }, { status: 502 })
  }

  const release = resolved.release
  if (!release) {
    return NextResponse.json(
      { error: `No desktop release for channel ${channel}` },
      {
        status: 404,
        headers: { [FEED_STATUS_HEADER]: 'no-release' },
      }
    )
  }

  const asset = release.assets?.find((candidate) => candidate.name === MANIFEST_ASSET_NAME)
  if (!asset) {
    logger.error('Release is missing its updater manifest', {
      tag: release.tag_name,
      channel,
    })
    return NextResponse.json({ error: 'Release manifest unavailable' }, { status: 404 })
  }

  const manifestResponse = await fetch(asset.browser_download_url, {
    next: { revalidate: REVALIDATE_SECONDS },
  })
  if (!manifestResponse.ok) {
    logger.error('Updater manifest download failed', {
      status: manifestResponse.status,
      tag: release.tag_name,
    })
    return NextResponse.json({ error: 'Release manifest unavailable' }, { status: 502 })
  }
  let manifestSource: string
  try {
    manifestSource = await readResponseTextWithLimit(manifestResponse, {
      maxBytes: MAX_DESKTOP_UPDATE_MANIFEST_BYTES,
      label: 'Desktop update manifest',
    })
  } catch (error) {
    logger.error('Updater manifest could not be read safely', {
      tag: release.tag_name,
      message: getErrorMessage(error),
    })
    return NextResponse.json({ error: 'Release manifest unavailable' }, { status: 502 })
  }
  const manifestVersion = /^version:\s*(\S+)\s*$/m.exec(manifestSource)?.[1]
  const releaseVersion = release.tag_name.replace(/^v/, '')
  if (manifestVersion !== releaseVersion) {
    logger.error('Updater manifest version does not match its release', {
      tag: release.tag_name,
      manifestVersion,
    })
    return NextResponse.json({ error: 'Release manifest unavailable' }, { status: 502 })
  }
  const manifest = rewriteManifestUrls(manifestSource, release.tag_name, releaseRepository)
  if (!manifest) {
    logger.error('Updater manifest referenced an unexpected artifact', {
      tag: release.tag_name,
    })
    return NextResponse.json({ error: 'Release manifest unavailable' }, { status: 502 })
  }

  return new NextResponse(manifest, {
    status: 200,
    headers: {
      'content-type': 'text/yaml; charset=utf-8',
      'cache-control': `public, max-age=${REVALIDATE_SECONDS}`,
      [FEED_STATUS_HEADER]: 'release',
    },
  })
})
