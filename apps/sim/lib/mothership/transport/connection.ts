import { createHmac } from 'node:crypto'
import { env } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/env-flags'
import type { SimConnection } from '@/lib/mothership/generated/sim-transport'

/** Server-owned topology; no browser or model input chooses a callback destination. */
export function getSimConnection(): SimConnection {
  const mode = env.MOTHERSHIP_SIM_TRANSPORT ?? (isHosted ? 'direct' : 'checkpoint')
  if (mode === 'direct') return { mode }
  return {
    mode,
    channelId: createHmac('sha256', env.INTERNAL_API_SECRET)
      .update('mothership:sim-transport:v1')
      .digest('hex'),
  }
}
