import { type NextRequest, NextResponse } from 'next/server'
import { getDeploymentEnv } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getBrandConfig, ICON_SETS } from '@/ee/whitelabeling'

export const dynamic = 'force-dynamic'

/**
 * Redirect target for the legacy `/favicon.ico` path (rewritten here in
 * `next.config.ts`), resolved per-request rather than baked into
 * `next.config.ts`'s `rewrites()` directly. This app's Docker image is built
 * once with dummy env values and promoted through dev/staging/production —
 * `bootstrap.ts` hydrates `process.env` from AWS Secrets Manager at container
 * boot, after the build already ran (`docker/app.Dockerfile`) — so a
 * same-process-lifetime decision like `getDeploymentEnv()` must be evaluated
 * here, at request time, not in `next.config.ts`, which only runs once during
 * that shared build and would freeze whichever tier happened to be active
 * then (never the tier the container actually ends up running as).
 *
 * Reuses {@link ICON_SETS} from `ee/whitelabeling/metadata.ts` rather than
 * maintaining a second env-to-path map here, so the two can't drift apart. A
 * whitelabeled deployment's own favicon always wins here too, matching
 * `generateBrandedMetadata()` — a tenant on a dev/staging environment should
 * never see Sim's internal tinted mark.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const brand = getBrandConfig()
  const destination = brand.faviconUrl || ICON_SETS[getDeploymentEnv()].svg
  return NextResponse.redirect(new URL(destination, request.url))
})
