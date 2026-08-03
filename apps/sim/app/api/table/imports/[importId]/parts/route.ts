import { type NextRequest, NextResponse } from 'next/server'
import { createTableImportPartUrlsContract } from '@/lib/api/contracts/table-transfers'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getOwnedTableImportUpload } from '@/lib/table/orchestration/import-resource'
import { createUploadPartUrls } from '@/lib/uploads/multipart-session/service'
import { orchestrationErrorResponse } from '@/app/api/table/utils'

interface ImportRouteParams {
  params: Promise<{ importId: string }>
}

export const POST = withRouteHandler(async (request: NextRequest, context: ImportRouteParams) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const parsed = await parseRequest(createTableImportPartUrlsContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const upload = getOwnedTableImportUpload({
      importId: parsed.data.params.importId,
      workspaceId: parsed.data.query.workspaceId,
      userId: auth.userId,
      uploadToken: parsed.data.headers['upload-token'],
    })
    const parts = await createUploadPartUrls({
      session: upload,
      partNumbers: parsed.data.body.partNumbers,
      localOrigin: request.nextUrl.origin,
    })
    return NextResponse.json({ data: { parts } })
  } catch (error) {
    const classified = orchestrationErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
