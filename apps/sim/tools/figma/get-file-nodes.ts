import { z } from 'zod'
import type { FigmaGetFileNodesParams, FigmaResponse } from '@/tools/figma/types'
import {
  figmaApiUrl,
  figmaFileNodesSchema,
  figmaFilePath,
  figmaHeaders,
  figmaJson,
  figmaNodeIds,
  figmaOptionalNumber,
  figmaOptionalString,
} from '@/tools/figma/utils'
import type { ToolConfig } from '@/tools/types'

export const figmaGetFileNodesTool: ToolConfig<
  FigmaGetFileNodesParams,
  FigmaResponse<z.output<typeof figmaFileNodesSchema>>
> = {
  id: 'figma_get_file_nodes',
  name: 'Figma Get File Nodes',
  description: 'Read selected Figma nodes and their descendants; missing node IDs remain null',
  version: '1.0.0',
  oauth: { required: true, provider: 'figma' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Figma OAuth access token',
    },
    fileKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Figma file key or HTTPS Figma file URL',
    },
    version: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Specific file version ID',
    },
    nodeIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated node IDs to include',
    },
    depth: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Positive traversal depth; omitted returns all descendants',
    },
    geometry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to paths to include vector geometry',
    },
    pluginData: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated plugin IDs, optionally shared',
    },
  },
  request: {
    url: (params) =>
      figmaApiUrl(`${figmaFilePath(params)}/nodes`, {
        version: figmaOptionalString(params.version, 'version'),
        depth: figmaOptionalNumber(params.depth, 'depth', { min: 1, integer: true }),
        geometry:
          params.geometry === undefined || params.geometry === ''
            ? undefined
            : z.literal('paths').parse(params.geometry),
        plugin_data: figmaOptionalString(params.pluginData, 'pluginData'),
        ids: figmaNodeIds(params.nodeIds),
      }),
    method: 'GET',
    headers: figmaHeaders,
    retry: { enabled: true, maxRetries: 3 },
  },
  transformResponse: async (response, _params, context) => {
    return { success: true, output: figmaFileNodesSchema.parse(await figmaJson(response, context)) }
  },
  outputs: {
    name: { type: 'string', description: 'File name' },
    role: { type: 'string', description: 'Caller file role' },
    lastModified: { type: 'string', description: 'Last modification timestamp' },
    editorType: { type: 'string', description: 'Figma editor type' },
    thumbnailUrl: { type: 'string', description: 'Thumbnail URL', optional: true, nullable: true },
    version: { type: 'string', description: 'Current version ID' },
    nodes: {
      type: 'json',
      description:
        'Map from node ID to null or { document, components, componentSets, schemaVersion, styles }; document retains its recursive Figma properties',
    },
  },
}
