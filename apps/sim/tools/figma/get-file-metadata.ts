import { z } from 'zod'
import type { FigmaFileParams, FigmaResponse } from '@/tools/figma/types'
import { FIGMA_FILE_METADATA_OUTPUT_PROPERTIES } from '@/tools/figma/types'
import {
  figmaApiUrl,
  figmaFileMetadataSchema,
  figmaFilePath,
  figmaHeaders,
  figmaJson,
} from '@/tools/figma/utils'
import type { ToolConfig } from '@/tools/types'

export const figmaGetFileMetadataTool: ToolConfig<
  FigmaFileParams,
  FigmaResponse<{ file: z.output<typeof figmaFileMetadataSchema> }>
> = {
  id: 'figma_get_file_metadata',
  name: 'Figma Get File Metadata',
  description: 'Read lightweight metadata for a Figma file without loading its document tree',
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
    url: (params) => figmaApiUrl(`${figmaFilePath(params)}/meta`),
    method: 'GET',
    headers: figmaHeaders,
    retry: { enabled: true, maxRetries: 3 },
  },
  transformResponse: async (response, _params, context) => {
    const data = z
      .object({ file: figmaFileMetadataSchema })
      .parse(await figmaJson(response, context))
    return { success: true, output: { file: data.file } }
  },
  outputs: {
    file: {
      type: 'object',
      description: 'File metadata',
      properties: FIGMA_FILE_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
