import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type { AuthContext, WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { verifyTokenAuth } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:GoogleForms')

export const googleFormsHandler: WebhookProviderHandler = {
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
