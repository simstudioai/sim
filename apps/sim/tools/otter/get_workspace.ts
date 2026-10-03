import type { OtterGetWorkspaceParams, OtterGetWorkspaceResponse } from '@/tools/otter/types'
import {
  mapOtterWorkspace,
  OTTER_API_BASE,
  OTTER_RETRIEVED_AT_OUTPUT,
  OTTER_USER_PROPERTIES,
  otterHeaders,
  readOtterDataObject,
  readOtterRetrievedAt,
} from '@/tools/otter/utils'
import type { ToolConfig } from '@/tools/types'

export const otterGetWorkspaceTool: ToolConfig<OtterGetWorkspaceParams, OtterGetWorkspaceResponse> =
  {
    id: 'otter_get_workspace',
    name: 'Otter Get Workspace',
    description:
      'Get the Otter workspace of the authenticated user, including its ID, name, owner, member count, handle, and type.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Otter API key',
      },
    },

    request: {
      url: `${OTTER_API_BASE}/workspace`,
      method: 'GET',
      headers: (params) => otterHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      const body = await response.json()
      return {
        success: true,
        output: {
          ...mapOtterWorkspace(readOtterDataObject(body)),
          retrievedAt: readOtterRetrievedAt(body),
        },
      }
    },

    outputs: {
      workspaceId: {
        type: 'number',
        description: 'Workspace ID (the id field); pass it to List Workspace Conversations',
        nullable: true,
      },
      name: { type: 'string', description: 'Workspace name', nullable: true },
      owner: {
        type: 'object',
        description: 'Workspace owner',
        nullable: true,
        properties: OTTER_USER_PROPERTIES,
      },
      memberCount: {
        type: 'number',
        description: 'Number of workspace members',
        nullable: true,
      },
      handle: {
        type: 'string',
        description: 'Workspace handle (e.g., a domain such as otter.ai)',
        nullable: true,
      },
      type: { type: 'string', description: 'Workspace type (e.g., business)', nullable: true },
      retrievedAt: OTTER_RETRIEVED_AT_OUTPUT,
    },
  }
