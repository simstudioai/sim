import { z } from 'zod'
import type { FigmaFileParams, FigmaPublishedComponent, FigmaResponse } from '@/tools/figma/types'
import { FIGMA_PUBLISHED_RESOURCE_OUTPUT_PROPERTIES } from '@/tools/figma/types'
import {
  figmaApiUrl,
  figmaFilePath,
  figmaHeaders,
  figmaJson,
  figmaPublishedComponentSchema,
} from '@/tools/figma/utils'
import type { ToolConfig } from '@/tools/types'

export const figmaListFileComponentsTool: ToolConfig<
  FigmaFileParams,
  FigmaResponse<{ components: FigmaPublishedComponent[] }>
> = {
  id: 'figma_list_file_components',
  name: 'Figma List File Components',
  description:
    'List published components in a Figma file library; requires a main file key rather than a branch key',
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
  },
  request: {
    url: (params) => figmaApiUrl(`${figmaFilePath(params)}/components`),
    method: 'GET',
    headers: figmaHeaders,
    retry: { enabled: true, maxRetries: 3 },
  },
  transformResponse: async (response, _params, context) => {
    const data = z
      .object({ meta: z.object({ components: z.array(figmaPublishedComponentSchema) }) })
      .parse(await figmaJson(response, context))
    return { success: true, output: { components: data.meta.components } }
  },
  outputs: {
    components: {
      type: 'array',
      description: 'Published components',
      items: {
        type: 'object',
        properties: {
          ...FIGMA_PUBLISHED_RESOURCE_OUTPUT_PROPERTIES,
          containing_frame: {
            type: 'object',
            description: 'Containing page/frame',
            nullable: true,
            properties: {
              nodeId: {
                type: 'string',
                description: 'Containing node ID',
                nullable: true,
              },
              name: {
                type: 'string',
                description: 'Containing node name',
                nullable: true,
              },
              backgroundColor: {
                type: 'string',
                description: 'Frame background color',
                nullable: true,
              },
              pageId: { type: 'string', description: 'Containing page ID' },
              pageName: { type: 'string', description: 'Containing page name' },
              containingComponentSet: {
                type: 'object',
                description: 'Containing component set',
                nullable: true,
                properties: {
                  nodeId: {
                    type: 'string',
                    description: 'Containing node ID',
                    nullable: true,
                  },
                  name: {
                    type: 'string',
                    description: 'Containing node name',
                    nullable: true,
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}
