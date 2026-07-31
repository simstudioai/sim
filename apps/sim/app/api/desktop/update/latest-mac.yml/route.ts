import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  channelForHostname,
  DESKTOP_RELEASE_REPO,
  type DesktopReleaseCandidate,
  MANIFEST_ASSET_NAME,
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

  // A token raises the GitHub API quota from 60/h per NAT IP to 5000/h.
  // Optional: the repo is public, so the feed works without one.
  const githubToken = process.env.GITHUB_TOKEN
  const releasesResponse = await fetch(RELEASES_API_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
    },
    next: { revalidate: REVALIDATE_SECONDS },
  })
  if (!releasesResponse.ok) {
    logger.error('GitHub releases lookup failed', {
      status: releasesResponse.status,
      channel,
    })
    return NextResponse.json({ error: 'Release feed unavailable' }, { status: 502 })
  }
  const releases = (await releasesResponse.json()) as DesktopReleaseCandidate[]

  const release = selectReleaseForChannel(releases, channel)
  if (!release) {
    return NextResponse.json(
      { error: `No desktop release for channel ${channel}` },
      { status: 404 }
    )
  }

  const asset = release.assets?.find((candidate) => candidate.name === MANIFEST_ASSET_NAME)
  if (!asset) {
    // selectReleaseForChannel already skips assetless releases, so this only
    // fires when the API response omitted assets entirely.
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
  const manifest = rewriteManifestUrls(await manifestResponse.text(), release.tag_name)

  return new NextResponse(manifest, {
    status: 200,
    headers: {
      'content-type': 'text/yaml; charset=utf-8',
      'cache-control': `public, max-age=${REVALIDATE_SECONDS}`,
    },
  })
})
