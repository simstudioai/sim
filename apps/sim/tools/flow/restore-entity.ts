import { flowHeaders } from '@/lib/flow'
import type { FlowRestoreEntityParams, FlowRestoreEntityResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  flowUrl,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowRestoreEntityTool: ToolConfig<FlowRestoreEntityParams, FlowRestoreEntityResponse> =
  {
    id: 'flow_restore_entity',
    name: 'Flow Restore Entity',
    description:
      'Restore a deleted entity with its prior fields and links. Restoring a child does not restore its deleted parent.',
    version: '1.0.0',
    oauth: FLOW_OAUTH,
    params: {
      ...FLOW_AUTH_PARAMS,
      projectId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Project UUID returned by List Projects',
      },
      entityId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Entity ID returned by Search Entities or List Entities',
      },
      branchId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Branch ID; omit or use master for Base',
      },
    },
    request: {
      url: (params) =>
        flowUrl(
          params,
          `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities/${safeUrlPathSegment(params.entityId, 'entityId')}/restore`,
          { branch_id: params.branchId?.trim() || undefined }
        ),
      method: 'POST',
      headers: flowHeaders,
      redirectPolicy: () => FLOW_REDIRECT_POLICY,
    },
    transformResponse: async (response) => {
      assertFlowResponse(response)
      return { success: true, output: {} }
    },
    outputs: {},
  }
