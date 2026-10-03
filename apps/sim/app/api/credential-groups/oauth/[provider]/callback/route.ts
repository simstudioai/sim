import type { NextRequest } from 'next/server'
import { credentialGroupOAuthCallbackContract } from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { enforcePublicCredentialGroupIpRateLimit } from '@/lib/credential-groups/rate-limit'
import { handleCredentialGroupOAuthCallback } from '@/app/api/credential-groups/oauth-callback'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ provider: string }> }) => {
    const limited = await enforcePublicCredentialGroupIpRateLimit(request, 'oauth-callback')

    const parsed = await parseRequest(credentialGroupOAuthCallbackContract, request, context)
    if (!parsed.success) return limited ?? parsed.response
    const { provider } = parsed.data.params
    return handleCredentialGroupOAuthCallback({
      request,
      provider,
      query: parsed.data.query,
      limited,
    })
  }
)
