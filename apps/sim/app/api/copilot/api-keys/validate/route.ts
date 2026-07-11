import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { validateCopilotApiKeyContract } from '@/lib/api/contracts/copilot'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import {
  checkOrgMemberUsageLimit,
  checkServerSideUsageLimits,
} from '@/lib/billing/calculations/usage-monitor'
import {
  type BillingAttributionSnapshot,
  billingAttributionsEqual,
  checkAttributedUsageLimits,
  requireBillingAttributionHeader,
  requireBillingRequestIdHeader,
} from '@/lib/billing/core/billing-attribution'
import {
  type AccountBillingDecision,
  cacheAccountBillingDecisionOrThrow,
  getCachedBillingAttribution,
} from '@/lib/billing/core/billing-attribution-cache'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { deriveBillingContext } from '@/lib/billing/core/usage-log'
import {
  BILLING_ATTRIBUTION_HEADER,
  BILLING_REQUEST_ID_HEADER,
  COPILOT_BILLING_PROTOCOL,
  COPILOT_BILLING_PROTOCOL_HEADER,
  type CopilotBillingProtocol,
} from '@/lib/copilot/generated/billing-protocol-v1'
import { CopilotValidateOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { checkInternalApiKey } from '@/lib/copilot/request/http'
import { withIncomingGoSpan } from '@/lib/copilot/request/otel'
import { isCopilotBillingAttributionV1Enabled, isHosted } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotApiKeysValidate')

function invalidBillingProtocolResponse(): NextResponse {
  return NextResponse.json({ error: 'Invalid billing attribution protocol' }, { status: 400 })
}

type AdmissionBillingDecision =
  | {
      kind: 'attributed'
      attribution: BillingAttributionSnapshot
    }
  | {
      kind: 'direct-account'
      userId: string
      billingRequestId: string
    }
  | {
      kind: 'legacy-account'
      userId: string
      workspaceId: string
    }

/**
 * Resolves admission against the versioned Go callback protocol.
 *
 * Markerless callbacks are accepted only for the Sim-first deployment window
 * while old Go instances drain. Direct-v1 is scoped only to the authenticated
 * Chat/Copilot key owner's hosted account; its self-hosted workspace is opaque.
 * Attributed-v1 never falls back if its frozen hosted workspace decision is
 * absent or inconsistent.
 */
async function resolveAdmissionBillingDecision(
  req: NextRequest,
  protocol: CopilotBillingProtocol | undefined,
  actorUserId: string,
  workspaceId: string | undefined
): Promise<AdmissionBillingDecision | NextResponse> {
  const hasBillingRequestId = Boolean(req.headers.get(BILLING_REQUEST_ID_HEADER))
  const hasBillingAttribution = Boolean(req.headers.get(BILLING_ATTRIBUTION_HEADER))

  if (protocol === COPILOT_BILLING_PROTOCOL.attributed) {
    if (!workspaceId) {
      return invalidBillingProtocolResponse()
    }
    try {
      const billingRequestId = requireBillingRequestIdHeader(req.headers)
      const attribution = requireBillingAttributionHeader(req.headers, {
        actorUserId,
        workspaceId,
      })
      const cachedAttribution = await getCachedBillingAttribution(billingRequestId)
      if (!cachedAttribution || !billingAttributionsEqual(cachedAttribution, attribution)) {
        return invalidBillingProtocolResponse()
      }
      return { kind: 'attributed', attribution }
    } catch {
      return invalidBillingProtocolResponse()
    }
  }

  if (protocol === COPILOT_BILLING_PROTOCOL.direct) {
    if (hasBillingAttribution) {
      return invalidBillingProtocolResponse()
    }

    let billingRequestId: string
    try {
      billingRequestId = requireBillingRequestIdHeader(req.headers)
    } catch {
      return invalidBillingProtocolResponse()
    }

    return {
      kind: 'direct-account',
      userId: actorUserId,
      billingRequestId,
    }
  }

  if (protocol !== undefined && protocol !== COPILOT_BILLING_PROTOCOL.legacy) {
    return invalidBillingProtocolResponse()
  }

  if (protocol === undefined && isCopilotBillingAttributionV1Enabled) {
    return invalidBillingProtocolResponse()
  }

  if (hasBillingRequestId || hasBillingAttribution) {
    return invalidBillingProtocolResponse()
  }
  if (!workspaceId) {
    return invalidBillingProtocolResponse()
  }

  return {
    kind: 'legacy-account',
    userId: actorUserId,
    workspaceId,
  }
}

async function checkAdmissionUsage(admission: AdmissionBillingDecision): Promise<{
  isExceeded: boolean
  currentUsage: number
  limit: number
  scope: string
  accountBillingDecision?: AccountBillingDecision
}> {
  if (admission.kind === 'attributed') {
    const usage = await checkAttributedUsageLimits(admission.attribution)
    return {
      isExceeded: usage.isExceeded,
      currentUsage: usage.payerUsage?.currentUsage ?? 0,
      limit: usage.payerUsage?.limit ?? 0,
      scope: usage.scope ?? 'payer',
    }
  }

  if (admission.kind === 'direct-account') {
    const subscription = await getHighestPrioritySubscription(admission.userId, {
      onError: 'throw',
    })
    const billingContext = deriveBillingContext(admission.userId, subscription)
    const usage = await checkServerSideUsageLimits(admission.userId, subscription)
    return {
      isExceeded: usage.isExceeded,
      currentUsage: usage.currentUsage,
      limit: usage.limit,
      scope: 'account',
      accountBillingDecision: {
        userId: admission.userId,
        billingEntity: billingContext.billingEntity,
        billingPeriod: {
          start: billingContext.billingPeriod.start.toISOString(),
          end: billingContext.billingPeriod.end.toISOString(),
        },
      },
    }
  }

  const usage = await checkServerSideUsageLimits(admission.userId)
  return {
    isExceeded: usage.isExceeded,
    currentUsage: usage.currentUsage,
    limit: usage.limit,
    scope: 'account',
  }
}

/**
 * Incoming-from-Go: extracts traceparent so this handler's work shows up as
 * a child of the Go-side `sim.validate_api_key` span in the same trace. If
 * there's no traceparent (manual curl / browser), the helper falls back to a
 * new root span.
 */
export const POST = withRouteHandler((req: NextRequest) =>
  withIncomingGoSpan(
    req.headers,
    TraceSpan.CopilotAuthValidateApiKey,
    {
      [TraceAttr.HttpMethod]: 'POST',
      [TraceAttr.HttpRoute]: '/api/copilot/api-keys/validate',
    },
    async (span) => {
      try {
        const auth = checkInternalApiKey(req)
        if (!auth.success) {
          span.setAttribute(
            TraceAttr.CopilotValidateOutcome,
            CopilotValidateOutcome.InternalAuthFailed
          )
          span.setAttribute(TraceAttr.HttpStatusCode, 401)
          return new NextResponse(null, { status: 401 })
        }

        const parsed = await parseRequest(
          validateCopilotApiKeyContract,
          req,
          {},
          {
            validationErrorResponse: (error) => {
              logger.warn('Invalid validation request', { errors: error.issues })
              span.setAttribute(
                TraceAttr.CopilotValidateOutcome,
                CopilotValidateOutcome.InvalidBody
              )
              span.setAttribute(TraceAttr.HttpStatusCode, 400)
              return validationErrorResponse(error, 'userId is required')
            },
            invalidJsonResponse: () => {
              logger.warn('Invalid validation request: invalid JSON')
              span.setAttribute(
                TraceAttr.CopilotValidateOutcome,
                CopilotValidateOutcome.InvalidBody
              )
              span.setAttribute(TraceAttr.HttpStatusCode, 400)
              return NextResponse.json(
                { error: 'userId is required', details: [] },
                { status: 400 }
              )
            },
          }
        )
        if (!parsed.success) return parsed.response

        const { userId, workspaceId } = parsed.data.body
        const protocol = parsed.data.headers?.[COPILOT_BILLING_PROTOCOL_HEADER]
        span.setAttribute(TraceAttr.UserId, userId)

        const [existingUser] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
        if (!existingUser) {
          logger.warn('[API VALIDATION] userId does not exist', { userId })
          span.setAttribute(TraceAttr.CopilotValidateOutcome, CopilotValidateOutcome.UserNotFound)
          span.setAttribute(TraceAttr.HttpStatusCode, 403)
          return NextResponse.json({ error: 'User not found' }, { status: 403 })
        }

        logger.info('[API VALIDATION] Validating usage limit', { userId })
        const admission = await resolveAdmissionBillingDecision(req, protocol, userId, workspaceId)
        if (admission instanceof NextResponse) {
          span.setAttribute(TraceAttr.CopilotValidateOutcome, CopilotValidateOutcome.InvalidBody)
          span.setAttribute(TraceAttr.HttpStatusCode, admission.status)
          return admission
        }
        const usage = await checkAdmissionUsage(admission)
        const { currentUsage, limit } = usage
        span.setAttributes({
          [TraceAttr.BillingUsageCurrent]: currentUsage,
          [TraceAttr.BillingUsageLimit]: limit,
          [TraceAttr.BillingUsageExceeded]: usage.isExceeded,
        })

        logger.info('[API VALIDATION] Usage limit validated', {
          userId,
          currentUsage,
          limit,
          isExceeded: usage.isExceeded,
          scope: usage.scope,
        })

        if (usage.isExceeded) {
          logger.info('[API VALIDATION] Usage exceeded', {
            userId,
            currentUsage,
            limit,
            scope: usage.scope,
          })
          span.setAttribute(TraceAttr.CopilotValidateOutcome, CopilotValidateOutcome.UsageExceeded)
          span.setAttribute(TraceAttr.HttpStatusCode, 402)
          return new NextResponse(null, { status: 402 })
        }

        if (admission.kind === 'legacy-account' && isHosted) {
          const memberCheck = await checkOrgMemberUsageLimit(userId, admission.workspaceId)
          if (memberCheck.isExceeded) {
            logger.info('[API VALIDATION] Per-member org usage limit exceeded', {
              userId,
              workspaceId: admission.workspaceId,
              currentUsage: memberCheck.currentUsage,
              limit: memberCheck.limit,
            })
            span.setAttribute(
              TraceAttr.CopilotValidateOutcome,
              CopilotValidateOutcome.UsageExceeded
            )
            span.setAttribute(TraceAttr.HttpStatusCode, 402)
            return new NextResponse(null, { status: 402 })
          }
        }

        if (admission.kind === 'direct-account') {
          if (!usage.accountBillingDecision) {
            throw new Error('Direct account billing decision is unavailable')
          }
          await cacheAccountBillingDecisionOrThrow(
            admission.billingRequestId,
            usage.accountBillingDecision,
            'Unable to preserve direct account billing decision'
          )
        }

        span.setAttribute(TraceAttr.CopilotValidateOutcome, CopilotValidateOutcome.Ok)
        span.setAttribute(TraceAttr.HttpStatusCode, 200)
        return new NextResponse(null, { status: 200 })
      } catch (error) {
        logger.error('Error validating usage limit', { error })
        span.setAttribute(TraceAttr.CopilotValidateOutcome, CopilotValidateOutcome.InternalError)
        span.setAttribute(TraceAttr.HttpStatusCode, 500)
        return NextResponse.json({ error: 'Failed to validate usage' }, { status: 500 })
      }
    }
  )
)
