import {
  POWERBI_WORKSPACE_OUTPUT_PROPERTIES,
  type PowerBIListWorkspacesParams,
  type PowerBIListWorkspacesResponse,
} from '@/tools/powerbi/types'
import {
  POWERBI_ACCESS_TOKEN_PARAM,
  powerBICollection,
  powerBIHeaders,
  powerBIInteger,
  powerBIUrl,
  projectPowerBIWorkspace,
  readPowerBIJson,
} from '@/tools/powerbi/utils'
import type { ToolConfig } from '@/tools/types'

export const powerbiListWorkspacesTool: ToolConfig<
  PowerBIListWorkspacesParams,
  PowerBIListWorkspacesResponse
> = {
  id: 'powerbi_list_workspaces',
  name: 'Power BI List Workspaces',
  description: 'List accessible Power BI workspaces with optional OData filtering and pagination.',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',
  oauth: { required: true, provider: 'microsoft-powerbi' },
  params: {
    accessToken: POWERBI_ACCESS_TOKEN_PARAM,
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of workspaces to return',
    },
    skip: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of workspaces to skip',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "OData filter, for example contains(name,'Sales')",
    },
  },
  request: {
    url: (params) =>
      powerBIUrl(['groups'], {
        $top: powerBIInteger(params.top, 'top', 0),
        $skip: powerBIInteger(params.skip, 'skip', 0),
        $filter: params.filter?.trim() || undefined,
      }),
    method: 'GET',
    headers: (params) => powerBIHeaders(params.accessToken),
  },
  transformResponse: async (response, _params, context) => {
    const workspaces = powerBICollection(await readPowerBIJson(response, context?.signal)).map(
      projectPowerBIWorkspace
    )
    return { success: true, output: { workspaces, workspaceCount: workspaces.length } }
  },
  outputs: {
    workspaces: {
      type: 'array',
      description: 'Accessible workspaces returned by this request',
      items: { type: 'object', properties: POWERBI_WORKSPACE_OUTPUT_PROPERTIES },
    },
    workspaceCount: {
      type: 'number',
      description: 'Number of workspaces returned by this request',
    },
  },
}
