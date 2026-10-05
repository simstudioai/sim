import { z } from 'zod'
import type { FigmaFileParams, FigmaPublishedStyle, FigmaResponse } from '@/tools/figma/types'
import { FIGMA_PUBLISHED_RESOURCE_OUTPUT_PROPERTIES } from '@/tools/figma/types'
import {
  figmaApiUrl,
  figmaFilePath,
  figmaHeaders,
  figmaJson,
  figmaPublishedStyleSchema,
} from '@/tools/figma/utils'
import type { ToolConfig } from '@/tools/types'

export const figmaListFileStylesTool: ToolConfig<
  FigmaFileParams,
  FigmaResponse<{ styles: FigmaPublishedStyle[] }>
> = {
  id: 'figma_list_file_styles',
  name: 'Figma List File Styles',
  description:
    'List published styles in a Figma file library; requires a main file key rather than a branch key',
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
    url: (params) => figmaApiUrl(`${figmaFilePath(params)}/styles`),
    method: 'GET',
    headers: figmaHeaders,
    retry: { enabled: true, maxRetries: 3 },
  },
  transformResponse: async (response, _params, context) => {
    const data = z
      .object({ meta: z.object({ styles: z.array(figmaPublishedStyleSchema) }) })
      .parse(await figmaJson(response, context))
    return { success: true, output: { styles: data.meta.styles } }
  },
  outputs: {
    styles: {
      type: 'array',
      description: 'Published styles',
      items: {
        type: 'object',
        properties: {
          ...FIGMA_PUBLISHED_RESOURCE_OUTPUT_PROPERTIES,
          style_type: { type: 'string', description: 'FILL, TEXT, EFFECT, or GRID' },
          sort_position: { type: 'string', description: 'Publisher-defined sort order' },
        },
      },
    },
  },
}
