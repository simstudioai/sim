import { NextResponse } from 'next/server'
import type { DesktopUpdatePlatform } from '@/lib/api/contracts/desktop-update'
import { env } from '@/lib/core/config/env'
import {
  DESKTOP_FEED_REVALIDATE_SECONDS,
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
    select: (assets) => assets.manifest,
  })
  switch (resolved.status) {
    case 'unavailable':
      return NextResponse.json({ error: 'Release feed unavailable' }, { status: 502 })
    case 'invalid':
      return NextResponse.json({ error: 'Release manifest unavailable' }, { status: 502 })
    case 'no-release':
      return NextResponse.json(
        { error: `No desktop release for channel ${resolved.channel}` },
        { status: 404, headers: { [FEED_STATUS_HEADER]: 'no-release' } }
      )
    case 'release':
      return new NextResponse(resolved.value, {
        status: 200,
        headers: {
          'content-type': 'text/yaml; charset=utf-8',
          'cache-control': `public, max-age=${DESKTOP_FEED_REVALIDATE_SECONDS}`,
          [FEED_STATUS_HEADER]: 'release',
        },
      })
  }
}
