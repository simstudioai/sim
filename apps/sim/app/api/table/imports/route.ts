import { type NextRequest, NextResponse } from 'next/server'
import { createTableImportResourceContract } from '@/lib/api/contracts/table-transfers'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createTableImportResource,
  toV2CreateTableImport,
} from '@/lib/table/orchestration/import-resource'
import { orchestrationErrorResponse } from '@/app/api/table/utils'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const parsed = await parseRequest(createTableImportResourceContract, request, {})
  if (!parsed.success) return parsed.response
  try {
    const created = await createTableImportResource(
      parsed.data.body,
      auth.userId,
      request.nextUrl.origin
    )
    return NextResponse.json({ data: toV2CreateTableImport(created) }, { status: 201 })
  } catch (error) {
    const classified = orchestrationErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
