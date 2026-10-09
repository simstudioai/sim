import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getPublicFolderContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { validateDeploymentAuth } from '@/lib/core/security/deployment-auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { PublicShareAccessError, readPublicSharedFolder } from '@/lib/public-shares/access'
import { enforcePublicFileRateLimit } from '@/lib/public-shares/rate-limit'

export const dynamic = 'force-dynamic'

/** Public capabilities use the share authentication protocol rather than workspace membership. */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const headers = { 'Cache-Control': 'private, no-store' }
    const limited = await enforcePublicFileRateLimit(request, 'metadata')
    if (limited) {
      limited.headers.set('Cache-Control', headers['Cache-Control'])
      return limited
    }
    const parsed = await parseRequest(getPublicFolderContract, request, context)
    if (!parsed.success) {
      parsed.response.headers.set('Cache-Control', headers['Cache-Control'])
      return parsed.response
    }
    try {
      const page = await readPublicSharedFolder({
        token: parsed.data.params.token,
        ...parsed.data.query,
        authorize: (share) =>
          validateDeploymentAuth(generateRequestId(), share, request, undefined, 'file'),
      })
      return NextResponse.json(page, { headers })
    } catch (error) {
      if (error instanceof PublicShareAccessError) {
        return NextResponse.json({ error: error.message }, { status: error.status, headers })
      }
      if (error instanceof OrchestrationError && error.code === 'validation') {
        return NextResponse.json({ error: error.message }, { status: 400, headers })
      }
      throw error
    }
  }
)
