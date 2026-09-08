import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { validateCopilotApiKeyContract } from '@/lib/api/contracts/copilot'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkServerSideUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import {
  type AccountBillingDecision,
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  requireBillingAttributionHeader,
  requireBillingRequestIdHeader,
  resolveLegacyV0BillingAttribution,
  resolveOrganizationBillingAttribution,
  serializeAccountBillingDecisionHeader,
  serializeBillingAttributionHeader,
} from '@/lib/billing/core/billing-attribution'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { isEnterprisePlan } from '@/lib/billing/core/subscription'
import { deriveBillingContext } from '@/lib/billing/core/usage-log'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/copilot/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/copilot/chat/organization-chats'
import {
  BILLING_ACCOUNT_DECISION_HEADER,
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
import { isHosted } from '@/lib/core/config/env-flags'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
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
    }
  | {
      kind: 'legacy-scoped'
      attribution: BillingAttributionSnapshot
      includeAttribution: boolean
    }
  | {
      kind: 'legacy-account'
      userId: string
    }

/**
 * Resolves admission against the versioned Go callback protocol.
 *
 * Markerless self-hosted admission is legacy-v0. A locally resolvable
 * workspace selects its current payer; an absent or opaque workspace preserves
 * account billing. This mutable resolution is repeated at callback time for
 * local self-hosted compatibility. Direct-v1 remains scoped only to the
 * authenticated Chat/Copilot key owner's hosted account, and attributed-v1
 * never falls back from its immutable envelope.
 */
async function resolveAdmissionBillingDecision(
  req: NextRequest,
  protocol: CopilotBillingProtocol | undefined,
  actorUserId: string,
  workspaceId: string | undefined,
  organizationId: string | undefined,
  chatId: string | undefined
): Promise<AdmissionBillingDecision | NextResponse> {
  const hasBillingRequestId = Boolean(req.headers.get(BILLING_REQUEST_ID_HEADER))
  const hasBillingAttribution = Boolean(req.headers.get(BILLING_ATTRIBUTION_HEADER))
  const hasBillingAccountDecision = Boolean(req.headers.get(BILLING_ACCOUNT_DECISION_HEADER))

  if (organizationId && protocol === undefined) return invalidBillingProtocolResponse()
  if (organizationId && protocol !== COPILOT_BILLING_PROTOCOL.direct) {
    if (!chatId) return invalidBillingProtocolResponse()
    const principal = createTrustedOrganizationCopilotPrincipal(
      {
        userId: actorUserId,
        organizationId,
        chatId,
        delegationId: req.headers.get(BILLING_REQUEST_ID_HEADER) ?? generateId(),
      },
      { audience: 'sim:copilot-billing', ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS }
    )
    await authorizeOrganizationChatDelegation.execute({ principal })
  }

  if (protocol === COPILOT_BILLING_PROTOCOL.attributed) {
    if ((!workspaceId && !organizationId) || hasBillingAccountDecision) {
      return invalidBillingProtocolResponse()
    }
    try {
      requireBillingRequestIdHeader(req.headers)
      const attribution = requireBillingAttributionHeader(req.headers, {
        actorUserId,
        ...(organizationId ? { organizationId } : { workspaceId }),
      })
      return { kind: 'attributed', attribution }
    } catch {
      return invalidBillingProtocolResponse()
    }
  }

  if (protocol === COPILOT_BILLING_PROTOCOL.direct) {
    if (hasBillingAttribution || hasBillingAccountDecision) {
      return invalidBillingProtocolResponse()
    }

    try {
      requireBillingRequestIdHeader(req.headers)
    } catch {
      return invalidBillingProtocolResponse()
    }

    return {
      kind: 'direct-account',
      userId: actorUserId,
    }
  }

  if (protocol !== undefined && protocol !== COPILOT_BILLING_PROTOCOL.legacy) {
    return invalidBillingProtocolResponse()
  }

  if (protocol === undefined && isHosted) {
    return invalidBillingProtocolResponse()
  }

  if (hasBillingRequestId || hasBillingAttribution || hasBillingAccountDecision) {
    return invalidBillingProtocolResponse()
  }
  if (protocol === COPILOT_BILLING_PROTOCOL.legacy && !workspaceId && !organizationId) {
    return invalidBillingProtocolResponse()
  }

  if (organizationId) {
    return {
      kind: 'legacy-scoped',
      attribution: await resolveOrganizationBillingAttribution({ actorUserId, organizationId }),
      includeAttribution: true,
    }
  }

  if (workspaceId) {
    const attribution = await resolveLegacyV0BillingAttribution({
      actorUserId,
      workspaceId,
    })
    if (attribution) {
      return {
        kind: 'legacy-scoped',
        attribution,
        includeAttribution: protocol === COPILOT_BILLING_PROTOCOL.legacy,
      }
    }
  }

  return { kind: 'legacy-account', userId: actorUserId }
}

