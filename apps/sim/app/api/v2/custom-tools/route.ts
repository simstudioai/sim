import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import {
  v2CreateCustomToolContract,
  v2ListCustomToolsContract,
} from '@/lib/api/contracts/v2/custom-tools'
import {
  getWorkspaceCustomToolByTitle,
  listWorkspaceCustomTools,
  upsertCustomTools,
} from '@/lib/workflows/custom-tools/operations'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2CustomTool, v2CustomToolWriteError } from '@/app/api/v2/custom-tools/utils'
import { v2CursorList, v2Data, v2Error, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/custom-tools — List custom tools in a workspace. */
export const GET = withPublicApiRouteHandler({
  contract: v2ListCustomToolsContract,
  rateLimitEndpoint: 'custom-tools',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId, search, sortBy, sortOrder } = input.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const rows = await listWorkspaceCustomTools({ workspaceId, search, sortBy, sortOrder })

    // The per-workspace tool set is small and bounded → a single full page.
    return v2CursorList(rows.map(toV2CustomTool), null, { rateLimit })
  },
})

/** POST /api/v2/custom-tools — Create a custom tool. */
export const POST = withPublicApiRouteHandler({
  contract: v2CreateCustomToolContract,
  rateLimitEndpoint: 'custom-tools',
  handler: async ({ request, input, auth: { requestId, userId, rateLimit } }) => {
    try {
      const { workspaceId, title, schema, code } = input.body

      const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
      if (access) return v2WorkspaceAccessError(access)

      /**
       * Titles are unique per workspace and tools resolve by title at call time,
       * so a collision is reported rather than surfacing as a unique-index 500.
       */
      if (await getWorkspaceCustomToolByTitle({ workspaceId, title })) {
        return v2Error(
          'CONFLICT',
          `A custom tool titled "${title}" already exists in this workspace`
        )
      }

      const tools = await upsertCustomTools({
        tools: [{ title, schema, code }],
        workspaceId,
        userId,
        requestId,
      })
      const created = tools.find((tool) => tool.title === title)
      if (!created) {
        throw new Error(`Custom tool "${title}" missing after a successful write`)
      }

      recordAudit({
        workspaceId,
        actorId: userId,
        action: AuditAction.CUSTOM_TOOL_CREATED,
        resourceType: AuditResourceType.CUSTOM_TOOL,
        resourceId: created.id,
        resourceName: created.title,
        description: `Created custom tool "${created.title}" via API`,
        request,
      })

      return v2Data({ customTool: toV2CustomTool(created) }, { rateLimit, status: 201 })
    } catch (error) {
      const writeError = v2CustomToolWriteError(error)
      if (writeError) return writeError

      throw error
    }
  },
})
