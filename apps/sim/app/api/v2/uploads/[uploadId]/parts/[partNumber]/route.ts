import { type NextRequest, NextResponse } from 'next/server'
import { localUploadPartContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { writeLocalMultipartPart } from '@/lib/uploads/multipart-session/provider'
import {
  expectedUploadPartSize,
  type UploadSessionRecord,
  verifyUploadSessionToken,
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
    const token = request.nextUrl.searchParams.get('token') ?? ''
    let session: UploadSessionRecord
    try {
      session = verifyUploadSessionToken(token)
    } catch {
      return NextResponse.json({ error: 'Invalid or expired upload token' }, { status: 403 })
    }
    const parsed = await parseRequest(localUploadPartContract, request, context)
    if (!parsed.success) return parsed.response

    if (session.id !== uploadId || session.storageProvider !== 'local') {
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
