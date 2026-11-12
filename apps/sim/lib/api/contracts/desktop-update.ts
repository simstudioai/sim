import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const desktopUpdatePlatformSchema = z.enum(['mac', 'windows'])

/** The desktop platforms the update feed serves releases for. */
export type DesktopUpdatePlatform = z.output<typeof desktopUpdatePlatformSchema>

/**
 * Redirects to the newest installer of this deployment's channel for a
 * platform. Public and session-less: it only points at public GitHub release
 * assets. Shells that predate Windows support omit `platform`, so it defaults
 * to `mac`.
 */
export const downloadDesktopUpdateContract = defineRouteContract({
  method: 'GET',
  path: '/api/desktop/update/download',
  query: z.object({
    platform: desktopUpdatePlatformSchema.default('mac'),
  }),
  response: { mode: 'redirect', status: 302 },
})
