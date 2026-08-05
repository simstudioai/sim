import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { createSandboxContract } from '@/lib/api/contracts/sandboxes'
import { parseRequest } from '@/lib/api/server'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createWorkspaceSandbox,
  currentSandboxStrategy,
  listWorkspaceSandboxes,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import {
  authorizeSandboxMutation,
  authorizeSandboxRead,
  sandboxMutationErrorResponse,
} from '@/app/api/workspaces/[id]/sandboxes/authorize'

const logger = createLogger('WorkspaceSandboxesAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const workspaceId = (await context.params).id

    const viewer = await authorizeSandboxRead(request, workspaceId)
    if (!viewer.ok) return viewer.response

    // The list itself is not plan-gated: a workspace that downgraded must still
    // see (and keep executing) what it already built. `entitled` drives whether
    // the editor renders or an upgrade prompt does.
    const [sandboxes, entitled] = await Promise.all([
      listWorkspaceSandboxes(workspaceId),
      hasWorkspaceSandboxAccess(workspaceId),
    ])

    return NextResponse.json({
      sandboxes,
      strategy: currentSandboxStrategy(),
      entitled,
    })
  }
)

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const workspaceId = (await context.params).id

    const authorized = await authorizeSandboxMutation(workspaceId)
    if (!authorized.ok) return authorized.response

    const parsed = await parseRequest(createSandboxContract, request, context)
    if (!parsed.success) return parsed.response
    try {
      const sandbox = await createWorkspaceSandbox(
        workspaceId,
        authorized.actor.userId,
        parsed.data.body
      )
      logger.info('Created workspace sandbox', {
        workspaceId,
        sandboxId: sandbox.id,
        language: sandbox.language,
      })
      return NextResponse.json({ sandbox })
    } catch (error) {
      const response = sandboxMutationErrorResponse(error)
      if (response) return response
      logger.error('Failed to insert sandbox', { workspaceId, error: getErrorMessage(error) })
      throw error
    }
  }
)
