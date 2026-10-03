import { createHash } from 'node:crypto'
import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import {
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  resolveBillingAttribution,
  resolveOrganizationBillingAttribution,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillPayerOverageThreshold } from '@/lib/billing/threshold-billing'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { requireAllowedWorkspacePrincipal } from '@/lib/core/application/workspace-authorization'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier } from '@/lib/core/config/env-flags'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const logger = createLogger('SpeechToken')
const ELEVENLABS_TOKEN_URL = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe'
const VOICE_SESSION_COST_PER_MIN = 0.008
const VOICE_SESSION_MAX_MINUTES = 3
const providerTokenSchema = z.object({ token: z.string().min(1) })
const providerErrorSchema = z.object({
  detail: z.string().optional(),
  message: z.string().optional(),
})

/**
 * permission-group-exempt: Voice dictation is an input aid shared across product surfaces.
 */
export const speechTokenOperation = defineWorkspaceOperation({
  id: 'speech.token.create',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['session'],
  capability: 'none',
})

/**
 * permission-group-exempt: Voice dictation is an input aid shared across product surfaces.
 */
const organizationSpeechTokenOperation = defineOrganizationOperation({
  id: 'speech.token.create',
  minimumRole: 'member',
  principalKinds: ['session'],
  capability: 'none',
})

export class SpeechTokenError extends Error {
  constructor(
    readonly reason: 'usage_limit' | 'unconfigured' | 'provider_failed',
    message: string,
    readonly scope?: 'actor' | 'payer' | 'member'
  ) {
    super(message)
    this.name = 'SpeechTokenError'
  }
}

async function issueSpeechToken(
  actorUserId: string,
  billingAttribution: BillingAttributionSnapshot
) {
  /** Admission remains bounded by the per-user token bucket; billing has no reservation primitive. */
  const usageCheck = await checkAttributedUsageLimits(billingAttribution)
  if (usageCheck.isExceeded) {
    throw new SpeechTokenError(
      'usage_limit',
      usageCheck.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
      usageCheck.scope
    )
  }

  const apiKey = env.ELEVENLABS_API_KEY
  if (!apiKey?.trim()) {
    throw new SpeechTokenError('unconfigured', 'Speech-to-text service is not configured')
  }

  const response = await fetch(ELEVENLABS_TOKEN_URL, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
  })
  if (!response.ok) {
    const error = providerErrorSchema.safeParse(await response.json().catch(() => ({})))
    const message =
      (error.success && (error.data.detail || error.data.message)) ||
      `Token request failed (${response.status})`
    logger.error('ElevenLabs token request failed', { status: response.status, message })
    throw new SpeechTokenError('provider_failed', message)
  }

  const { token } = providerTokenSchema.parse(await response.json())
  try {
    await recordUsage({
      userId: actorUserId,
      ...(billingAttribution.workspaceId ? { workspaceId: billingAttribution.workspaceId } : {}),
      ...toBillingContext(billingAttribution),
      entries: [
        {
          category: 'fixed',
          source: 'voice-input',
          description: `Voice input session (${VOICE_SESSION_MAX_MINUTES} min)`,
          cost: VOICE_SESSION_COST_PER_MIN * VOICE_SESSION_MAX_MINUTES * getCostMultiplier(),
          sourceReference: `voice-input:${createHash('sha256').update(token).digest('hex')}`,
        },
      ],
    })
    await checkAndBillPayerOverageThreshold(billingAttribution.billingEntity)
  } catch (error) {
    logger.warn('Failed to record voice input usage, continuing:', error)
  }
  return { token }
}

const createWorkspaceSpeechToken = defineAuthorizedWorkspaceUseCase({
  operation: speechTokenOperation,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, context }) {
    const attribution = await resolveBillingAttribution({
      actorUserId: principal.userId,
      workspaceId: context.workspaceId,
    })
    return issueSpeechToken(principal.userId, attribution)
  },
})

/** Issues a metered token under the caller's current workspace or organization membership. */
export const createSpeechToken = {
  operation: speechTokenOperation,
  async execute({ principal, input }: { principal: Principal; input: ResourceOwner }) {
    requireAllowedWorkspacePrincipal(principal, speechTokenOperation)
    const scope = resourceScopeFromOwner(input)
    if (scope.kind === 'workspace') {
      return createWorkspaceSpeechToken.execute({ principal, input: scope })
    }
    const context = await authorizeOrganizationOperation(
      principal,
      organizationSpeechTokenOperation,
      scope
    )
    const attribution = await resolveOrganizationBillingAttribution({
      actorUserId: context.userId,
      organizationId: context.organizationId,
    })
    return issueSpeechToken(context.userId, attribution)
  },
}
