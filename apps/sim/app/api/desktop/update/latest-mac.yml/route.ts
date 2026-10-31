import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { serveDesktopUpdateManifest } from '@/app/api/desktop/update/manifest-feed'

/** The macOS update manifest (see `manifest-feed.ts`). */
export const GET = withRouteHandler(
  async (): Promise<Response> => serveDesktopUpdateManifest('mac')
)
