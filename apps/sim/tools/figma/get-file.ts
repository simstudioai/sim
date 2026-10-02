import { z } from 'zod'
import type { FigmaGetFileParams, FigmaResponse } from '@/tools/figma/types'
import {
  figmaApiUrl,
  figmaFilePath,
  figmaFileSchema,
  figmaHeaders,
  figmaJson,
  figmaNodeIds,
  figmaOptionalBoolean,
  figmaOptionalNumber,
  figmaOptionalString,
} from '@/tools/figma/utils'
import type { ToolConfig } from '@/tools/types'

export const figmaGetFileTool: ToolConfig<
  FigmaGetFileParams,
  FigmaResponse<z.output<typeof figmaFileSchema>>
> = {
  id: 'figma_get_file',
  name: 'Figma Get File Contents',
  description: 'Read a Figma document tree and its component, style, and branch metadata',
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
      required: false,
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
    branchData: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include branch metadata',
    },
  },
  request: {
    url: (params) =>
      figmaApiUrl(figmaFilePath(params), {
        version: figmaOptionalString(params.version, 'version'),
        depth: figmaOptionalNumber(params.depth, 'depth', { min: 1, integer: true }),
        geometry:
          params.geometry === undefined || params.geometry === ''
            ? undefined
            : z.literal('paths').parse(params.geometry),
        plugin_data: figmaOptionalString(params.pluginData, 'pluginData'),
        ids:
          params.nodeIds === undefined || params.nodeIds === ''
            ? undefined
            : figmaNodeIds(params.nodeIds),
        branch_data: figmaOptionalBoolean(params.branchData, 'branchData'),
      }),
    method: 'GET',
    headers: figmaHeaders,
    retry: { enabled: true, maxRetries: 3 },
  },
  transformResponse: async (response, _params, context) => {
    return { success: true, output: figmaFileSchema.parse(await figmaJson(response, context)) }
  },
  outputs: {
    name: { type: 'string', description: 'File name' },
    role: { type: 'string', description: 'Caller file role' },
    lastModified: { type: 'string', description: 'Last modification timestamp' },
    editorType: { type: 'string', description: 'Figma editor type' },
    thumbnailUrl: { type: 'string', description: 'Thumbnail URL', nullable: true },
    version: { type: 'string', description: 'Current version ID' },
    document: {
      type: 'json',
      description:
        'Recursive Figma node tree with id, name, type, children, and node-specific layout, geometry, text, and paint fields',
      properties: {
        id: { type: 'string', description: 'Node ID' },
        name: { type: 'string', description: 'Node name' },
        type: { type: 'string', description: 'Node type' },
        children: {
          type: 'array',
          description: 'Child nodes with recursive node-specific properties',
          optional: true,
          items: { type: 'json' },
        },
      },
    },
    components: {
      type: 'json',
      description:
        'Component metadata keyed by node ID (key, name, description, remote, componentSetId, documentationLinks)',
    },
    componentSets: {
      type: 'json',
      description:
        'Component-set metadata keyed by node ID (key, name, description, remote, documentationLinks)',
    },
    styles: {
      type: 'json',
      description: 'Style metadata keyed by style ID (key, name, description, remote, styleType)',
    },
    schemaVersion: { type: 'number', description: 'Document schema version' },
    linkAccess: {
      type: 'string',
      description: 'Link access policy',
      nullable: true,
    },
    mainFileKey: {
      type: 'string',
      description: 'Main file key for a branch',
      nullable: true,
    },
    branches: {
      type: 'array',
      description: 'File branches when requested',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Branch file key' },
          name: { type: 'string', description: 'Branch name' },
          thumbnail_url: {
            type: 'string',
            description: 'Branch thumbnail URL',
            nullable: true,
          },
          last_modified: { type: 'string', description: 'Branch last modification timestamp' },
          link_access: {
            type: 'string',
            description: 'Branch link access policy',
            nullable: true,
          },
        },
      },
    },
  },
}
