import { db } from '@sim/db'
import { workspaceSandbox } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { createSandboxContract } from '@/lib/api/contracts/sandboxes'
import { parseRequest } from '@/lib/api/server'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  currentSandboxStrategy,
  isSandboxNameTaken,
  listWorkspaceSandboxes,
  readWorkspaceSandbox,
  scheduleSandboxBuild,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import {
  authorizeSandboxMutation,
  authorizeSandboxRead,
  buildSpecOrResponse,
  isNameConflictError,
  nameConflictResponse,
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
    const { name, language, dependencies } = parsed.data.body

    const built = buildSpecOrResponse(language, dependencies)
    if (!built.ok) return built.response
    const { spec } = built

    if (await isSandboxNameTaken(workspaceId, name)) {
      return nameConflictResponse(name)
    }

    const id = generateId()
    try {
      await db.insert(workspaceSandbox).values({
        id,
        workspaceId,
        name,
        language: spec.language,
        dependencies: spec.dependencies,
        specHash: spec.specHash,
        createdBy: authorized.actor.userId,
      })
    } catch (error) {
      // The unique index is the real arbiter — the pre-check above only exists to
      // return a friendlier message when there is no race.
      if (isNameConflictError(error)) return nameConflictResponse(name)
      logger.error('Failed to insert sandbox', { workspaceId, error: getErrorMessage(error) })
      throw error
    }

    await scheduleSandboxBuild(spec)
    logger.info('Created workspace sandbox', { workspaceId, sandboxId: id, language })

    const sandbox = await readWorkspaceSandbox(workspaceId, id)
    if (!sandbox) {
      return NextResponse.json(
        { error: 'Failed to read back the created sandbox' },
        { status: 500 }
      )
    }
    return NextResponse.json({ sandbox })
  }
)
