import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { completeTableImportResourceContract } from '@/lib/api/contracts/table-transfers'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { markTrackedImportTerminal } from '@/lib/table/import-resource-store'
import {
  getOwnedTableImport,
  startUploadedTableImport,
  toV2TableImport,
} from '@/lib/table/orchestration/import-resource'
import {
  completeUploadSession,
  getOwnedUploadSession,
} from '@/lib/uploads/multipart-session/service'
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
    const record = await getOwnedTableImport({
      importId: parsed.data.params.importId,
      workspaceId: parsed.data.query.workspaceId,
      userId: auth.userId,
    })
    if (!record.uploadSessionId) {
      return NextResponse.json({ error: 'Import has no upload source' }, { status: 409 })
    }
    const upload = await getOwnedUploadSession({
      uploadId: record.uploadSessionId,
      workspaceId: record.workspaceId,
      userId: auth.userId,
    })
    await completeUploadSession({
      session: upload,
      parts: parsed.data.body.parts,
      finalize: async () => ({ value: null }),
      onFailure: async (_session, error) => {
        await markTrackedImportTerminal({
          importId: record.id,
          status: 'failed',
          error: getErrorMessage(error, 'Upload finalization failed'),
        })
      },
    })
    return NextResponse.json({
      data: await toV2TableImport(await startUploadedTableImport(record.id)),
    })
  } catch (error) {
    const classified = orchestrationErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