async function checkAdmissionUsage(admission: AdmissionBillingDecision): Promise<{
  isExceeded: boolean
  currentUsage: number
  limit: number
  scope: string
  accountBillingDecision?: AccountBillingDecision
}> {
  if (admission.kind === 'attributed' || admission.kind === 'legacy-scoped') {
    const usage = await checkAttributedUsageLimits(admission.attribution)
    const enforcedUsage =
      usage.scope === 'member' && usage.memberUsage ? usage.memberUsage : usage.payerUsage
    return {
      isExceeded: usage.isExceeded,
      currentUsage: enforcedUsage?.currentUsage ?? 0,
      limit: enforcedUsage?.limit ?? 0,
      scope: usage.scope ?? 'payer',
    }
  }

  if (admission.kind === 'direct-account') {
    const subscription = await getHighestPrioritySubscription(admission.userId, {
      onError: 'throw',
    })
    const billingContext = deriveBillingContext(admission.userId, subscription)
    const usage = await checkServerSideUsageLimits(admission.userId, subscription, billingContext)
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
          ...(billingContext.billingPeriod.source
            ? { source: billingContext.billingPeriod.source }
            : {}),
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

        const { userId, workspaceId, organizationId, chatId } = parsed.data.body
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
        const admission = await resolveAdmissionBillingDecision(
          req,
          protocol,
          userId,
          workspaceId,
          organizationId,
          chatId
        )
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
          billingProtocol: protocol ?? COPILOT_BILLING_PROTOCOL.legacy,
          billingResolution:
            admission.kind === 'legacy-scoped' ? 'mutable-request-time' : 'immutable-or-account',
          billingPayer:
            admission.kind === 'attributed' || admission.kind === 'legacy-scoped'
              ? admission.attribution.billingEntity
              : (usage.accountBillingDecision?.billingEntity ?? { type: 'account', id: userId }),
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

        const responseHeaders: Record<string, string> = {}
        if (admission.kind === 'attributed') {
          const serializedAttribution = req.headers.get(BILLING_ATTRIBUTION_HEADER)
          if (!serializedAttribution) {
            throw new Error('Attributed billing material is unavailable')
          }
          responseHeaders[BILLING_ATTRIBUTION_HEADER] = serializedAttribution
        } else if (admission.kind === 'direct-account') {
          if (!usage.accountBillingDecision) {
            throw new Error('Direct account billing decision is unavailable')
          }
          responseHeaders[BILLING_ACCOUNT_DECISION_HEADER] = serializeAccountBillingDecisionHeader(
            usage.accountBillingDecision
          )
        } else if (admission.kind === 'legacy-scoped' && admission.includeAttribution) {
          responseHeaders[BILLING_ATTRIBUTION_HEADER] = serializeBillingAttributionHeader(
            admission.attribution
          )
        }

        const isEnterprise = await isEnterprisePlan(userId)

        span.setAttribute(TraceAttr.CopilotValidateOutcome, CopilotValidateOutcome.Ok)
        span.setAttribute(TraceAttr.HttpStatusCode, 200)
        return NextResponse.json({ isEnterprise }, { status: 200, headers: responseHeaders })
      } catch (error) {
        const code = asOrchestrationError(error)?.code
        if (code === 'not_found' || code === 'forbidden')
          return NextResponse.json({ error: 'Conversation access denied' }, { status: 403 })
        logger.error('Error validating usage limit', { error })
        span.setAttribute(TraceAttr.CopilotValidateOutcome, CopilotValidateOutcome.InternalError)
        span.setAttribute(TraceAttr.HttpStatusCode, 500)
        return NextResponse.json({ error: 'Failed to validate usage' }, { status: 500 })
      }
    }
  )
)
