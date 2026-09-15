import { getRequestContext, type RequestAuth } from '@sim/logger'
import type { ResolvedClientInfo } from '@sim/utils/client-info'

/**
 * Who started a piece of work: the client a request came from and the
 * credential it authenticated with. The request context holds these only in
 * memory, so work that leaves the request — a queued job, possibly on another
 * machine — would lose them. Carrying this snapshot on the job and restoring it
 * into the job's own context keeps its logs and analytics attributed to the
 * request that queued it, the way OpenTelemetry baggage rides a message.
 */
export interface RequestAttribution {
  client?: ResolvedClientInfo
  auth?: RequestAuth
}

/**
 * The current request's attribution, for a job it is about to queue. Returns
 * `undefined` outside a request, so a job queued by a trigger carries nothing
 * and is attributed by its trigger instead.
 */
export function captureRequestAttribution(): RequestAttribution | undefined {
  const context = getRequestContext()
  if (!context?.client && !context?.auth) return undefined
  return {
    ...(context.client ? { client: context.client } : {}),
    ...(context.auth ? { auth: context.auth } : {}),
  }
}
