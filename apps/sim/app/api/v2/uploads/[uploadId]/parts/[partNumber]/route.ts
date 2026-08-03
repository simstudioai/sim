import { type NextRequest, NextResponse } from 'next/server'
import { localUploadPartContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { verifyUploadToken } from '@/lib/uploads/core/upload-token'
import { writeLocalMultipartPart } from '@/lib/uploads/multipart-session/provider'
import {
  expectedUploadPartSize,
  getOwnedUploadSession,
} from '@/lib/uploads/multipart-session/service'

interface LocalPartRouteParams {
  params: Promise<{ uploadId: string; partNumber: string }>
}

/**
 * Local-storage data plane for signed multipart PUT URLs. Cloud deployments return provider URLs
 * instead, so this route is never in the cloud byte path.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: LocalPartRouteParams): Promise<NextResponse> => {
    const { uploadId } = await context.params
    const verification = verifyUploadToken(request.nextUrl.searchParams.get('token') ?? '')
    if (!verification.valid || verification.payload.uploadId !== uploadId) {
      return NextResponse.json({ error: 'Invalid or expired upload token' }, { status: 403 })
    }
    const parsed = await parseRequest(localUploadPartContract, request, context)
    if (!parsed.success) return parsed.response

    const session = await getOwnedUploadSession({
      uploadId,
      workspaceId: verification.payload.workspaceId,
      userId: verification.payload.userId,
    })
    if (session.storageProvider !== 'local' || session.storageKey !== verification.payload.key) {
      return NextResponse.json({ error: 'Upload URL does not match this session' }, { status: 403 })
    }
    if (session.status !== 'uploading') {
      return NextResponse.json({ error: `Upload session is ${session.status}` }, { status: 409 })
    }

    const { partNumber } = parsed.data.params
    const expectedSize = expectedUploadPartSize(session, partNumber)
    const contentLength = request.headers.get('content-length')
    if (contentLength !== null && Number(contentLength) !== expectedSize) {
      return NextResponse.json(
        { error: `Part ${partNumber} must contain exactly ${expectedSize} bytes` },
        { status: 400 }
      )
    }
    if (!request.body) {
      return NextResponse.json({ error: 'Upload part body is required' }, { status: 400 })
    }

    await writeLocalMultipartPart({ uploadId, partNumber, body: request.body, expectedSize })
    return new NextResponse(null, { status: 204 })
  }
)
