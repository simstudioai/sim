import { type NextRequest, NextResponse } from 'next/server'
import { completeTableImportResourceContract } from '@/lib/api/contracts/table-transfers'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  findOwnedTableImport,
  getOwnedTableImportUpload,
  startUploadedTableImport,
  toV2TableImport,
} from '@/lib/table/orchestration/import-resource'
import { completeUploadSession } from '@/lib/uploads/multipart-session/service'
import { orchestrationErrorResponse } from '@/app/api/table/utils'

interface ImportRouteParams {
  params: Promise<{ importId: string }>
}

export const POST = withRouteHandler(async (request: NextRequest, context: ImportRouteParams) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const parsed = await parseRequest(completeTableImportResourceContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const upload = getOwnedTableImportUpload({
      importId: parsed.data.params.importId,
      workspaceId: parsed.data.query.workspaceId,
      userId: auth.userId,
      uploadToken: parsed.data.headers['upload-token'],
    })
    const existing = await findOwnedTableImport({
      importId: upload.id,
      workspaceId: upload.workspaceId,
      userId: upload.userId,
    })
    if (existing) return NextResponse.json({ data: toV2TableImport(existing) })
    const completed = await completeUploadSession({
      session: upload,
      parts: parsed.data.body.parts,
      finalize: async () => ({ value: null }),
    })
    return NextResponse.json({
      data: toV2TableImport(await startUploadedTableImport(completed.session)),
    })
  } catch (error) {
    const classified = orchestrationErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
