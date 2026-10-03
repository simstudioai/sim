import { executeGetZoneSettingsOperation } from '@/lib/internal/cloudflare/operations/get-zone-settings'
import { executeToolOperationImplementation } from '@/lib/internal/tool-operations/execute'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeCloudflareTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'cloudflare_get_zone_settings':
      return executeToolOperationImplementation(executeGetZoneSettingsOperation, request)
    default:
      return Response.json(
        { success: false, error: `Unsupported cloudflare tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
