import { db } from '@sim/db'
import { appProject } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { abuseSessionContract } from '@/lib/api/contracts/apps'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { issueAppsAbuseToken } from '@/lib/apps/abuse-token'
import { requireAppsHopFromRequest } from '@/lib/apps/hop-proof'
import { getAppOriginStatus } from '@/lib/apps/origin'
import { enforceAppsIpRateLimit } from '@/lib/apps/rate-limit'
import { isProd } from '@/lib/core/config/env-flags'
import { isTurnstileConfigured, verifyTurnstileToken } from '@/lib/core/security/turnstile'
import { getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const hop = await requireAppsHopFromRequest(request)
  if (!hop.ok) return createErrorResponse(hop.message, hop.status)

  const ipLimit = await enforceAppsIpRateLimit('abuse-session', request)
  if (ipLimit) return ipLimit

  const parsed = await parseRequest(
    abuseSessionContract,
    request,
    {},
    {
      validationErrorResponse: (error) =>
        createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
    }
  )
  if (!parsed.success) return parsed.response

  const { publicId, turnstileToken, visitorId } = parsed.data.body

  const [project] = await db
    .select({ id: appProject.id, publicId: appProject.publicId })
    .from(appProject)
    .where(and(eq(appProject.publicId, publicId), isNull(appProject.archivedAt)))
    .limit(1)

  if (!project) {
    return createErrorResponse('App not found', 404)
  }

  // Production fails closed without Turnstile. Local/dev may issue tokens when
  // TURNSTILE_* is unset so fixture consoles still work.
  if (!isTurnstileConfigured()) {
    if (isProd) {
      return createErrorResponse(
        'Abuse protection is not configured',
        503,
        'TURNSTILE_NOT_CONFIGURED'
      )
    }
  } else {
    if (!turnstileToken) {
      return createErrorResponse('Captcha verification required', 403, 'TURNSTILE_REQUIRED')
    }
    const origin = getAppOriginStatus()
    const expectedHostname = origin.enabled ? new URL(origin.appPublicOrigin).hostname : undefined
    const verified = await verifyTurnstileToken({
      token: turnstileToken,
      remoteIp: getClientIp(request),
      expectedHostname,
    })
    if (!verified.success) {
      if (verified.transportError) {
        return createErrorResponse(
          'Abuse protection is temporarily unavailable',
          503,
          'ABUSE_PROTECTION_UNAVAILABLE'
        )
      }
      return createErrorResponse('Captcha verification failed', 403, 'TURNSTILE_FAILED')
    }
  }

  const token = issueAppsAbuseToken(publicId, visitorId)
  return createSuccessResponse({ abuseToken: token, expiresInSeconds: 30 * 60 })
})
