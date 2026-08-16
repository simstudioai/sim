import { type NextRequest, NextResponse } from 'next/server'
import { localUploadPartContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { V2_PARSE_DEFAULTS } from '@/lib/api/server/routes'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  LocalUploadBodyError,
  writeLocalMultipartPart,
} from '@/lib/uploads/upload-session/provider'
import {
  expectedUploadPartSize,
  type UploadSessionRecord,
  verifyUploadSessionToken,
} from '@/lib/uploads/upload-session/service'
import {
  v2CaughtOrchestrationError,
  v2Error,
  v2HttpError,
  v2UploadDataPlaneError,
} from '@/app/api/v2/lib/response'

interface LocalPartRouteParams {
  params: Promise<{ uploadId: string; partNumber: string }>
}

/**
 * Local-storage data plane for signed multipart PUT URLs. Cloud deployments return provider URLs
 * instead, so this route is never in the cloud byte path.
 *
 * Raw `withRouteHandler` rather than a v2 builder, for the same reason as the
 * whole-object PUT beside it: a signed token credential and a streamed body,
 * with no `Principal` or semantic operation for a builder to act on.
 *
 * Absent from the public OpenAPI documents by design — see
 * `UNDOCUMENTED_V2_ROUTES` in `scripts/check-openapi-specs.ts` — but it answers
 * in the canonical `{ error: { code, message } }` envelope like the rest of the
 * surface, for the reason given on the whole-object PUT beside it.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: LocalPartRouteParams): Promise<NextResponse> => {
    const { uploadId } = await context.params
    const token = request.nextUrl.searchParams.get('token') ?? ''
    let session: UploadSessionRecord
    try {
      session = await verifyUploadSessionToken(token)
    } catch {
      return v2Error('FORBIDDEN', 'Invalid or expired upload token')
    }
    const parsed = await parseRequest(localUploadPartContract, request, context, {
      ...V2_PARSE_DEFAULTS,
    })
    if (!parsed.success) return parsed.response

    if (session.id !== uploadId || session.storageProvider !== 'local') {
      return v2Error('FORBIDDEN', 'Upload URL does not match this session')
    }
    if (session.status !== 'uploading') {
      return v2Error('CONFLICT', `Upload session is ${session.status}`)
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      return v2Error('CONFLICT', 'Upload session has expired')
    }
    if (session.method !== 'multipart') {
      return v2Error('CONFLICT', 'PUT upload sessions do not have parts')
    }

    const { partNumber } = parsed.data.params
    let expectedSize: number
    try {
      expectedSize = expectedUploadPartSize(session, partNumber)
    } catch (error) {
      // The part number is a path segment of a session-scoped signed URL, so a
      // caller can address a part this session does not have. That refusal is a
      // classified domain failure, and the data plane's generic 500 tail would
      // otherwise render it as an internal error.
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      throw error
    }
    const contentLength = request.headers.get('content-length')
    if (contentLength !== null && Number(contentLength) !== expectedSize) {
      return v2Error('BAD_REQUEST', `Part ${partNumber} must contain exactly ${expectedSize} bytes`)
    }
    if (!request.body) {
      return v2Error('BAD_REQUEST', 'Upload part body is required')
    }

    try {
      await writeLocalMultipartPart({ uploadId, partNumber, body: request.body, expectedSize })
    } catch (error) {
      if (error instanceof LocalUploadBodyError) {
        return v2Error('BAD_REQUEST', error.message)
      }
      throw error
    }
    return new NextResponse(null, { status: 204 })
  },
  {
    typedErrorResponse: ({ error }) => v2HttpError(error),
    unhandledErrorResponse: () => v2UploadDataPlaneError(),
  }
)
