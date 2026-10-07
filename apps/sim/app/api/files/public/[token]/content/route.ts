import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getPublicFileContentContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  publicFileAuthDenied,
  publicFileBinaryErrorResponse,
  publicFileShareCredential,
} from '@/lib/public-shares/api'
import {
  authorizePublicFileShare,
  readPublicFileShareContent,
} from '@/lib/public-shares/application'
import { enforcePublicFileRateLimit } from '@/lib/public-shares/rate-limit'
import { FILE_CACHE_CONTROL } from '@/lib/uploads/server/delivery'
import { createConditionalFileResponse } from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'
const logger = createLogger('PublicFileContentAPI')

/** Binary delivery rechecks the current bearer grant and preserves the token URL's revalidation policy. */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    try {
      const limited = await enforcePublicFileRateLimit(request, 'content')
      if (limited) return limited
      const parsed = await parseRequest(getPublicFileContentContract, request, context)
      if (!parsed.success) return parsed.response
      const auth = await authorizePublicFileShare({
        token: parsed.data.params.token,
        credential: await publicFileShareCredential(request.cookies.getAll(), getClientIp(request)),
      })
      if (!auth.authorized) return publicFileAuthDenied(auth)
      if (request.method === 'HEAD') {
        return new NextResponse(null, {
          headers: {
            'Cache-Control': FILE_CACHE_CONTROL.revalidate,
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }
      const result = await readPublicFileShareContent({
        grant: auth.grant,
        preview: parsed.data.query.preview === '1',
        request,
      })
      return createConditionalFileResponse(
        {
          buffer: result.buffer,
          contentType: result.contentType,
          filename: result.file.originalName,
          cacheControl: FILE_CACHE_CONTROL.revalidate,
        },
        request.headers.get('if-none-match')
      )
    } catch (error) {
      logger.error('Error serving public shared file:', error)
      return publicFileBinaryErrorResponse(error, 'Failed to serve file')
    }
  }
)
