import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { deleteSandboxContract, updateSandboxContract } from '@/lib/api/contracts/sandboxes'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  deleteWorkspaceSandbox,
  updateWorkspaceSandbox,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import {
  authorizeSandboxMutation,
  sandboxMutationErrorResponse,
} from '@/app/api/workspaces/[id]/sandboxes/authorize'

const logger = createLogger('WorkspaceSandboxAPI')

type SandboxContext = { params: Promise<{ id: string; sandboxId: string }> }

export const PATCH = withRouteHandler(async (request: NextRequest, context: SandboxContext) => {
  const { id: workspaceId, sandboxId } = await context.params

  const authorized = await authorizeSandboxMutation(workspaceId)
  if (!authorized.ok) return authorized.response

  const parsed = await parseRequest(updateSandboxContract, request, context)
  if (!parsed.success) return parsed.response
  try {
    const sandbox = await updateWorkspaceSandbox(workspaceId, sandboxId, parsed.data.body)
    logger.info('Updated workspace sandbox', { workspaceId, sandboxId })
    return NextResponse.json({ sandbox })
  } catch (error) {
    const response = sandboxMutationErrorResponse(error)
    if (response) return response
    throw error
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: SandboxContext) => {
  const { id: workspaceId, sandboxId } = await context.params

  const authorized = await authorizeSandboxMutation(workspaceId)
  if (!authorized.ok) return authorized.response

  const parsed = await parseRequest(deleteSandboxContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    await deleteWorkspaceSandbox(workspaceId, sandboxId)
  } catch (error) {
    const response = sandboxMutationErrorResponse(error)
    if (response) return response
    throw error
  }

  logger.info('Deleted workspace sandbox', { workspaceId, sandboxId })
  return NextResponse.json({ success: true })
})
