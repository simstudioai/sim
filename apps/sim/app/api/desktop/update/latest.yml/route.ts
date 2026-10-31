import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { serveDesktopUpdateManifest } from '@/app/api/desktop/update/manifest-feed'

/** The Windows update manifest electron-updater's NSIS updater requests (see `manifest-feed.ts`). */
export const GET = withRouteHandler(
  async (): Promise<Response> => serveDesktopUpdateManifest('windows')
)
