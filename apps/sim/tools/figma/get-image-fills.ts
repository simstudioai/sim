import { z } from 'zod'
import type { FigmaFileParams, FigmaResponse } from '@/tools/figma/types'
import { figmaApiUrl, figmaFilePath, figmaHeaders, figmaJson } from '@/tools/figma/utils'
import type { ToolConfig } from '@/tools/types'

export const figmaGetImageFillsTool: ToolConfig<
  FigmaFileParams,
  FigmaResponse<{ images: Record<string, string> }>
> = {
  id: 'figma_get_image_fills',
  name: 'Figma Get Image Fills',
  description:
    'Get temporary URLs for original image fills in a Figma file; links expire within 14 days',
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
    url: (params) => figmaApiUrl(`${figmaFilePath(params)}/images`),
    method: 'GET',
    headers: figmaHeaders,
    retry: { enabled: true, maxRetries: 3 },
  },
  transformResponse: async (response, _params, context) => {
    const data = z
      .object({ meta: z.object({ images: z.record(z.string(), z.string()) }) })
      .parse(await figmaJson(response, context))
    return { success: true, output: { images: data.meta.images } }
  },
  outputs: {
    images: {
      type: 'json',
      description: 'Map from imageRef values to original-image URLs that expire within 14 days',
    },
  },
}
