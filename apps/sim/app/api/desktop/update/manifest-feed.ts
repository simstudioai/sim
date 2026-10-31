import { NextResponse } from 'next/server'
import type { DesktopUpdatePlatform } from '@/lib/api/contracts/desktop-update'
import { env } from '@/lib/core/config/env'
import {
  DESKTOP_FEED_REVALIDATE_SECONDS,
  type DesktopFeedResolution,
  resolveDeploymentRelease,
} from '@/lib/desktop/update-feed'

const FEED_STATUS_HEADER = 'x-sim-desktop-update-feed'

/**
 * Serves a platform's electron-updater manifest for this deployment's channel
 * (see `lib/desktop/update-feed.ts`), shared by `latest-mac.yml` and
 * `latest.yml`.
 *
 * electron-updater's generic provider on installed shells requests these exact
 * paths from the origin the shell is pointed at. The routes are public by
 * design: the updater's HTTP client carries no session, and the response only
 * describes public GitHub release artifacts.
 *
 * A 404 tagged `no-release` tells the shell the channel has nothing for its
 * platform yet; a 502 means releases exist but none can be offered.
 */
export async function serveDesktopUpdateManifest(
  platform: DesktopUpdatePlatform
): Promise<Response> {
  // Hosted deployments inject APPCONFIG_ENVIRONMENT independently at runtime,
  // so it stays correct when the same image is promoted across environments.
  const resolved = await resolveDeploymentRelease({
    environment: env.APPCONFIG_ENVIRONMENT,
    githubToken: env.GITHUB_TOKEN,
    platform,
  })
  if (resolved.status !== 'release') {
    return feedErrorResponse(resolved, 'manifest', { [FEED_STATUS_HEADER]: 'no-release' })
  }
  return new NextResponse(resolved.assets.manifest, {
    status: 200,
    headers: {
      'content-type': 'text/yaml; charset=utf-8',
      'cache-control': `public, max-age=${DESKTOP_FEED_REVALIDATE_SECONDS}`,
      [FEED_STATUS_HEADER]: 'release',
    },
  })
}

/**
 * The response to a feed with no release to offer: 502 when GitHub could not be read or no
 * release carries a valid `artifact`, 404 (with `noReleaseHeaders`) when the channel has none.
 */
export function feedErrorResponse(
  resolved: Exclude<DesktopFeedResolution, { status: 'release' }>,
  artifact: 'installer' | 'manifest',
  noReleaseHeaders?: Record<string, string>
): NextResponse {
  switch (resolved.status) {
    case 'unavailable':
      return NextResponse.json({ error: 'Release feed unavailable' }, { status: 502 })
    case 'invalid':
      return NextResponse.json({ error: `Release ${artifact} unavailable` }, { status: 502 })
    case 'no-release':
      return NextResponse.json(
        { error: `No desktop release for channel ${resolved.channel}` },
        { status: 404, headers: noReleaseHeaders }
      )
  }
}
