import { type NextRequest, NextResponse } from 'next/server'
import {
  cancelTableImportResourceContract,
  getTableImportResourceContract,
} from '@/lib/api/contracts/table-transfers'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  cancelTableImportResource,
  getOwnedTableImport,
  toV2TableImport,
} from '@/lib/table/orchestration/import-resource'
import { orchestrationErrorResponse } from '@/app/api/table/utils'

interface ImportRouteParams {
  params: Promise<{ importId: string }>
}

async function userId(request: NextRequest): Promise<string | NextResponse> {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  return auth.success && auth.userId
    ? auth.userId
    : NextResponse.json({ error: 'Authentication required' }, { status: 401 })
}

export const GET = withRouteHandler(async (request: NextRequest, context: ImportRouteParams) => {
  const user = await userId(request)
  if (user instanceof NextResponse) return user
  const parsed = await parseRequest(getTableImportResourceContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const record = await getOwnedTableImport({
      importId: parsed.data.params.importId,
      workspaceId: parsed.data.query.workspaceId,
      userId: user,
    })
    return NextResponse.json({ data: await toV2TableImport(record) })
  } catch (error) {
    const classified = orchestrationErrorResponse(error)
    if (classified) return classified
    throw error
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: ImportRouteParams) => {
  const user = await userId(request)
  if (user instanceof NextResponse) return user
  const parsed = await parseRequest(cancelTableImportResourceContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const record = await getOwnedTableImport({
      importId: parsed.data.params.importId,
      workspaceId: parsed.data.query.workspaceId,
      userId: user,
    })
    return NextResponse.json({
      data: await toV2TableImport(await cancelTableImportResource(record)),
    })
  } catch (error) {
    const classified = orchestrationErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
