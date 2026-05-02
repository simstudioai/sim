import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  addWorkflowGroupContract,
  deleteWorkflowGroupContract,
  updateWorkflowGroupContract,
} from '@/lib/api/contracts/tables'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { addWorkflowGroup, deleteWorkflowGroup, updateWorkflowGroup } from '@/lib/table/service'
import { accessError, checkAccess, normalizeColumn } from '@/app/api/table/utils'

const logger = createLogger('TableWorkflowGroupsAPI')

interface RouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * Maps known service-layer error messages onto HTTP responses; falls through
 * to a 500 with a generic message for anything unrecognized. The three
 * group-route handlers all surface the same error shapes from
 * `addWorkflowGroup` / `updateWorkflowGroup` / `deleteWorkflowGroup`, so they
 * share this mapper instead of repeating the if-chain three times.
 */
function mapWorkflowGroupError(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof Error) {
    const msg = error.message
    if (msg === 'Table not found' || msg.includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    if (
      msg.includes('Schema validation') ||
      msg.includes('Missing column definition') ||
      msg.includes('already exists') ||
      msg.includes('exceed')
    ) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
  }
  logger.error(fallbackMessage, error)
  return NextResponse.json({ error: fallbackMessage }, { status: 500 })
}

/** POST /api/table/[tableId]/groups — create a workflow group + its output columns. */
export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()
  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const parsed = await parseRequest(addWorkflowGroupContract, request, { params })
    if (!parsed.success) return parsed.response
    const { tableId } = parsed.data.params
    const validated = parsed.data.body
    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)
    if (result.table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }
    const updatedTable = await addWorkflowGroup(
      {
        tableId,
        group: validated.group,
        outputColumns: validated.outputColumns,
        autoRun: validated.autoRun,
      },
      requestId
    )
    return NextResponse.json({
      success: true,
      data: {
        columns: updatedTable.schema.columns.map(normalizeColumn),
        workflowGroups: updatedTable.schema.workflowGroups ?? [],
      },
    })
  } catch (error) {
    return mapWorkflowGroupError(error, 'Failed to add workflow group')
  }
})

/** PATCH /api/table/[tableId]/groups — update a workflow group (deps / outputs). */
export const PATCH = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()
  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const parsed = await parseRequest(updateWorkflowGroupContract, request, { params })
    if (!parsed.success) return parsed.response
    const { tableId } = parsed.data.params
    const validated = parsed.data.body
    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)
    if (result.table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }
    const updatedTable = await updateWorkflowGroup(
      {
        tableId,
        groupId: validated.groupId,
        ...(validated.workflowId !== undefined ? { workflowId: validated.workflowId } : {}),
        ...(validated.name !== undefined ? { name: validated.name } : {}),
        ...(validated.dependencies !== undefined ? { dependencies: validated.dependencies } : {}),
        ...(validated.outputs !== undefined ? { outputs: validated.outputs } : {}),
        ...(validated.newOutputColumns !== undefined
          ? { newOutputColumns: validated.newOutputColumns }
          : {}),
      },
      requestId
    )
    return NextResponse.json({
      success: true,
      data: {
        columns: updatedTable.schema.columns.map(normalizeColumn),
        workflowGroups: updatedTable.schema.workflowGroups ?? [],
      },
    })
  } catch (error) {
    return mapWorkflowGroupError(error, 'Failed to update workflow group')
  }
})

/** DELETE /api/table/[tableId]/groups — remove a workflow group + its columns. */
export const DELETE = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()
  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const parsed = await parseRequest(deleteWorkflowGroupContract, request, { params })
    if (!parsed.success) return parsed.response
    const { tableId } = parsed.data.params
    const validated = parsed.data.body
    const result = await checkAccess(tableId, authResult.userId, 'write')
    if (!result.ok) return accessError(result, requestId, tableId)
    if (result.table.workspaceId !== validated.workspaceId) {
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }
    const updatedTable = await deleteWorkflowGroup(
      { tableId, groupId: validated.groupId },
      requestId
    )
    return NextResponse.json({
      success: true,
      data: {
        columns: updatedTable.schema.columns.map(normalizeColumn),
        workflowGroups: updatedTable.schema.workflowGroups ?? [],
      },
    })
  } catch (error) {
    return mapWorkflowGroupError(error, 'Failed to delete workflow group')
  }
})
