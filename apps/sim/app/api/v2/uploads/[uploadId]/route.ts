import { type NextRequest, NextResponse } from 'next/server'
import { localPutUploadContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { LocalUploadBodyError, writeLocalPutObject } from '@/lib/uploads/upload-session/provider'
import {
  getOwnedUploadSession,
  uploadSessionObjectMetadata,
} from '@/lib/uploads/upload-session/service'

interface LocalPutRouteParams {
  params: Promise<{ uploadId: string }>
}

/** Local-storage data plane for a signed whole-object PUT upload session. */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: LocalPutRouteParams): Promise<NextResponse> => {
    const parsed = await parseRequest(localPutUploadContract, request, context)
    if (!parsed.success) return parsed.response

    let session
    try {
      session = await getOwnedUploadSession({
        uploadId: parsed.data.params.uploadId,
        uploadToken: parsed.data.headers['upload-token'],
      })
    } catch {
      return NextResponse.json({ error: 'Invalid or expired upload token' }, { status: 403 })
    }

    if (session.storageProvider !== 'local' || session.method !== 'put') {
      return NextResponse.json({ error: 'Upload URL does not match this session' }, { status: 403 })
    }
    if (session.status !== 'uploading') {
      return NextResponse.json({ error: `Upload session is ${session.status}` }, { status: 409 })
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Upload session has expired' }, { status: 409 })
    }

    const contentType = request.headers.get('content-type')
    if (contentType !== session.contentType) {
      return NextResponse.json(
        { error: `Content-Type must be ${session.contentType}` },
        { status: 400 }
      )
    }
    const contentLength = request.headers.get('content-length')
    if (contentLength !== null && Number(contentLength) !== session.fileSize) {
      return NextResponse.json(
        { error: `Upload must contain exactly ${session.fileSize} bytes` },
        { status: 400 }
      )
    }
    if (!request.body) {
      return NextResponse.json({ error: 'Upload body is required' }, { status: 400 })
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
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      throw error
    }
    return new NextResponse(null, { status: 204 })
  }
)
