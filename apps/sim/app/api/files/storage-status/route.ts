import { type NextRequest, NextResponse } from 'next/server'
import { fileStorageStatusContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { hasCloudStorage } from '@/lib/uploads/core/storage-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/files/storage-status
 * Whether S3, Azure Blob, or Google Cloud Storage is configured (needed for Instagram file-upload publish).
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(fileStorageStatusContract, request, {})
  if (!parsed.success) return parsed.response

  return NextResponse.json({ cloudConfigured: hasCloudStorage() })
})
