import { type NextRequest, NextResponse } from 'next/server'
import { downloadDesktopUpdateContract } from '@/lib/api/contracts/desktop-update'
import { parseRequest } from '@/lib/api/server'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  DESKTOP_FEED_REVALIDATE_SECONDS,
  resolveDeploymentRelease,
} from '@/lib/desktop/update-feed'
import { feedErrorResponse } from '@/app/api/desktop/update/manifest-feed'

/**
 * Redirects to the platform's installer for the newest release of this
 * deployment's channel (see `lib/desktop/update-feed.ts`).
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
export const GET = withRouteHandler(async (request: NextRequest): Promise<Response> => {
  const parsed = await parseRequest(downloadDesktopUpdateContract, request, {})
  if (!parsed.success) return parsed.response

  const resolved = await resolveDeploymentRelease({
    environment: env.APPCONFIG_ENVIRONMENT,
    githubToken: env.GITHUB_TOKEN,
    platform: parsed.data.query.platform,
  })
  if (resolved.status !== 'release') return feedErrorResponse(resolved, 'installer')
  return NextResponse.redirect(resolved.assets.installer.browser_download_url, {
    status: 302,
    headers: { 'cache-control': `public, max-age=${DESKTOP_FEED_REVALIDATE_SECONDS}` },
  })
})
