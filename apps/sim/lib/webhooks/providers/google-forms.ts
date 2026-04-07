import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { verifyTokenAuth } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:GoogleForms')

export const googleFormsHandler: WebhookProviderHandler = {
  async formatInput({ body, webhook }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const providerConfig = (webhook.providerConfig as Record<string, unknown>) || {}
    const normalizeAnswers = (src: unknown): Record<string, unknown> => {
      if (!src || typeof src !== 'object') return {}
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        if (Array.isArray(v)) {
          out[k] = v.length === 1 ? v[0] : v
        } else {
          out[k] = v
        }
      }
      return out
    }
    const responseId = (b?.responseId || b?.id || '') as string
    const createTime = (b?.createTime || b?.timestamp || new Date().toISOString()) as string
    const lastSubmittedTime = (b?.lastSubmittedTime || createTime) as string
    const formId = (b?.formId || providerConfig.formId || '') as string
    const includeRaw = providerConfig.includeRawPayload !== false
    return {
      input: {
        responseId,
        createTime,
        lastSubmittedTime,
        formId,
        answers: normalizeAnswers(b?.answers),
        ...(includeRaw ? { raw: b?.raw ?? b } : {}),
      },
    }
  },

  verifyAuth({ request, requestId, providerConfig }: AuthContext) {
    const expectedToken = providerConfig.token as string | undefined
    if (!expectedToken) {
      return null
    }

    const secretHeaderName = providerConfig.secretHeaderName as string | undefined
    if (!verifyTokenAuth(request, expectedToken, secretHeaderName)) {
      logger.warn(`[${requestId}] Google Forms webhook authentication failed`)
      return new NextResponse('Unauthorized - Invalid secret', { status: 401 })
    }

    return null
  },
}
