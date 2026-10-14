import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getPublicInlineFileContract } from '@/lib/api/contracts/public-shares'
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
  readPublicFileShareInline,
} from '@/lib/public-shares/application'
import { enforcePublicFileRateLimit } from '@/lib/public-shares/rate-limit'
import { FILE_CACHE_CONTROL } from '@/lib/uploads/server/delivery'
import { createConditionalFileResponse } from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'
const logger = createLogger('PublicInlineFileAPI')

/** The bearer operation extends a document's grant only to its current same-owner raster embeds. */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    try {
      const limited = await enforcePublicFileRateLimit(request, 'inline')
      if (limited) return limited
      const parsed = await parseRequest(getPublicInlineFileContract, request, context)
      if (!parsed.success) return parsed.response
      const auth = await authorizePublicFileShare({
        token: parsed.data.params.token,
        credential: await publicFileShareCredential(request.cookies.getAll(), getClientIp(request)),
      })
      if (!auth.authorized) return publicFileAuthDenied(auth)
      if (request.method === 'HEAD') {
        return new NextResponse(null, {
          status: 405,
          headers: {
            Allow: 'GET',
            'Cache-Control': FILE_CACHE_CONTROL.noStore,
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }
      const result = await readPublicFileShareInline({
        grant: auth.grant,
        ...parsed.data.query,
        request,
      })
      return createConditionalFileResponse(
        {
          buffer: result.buffer,
          contentType: result.contentType,
          filename: result.servedFileName,
          cacheControl: FILE_CACHE_CONTROL.revalidate,
        },
        request.headers.get('if-none-match')
      )
    } catch (error) {
      logger.error('Error serving public inline image:', error)
      return publicFileBinaryErrorResponse(error, 'Failed to serve file')
    }
  }
)
