import { type NextRequest, NextResponse } from 'next/server'
import { localPutUploadContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { V2_PARSE_DEFAULTS } from '@/lib/api/server/routes'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { LocalUploadBodyError, writeLocalPutObject } from '@/lib/uploads/upload-session/provider'
import {
  getOwnedUploadSession,
  uploadSessionObjectMetadata,
} from '@/lib/uploads/upload-session/service'
import { v2Error, v2HttpError, v2UploadDataPlaneError } from '@/app/api/v2/lib/response'

interface LocalPutRouteParams {
  params: Promise<{ uploadId: string }>
}

/**
 * Local-storage data plane for a signed whole-object PUT upload session.
 *
 * Raw `withRouteHandler` rather than a v2 builder: the signed `upload-token`
 * header is the credential, so there is no API key, `Principal`, or semantic
 * operation for a builder to authenticate and authorize against, and the body
 * is streamed straight to storage rather than parsed.
 *
 * Absent from the public OpenAPI documents by design — see
 * `UNDOCUMENTED_V2_ROUTES` in `scripts/check-openapi-specs.ts` — but the error
 * envelope is not part of that exemption. This is the one step that moves the
 * bytes, and a caller that cannot parse its failures the way it parses every
 * other v2 failure has to special-case the whole upload flow, so it renders the
 * canonical `{ error: { code, message } }` like the rest of the surface.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: LocalPutRouteParams): Promise<NextResponse> => {
    const parsed = await parseRequest(localPutUploadContract, request, context, {
      ...V2_PARSE_DEFAULTS,
    })
    if (!parsed.success) return parsed.response

    let session
    try {
      session = await getOwnedUploadSession({
        uploadId: parsed.data.params.uploadId,
        uploadToken: parsed.data.headers['upload-token'],
      })
    } catch {
      return v2Error('FORBIDDEN', 'Invalid or expired upload token')
    }

    if (session.storageProvider !== 'local' || session.method !== 'put') {
      return v2Error('FORBIDDEN', 'Upload URL does not match this session')
    }
    if (session.status !== 'uploading') {
      return v2Error('CONFLICT', `Upload session is ${session.status}`)
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      return v2Error('CONFLICT', 'Upload session has expired')
    }

    const contentType = request.headers.get('content-type')
    if (contentType !== session.contentType) {
      return v2Error('BAD_REQUEST', `Content-Type must be ${session.contentType}`)
    }
    const contentLength = request.headers.get('content-length')
    if (contentLength !== null && Number(contentLength) !== session.fileSize) {
      return v2Error('BAD_REQUEST', `Upload must contain exactly ${session.fileSize} bytes`)
    }
    if (!request.body) {
      return v2Error('BAD_REQUEST', 'Upload body is required')
    }

    try {
      await writeLocalPutObject({
        uploadId: session.id,
        key: session.finalKey,
        body: request.body,
        expectedSize: session.fileSize,
        contentType: session.contentType,
        metadata: uploadSessionObjectMetadata(session),
      })
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
