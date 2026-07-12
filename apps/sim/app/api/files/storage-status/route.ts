import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { hasCloudStorage } from '@/lib/uploads/core/storage-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/files/storage-status
 * Whether S3 or Azure Blob is configured (needed for Instagram file-upload publish).
 */
export const GET = withRouteHandler(async () => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ cloudConfigured: hasCloudStorage() })
})
