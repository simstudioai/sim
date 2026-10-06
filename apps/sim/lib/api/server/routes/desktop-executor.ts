import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes/internal-json-route'
import {
  DesktopCallRevokedError,
  DesktopDeviceUnrecognizedError,
} from '@/lib/desktop/executor/errors'

/**
 * A device's unrecognized binding is a 401, so it registers again; a call taken away from its
 * token is a 410, so it stops the local action.
 */
export const desktopExecutorErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    if (error instanceof DesktopDeviceUnrecognizedError)
      return internalErrorResponse(401, { error: error.message })
    if (error instanceof DesktopCallRevokedError)
      return internalErrorResponse(410, { error: error.message })
    return null
  }
)

/**
 * One busy device renews a lease per running call every 20 s and pulls its inbox on every
 * doorbell, so the bucket allows a sustained 10 requests a second per user.
 */
export const desktopExecutorRateLimit = internalRateLimits.user({
  bucketName: 'desktop-executor',
  config: { maxTokens: 600, refillRate: 600, refillIntervalMs: 60_000 },
})
