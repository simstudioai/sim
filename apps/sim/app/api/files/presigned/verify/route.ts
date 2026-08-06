import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { verifyPresignedUploadContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { verifyPresignedUploadReceipt } from '@/lib/uploads/core/storage-service'
import { verifyUploadToken } from '@/lib/uploads/core/upload-token'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(verifyPresignedUploadContract, request, {})
  if (!parsed.success) return parsed.response

  const verification = verifyUploadToken(parsed.data.body.uploadToken)
  if (
    !verification.valid ||
    verification.payload.userId !== session.user.id ||
    verification.payload.uploadKind !== 'direct'
  ) {
    return NextResponse.json({ error: 'Invalid or expired upload token' }, { status: 403 })
  }

  const { key, context, uploadId } = verification.payload
  const uploaded = await verifyPresignedUploadReceipt({ key, context, uploadId })
  return NextResponse.json({ uploaded })
})
