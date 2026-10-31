import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * A site's icon by hostname: image bytes, or 404 when none can be served — neither the host nor
 * a parent has one, the host is internal, or the providers are unavailable.
 */
export const getFaviconContract = defineRouteContract({
  method: 'GET',
  path: '/api/favicon',
  query: z.object({
    host: z
      .string()
      .trim()
      .min(1, 'host is required')
      .max(253, 'host must be 253 characters or less'),
  }),
  response: { mode: 'binary' },
})
