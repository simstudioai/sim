import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import {
  v2DeleteCustomToolContract,
  v2GetCustomToolContract,
  v2UpdateCustomToolContract,
} from '@/lib/api/contracts/v2/custom-tools'
import {
  deleteWorkspaceCustomTool,
  getWorkspaceCustomTool,
  getWorkspaceCustomToolByTitle,
  updateWorkspaceCustomTool,
} from '@/lib/workflows/custom-tools/operations'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2CustomTool, v2CustomToolWriteError } from '@/app/api/v2/custom-tools/utils'
import { v2Data, v2Error, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteContext {
  params: Promise<{ id: string }>
}

/** GET /api/v2/custom-tools/[id] — Fetch a single custom tool. */
export const GET = withPublicApiRouteHandler({
  contract: v2GetCustomToolContract,
  rateLimitEndpoint: 'custom-tool-detail',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { id } = input.params
    const { workspaceId } = input.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const tool = await getWorkspaceCustomTool({ workspaceId, toolId: id })
    if (!tool) return v2Error('NOT_FOUND', 'Custom tool not found')

    return v2Data({ customTool: toV2CustomTool(tool) }, { rateLimit })
  },
})

/** PATCH /api/v2/custom-tools/[id] — Update a custom tool. Omitted fields keep their values. */
export const PATCH = withPublicApiRouteHandler({
  contract: v2UpdateCustomToolContract,
  rateLimitEndpoint: 'custom-tool-detail',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    try {
      const { id } = input.params
      const { workspaceId, title, schema, code } = input.body

      const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
      if (access) return v2WorkspaceAccessError(access)

      const current = await getWorkspaceCustomTool({ workspaceId, toolId: id })
      if (!current) return v2Error('NOT_FOUND', 'Custom tool not found')

      /**
       * `upsertCustomTools` replaces title/schema/code wholesale and checks for a
       * duplicate title only when inserting, so a rename onto an existing title
       * would hit the `custom_tools_workspace_title_unique` index as a 500. Merge
       * the partial body against the stored row and check the rename here.
       */
      if (title !== undefined && title !== current.title) {
        if (await getWorkspaceCustomToolByTitle({ workspaceId, title })) {
          return v2Error(
            'CONFLICT',
            `A custom tool titled "${title}" already exists in this workspace`
          )
        }
      }

      const updated = await updateWorkspaceCustomTool({
        workspaceId,
        toolId: id,
        title: title ?? current.title,
        schema: schema ?? current.schema,
        code: code ?? current.code,
      })
      if (!updated) return v2Error('NOT_FOUND', 'Custom tool not found')

      recordAudit({
        workspaceId,
        actorId: userId,
        action: AuditAction.CUSTOM_TOOL_UPDATED,
        resourceType: AuditResourceType.CUSTOM_TOOL,
        resourceId: updated.id,
        resourceName: updated.title,
        description: `Updated custom tool "${updated.title}" via API`,
        request,
      })

      return v2Data({ customTool: toV2CustomTool(updated) }, { rateLimit })
    } catch (error) {
      const writeError = v2CustomToolWriteError(error)
      if (writeError) return writeError

      throw error
    }
  },
})

/** DELETE /api/v2/custom-tools/[id] — Delete a custom tool. */
export const DELETE = withPublicApiRouteHandler({
  contract: v2DeleteCustomToolContract,
  rateLimitEndpoint: 'custom-tool-detail',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    const { id } = input.params
    const { workspaceId } = input.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const tool = await getWorkspaceCustomTool({ workspaceId, toolId: id })
    if (!tool) return v2Error('NOT_FOUND', 'Custom tool not found')

    const deleted = await deleteWorkspaceCustomTool({ workspaceId, toolId: id })
    if (!deleted) return v2Error('NOT_FOUND', 'Custom tool not found')

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.CUSTOM_TOOL_DELETED,
      resourceType: AuditResourceType.CUSTOM_TOOL,
      resourceId: id,
      resourceName: tool.title,
      description: `Deleted custom tool "${tool.title}" via API`,
      request,
    })

    return v2Data({ id, deleted: true as const }, { rateLimit })
  },
})
