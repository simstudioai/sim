import { z } from 'zod'
import type {
  FigmaListVersionsParams,
  FigmaPagination,
  FigmaResponse,
  FigmaVersion,
} from '@/tools/figma/types'
import { FIGMA_VERSION_OUTPUT_PROPERTIES } from '@/tools/figma/types'
import {
  figmaApiUrl,
  figmaFilePath,
  figmaHeaders,
  figmaJson,
  figmaOptionalNumber,
  figmaPaginationSchema,
  figmaVersionCursor,
  figmaVersionSchema,
} from '@/tools/figma/utils'
import type { ToolConfig } from '@/tools/types'

export const figmaListFileVersionsTool: ToolConfig<
  FigmaListVersionsParams,
  FigmaResponse<{ versions: FigmaVersion[]; pagination: FigmaPagination }>
> = {
  id: 'figma_list_file_versions',
  name: 'Figma List File Versions',
  description: 'List one page of Figma file version history with links to previous and next pages',
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
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Versions per page from 1 to 50; default 30',
      default: 30,
    },
    before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Version ID cursor for earlier versions, preserved as a string',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Version ID cursor for later versions, preserved as a string',
    },
  },
  request: {
    url: (params) =>
      figmaApiUrl(`${figmaFilePath(params)}/versions`, {
        page_size:
          figmaOptionalNumber(params.pageSize, 'pageSize', { min: 1, max: 50, integer: true }) ??
          30,
        before: figmaVersionCursor(params.before),
        after: figmaVersionCursor(params.after),
      }),
    method: 'GET',
    headers: figmaHeaders,
    retry: { enabled: true, maxRetries: 3 },
  },
  transformResponse: async (response, _params, context) => {
    const data = z
      .object({ versions: z.array(figmaVersionSchema), pagination: figmaPaginationSchema })
      .parse(await figmaJson(response, context))
    return { success: true, output: data }
  },
  outputs: {
    versions: {
      type: 'array',
      description: 'File versions',
      items: { type: 'object', properties: FIGMA_VERSION_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination links; only the current page is fetched',
      properties: {
        prev_page: {
          type: 'string',
          description: 'Previous-page URL',
          nullable: true,
        },
        next_page: { type: 'string', description: 'Next-page URL', nullable: true },
      },
    },
  },
}
