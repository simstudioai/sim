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
  sandboxFailureResponse,
} from '@/app/api/workspaces/[id]/sandboxes/authorize'

type SandboxContext = { params: Promise<{ id: string; sandboxId: string }> }

export const PATCH = withRouteHandler(async (request: NextRequest, context: SandboxContext) => {
  const { id: workspaceId, sandboxId } = await context.params

  const authorized = await authorizeSandboxMutation(workspaceId)
  if (!authorized.ok) return authorized.response

  const parsed = await parseRequest(updateSandboxContract, request, context)
  if (!parsed.success) return parsed.response
  const { name, language, dependencies } = parsed.data.body

  const result = await updateWorkspaceSandbox({
    workspaceId,
    sandboxId,
    name,
    language,
    dependencies,
  })
  if (!result.ok) return sandboxFailureResponse(result.failure)

  return NextResponse.json({ sandbox: result.sandbox })
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: SandboxContext) => {
  const { id: workspaceId, sandboxId } = await context.params

  const authorized = await authorizeSandboxMutation(workspaceId)
  if (!authorized.ok) return authorized.response

  const parsed = await parseRequest(deleteSandboxContract, request, context)
  if (!parsed.success) return parsed.response

  const result = await deleteWorkspaceSandbox(workspaceId, sandboxId)
  if (!result.ok) return sandboxFailureResponse(result.failure)

  return NextResponse.json({ success: true })
})
