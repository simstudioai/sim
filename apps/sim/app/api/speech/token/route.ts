import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { NextResponse } from 'next/server'
import { speechTokenContract } from '@/lib/api/contracts/media/speech'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { NoWorkspaceAccessError } from '@/lib/core/application/workspace-authorization'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { RateLimiter } from '@/lib/core/rate-limiter'
import {
  createSpeechToken,
  SpeechTokenError,
  speechTokenOperation,
} from '@/lib/speech/application/create-token'

export const dynamic = 'force-dynamic'

const STT_TOKEN_RATE_LIMIT = {
  maxTokens: 30,
  refillRate: 3,
  refillIntervalMs: 72 * 1000,
} as const
const rateLimiter = new RateLimiter()

export const POST = defineInternalJsonRoute({
  contract: speechTokenContract,
  auth: internalSessionAuth,
  operation: speechTokenOperation,
  rateLimit: {
    kind: 'user',
    bucketName: 'stt-token',
    async enforce(_request, principal) {
      if (!isBillingEnabled) return null
      const rateCheck = await rateLimiter.checkRateLimitDirect(
        `stt-token:user:${requirePrincipalSubjectUserId(principal)}`,
        STT_TOKEN_RATE_LIMIT
      )
      return rateCheck.allowed
        ? null
        : NextResponse.json(
            { error: 'Voice input rate limit exceeded. Please try again later.' },
            {
              status: 429,
              headers: {
                'Retry-After': String(Math.ceil((rateCheck.retryAfterMs ?? 60000) / 1000)),
              },
            }
          )
    },
  },
  parseOptions: {
    maxBodyBytes: 16 * 1024,
    validationErrorResponse: () =>
      NextResponse.json(
        { error: 'Workspace or organization context is required.' },
        { status: 400 }
      ),
  },
  errorPolicy: {
    project(error) {
      if (error instanceof SpeechTokenError) {
        const status = { usage_limit: 402, unconfigured: 503, provider_failed: 502 }[error.reason]
        return internalErrorResponse(status, { error: error.message, scope: error.scope })
      }
      const classified = asOrchestrationError(error)
      if (error instanceof NoWorkspaceAccessError || classified?.code === 'not_found') {
        return internalErrorResponse(400, {
          error: 'Workspace or organization context is required.',
        })
      }
      return null
    },
    unhandled: () => internalErrorResponse(500, { error: 'Failed to generate speech token' }),
  },
  mapInput: ({ body }) => body,
  useCase: createSpeechToken,
})
