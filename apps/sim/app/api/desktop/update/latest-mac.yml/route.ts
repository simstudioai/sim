import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  channelForHostname,
  DESKTOP_RELEASE_REPO,
  type DesktopReleaseCandidate,
  manifestAssetName,
  rewriteManifestUrls,
  selectReleaseForChannel,
} from '@/lib/desktop/update-feed'

const logger = createLogger('DesktopUpdateFeedAPI')

/**
 * How long a resolved feed may be stale. A fresh release becomes visible to
 * shells within this window (their own check cadence is hours anyway).
 */
const REVALIDATE_SECONDS = 300

const RELEASES_API_URL = `https://api.github.com/repos/${DESKTOP_RELEASE_REPO}/releases?per_page=30`

/**
 * The per-environment desktop update feed (see `lib/desktop/update-feed.ts`).
 *
 * electron-updater's generic provider on installed shells requests this
 * exact path from the origin the shell is pointed at. The route is public by
 * design: the updater's HTTP client carries no session, and the response
 * only describes public GitHub release artifacts.
 */
export const GET = withRouteHandler(async (): Promise<Response> => {
  const hostname = new URL(env.NEXT_PUBLIC_APP_URL).hostname
  const channel = channelForHostname(hostname)

  const releasesResponse = await fetch(RELEASES_API_URL, {
    headers: { accept: 'application/vnd.github+json' },
    next: { revalidate: REVALIDATE_SECONDS },
  })
  if (!releasesResponse.ok) {
    logger.error('GitHub releases lookup failed', {
      status: releasesResponse.status,
      channel,
    })
    return NextResponse.json({ error: 'Release feed unavailable' }, { status: 502 })
  }
  const releases = (await releasesResponse.json()) as Array<
    DesktopReleaseCandidate & {
      assets?: Array<{ name: string; browser_download_url: string }>
    }
  >

  const release = selectReleaseForChannel(releases, channel)
  if (!release) {
    return NextResponse.json(
      { error: `No desktop release for channel ${channel}` },
      { status: 404 }
    )
  }

  const manifestName = manifestAssetName(release.tag_name.replace(/^v/, ''))
  const asset = releases
    .find((candidate) => candidate.tag_name === release.tag_name)
    ?.assets?.find((candidate) => candidate.name === manifestName)
  if (!asset) {
    logger.error('Release is missing its updater manifest', {
      tag: release.tag_name,
      manifest: manifestName,
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
  const manifest = rewriteManifestUrls(await manifestResponse.text(), release.tag_name)

  return new NextResponse(manifest, {
    status: 200,
    headers: {
      'content-type': 'text/yaml; charset=utf-8',
      'cache-control': `public, max-age=${REVALIDATE_SECONDS}`,
    },
  })
})
