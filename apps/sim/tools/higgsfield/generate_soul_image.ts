import type {
  HiggsfieldGenerateSoulImageParams,
  HiggsfieldRequestResponse,
} from '@/tools/higgsfield/types'
import { HIGGSFIELD_REQUEST_OUTPUTS } from '@/tools/higgsfield/types'
import {
  buildGenerationRequest,
  higgsfieldAuthParams,
  higgsfieldGenerationControlParams,
  higgsfieldOAuth,
  mapHiggsfieldRequest,
  waitForHiggsfieldRequest,
} from '@/tools/higgsfield/utils'
import type { ToolConfig } from '@/tools/types'

const SOUL_ENDPOINT = 'higgsfield-ai/soul/standard'
const SOUL_BATCH_SIZES = new Set([1, 4])

export const higgsfieldGenerateSoulImageTool: ToolConfig<
  HiggsfieldGenerateSoulImageParams,
  HiggsfieldRequestResponse
> = {
  id: 'higgsfield_generate_soul_image',
  name: 'Higgsfield Generate SOUL Image',
  description:
    'Generate images with Higgsfield SOUL, optionally in a style or as a trained Soul ID character, then wait for the image URLs.',
  version: '1.0.0',
  oauth: higgsfieldOAuth,
  params: {
    ...higgsfieldAuthParams,
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text description of the image',
    },
    aspectRatio: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Aspect ratio: 9:16, 16:9, 4:3, 3:4, 1:1, 2:3, or 3:2 (default 4:3)',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resolution: 720p or 1080p (default 720p)',
    },
    batchSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of images: 1 or 4 (default 1)',
    },
    styleId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SOUL style UUID (defaults to the general style)',
    },
    styleStrength: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Style strength from 0 to 1 (default 1)',
    },
    characterId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Completed Soul ID character reference ID (model version v1) owned by the account',
    },
    characterStrength: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: "Character strength from 0 to 1; 0 uses the style's default (default 1)",
    },
    imageReferenceUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Public image URL that guides prompt enhancement',
    },
    enhancePrompt: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Let Higgsfield enhance the prompt (default false)',
    },
    seed: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Seed from 1 to 1000000 for repeatable results',
    },
    ...higgsfieldGenerationControlParams,
  },
  request: {
    url: (params) => buildGenerationRequest(SOUL_ENDPOINT, params).url,
    method: 'POST',
    headers: (params) => buildGenerationRequest(SOUL_ENDPOINT, params).headers,
    body: (params) => {
      const body: Record<string, unknown> = { prompt: params.prompt }
      if (params.aspectRatio) body.aspect_ratio = params.aspectRatio
      if (params.resolution) body.resolution = params.resolution
      if (params.batchSize !== undefined) {
        if (!SOUL_BATCH_SIZES.has(params.batchSize)) {
          throw new Error('Number of images must be 1 or 4')
        }
        body.batch_size = params.batchSize
      }
      if (params.styleId?.trim()) body.style_id = params.styleId.trim()
      if (params.styleStrength !== undefined) body.style_strength = params.styleStrength
      if (params.characterId?.trim()) body.custom_reference_id = params.characterId.trim()
      if (params.characterStrength !== undefined) {
        body.custom_reference_strength = params.characterStrength
      }
      if (params.imageReferenceUrl?.trim())
        body.image_reference_url = params.imageReferenceUrl.trim()
      if (params.enhancePrompt !== undefined) body.enhance_prompt = params.enhancePrompt
      if (params.seed !== undefined) body.seed = params.seed
      return body
    },
  },
  transformResponse: async (response) => ({
    success: true,
    output: mapHiggsfieldRequest(await response.json()),
  }),
  postProcess: waitForHiggsfieldRequest,
  outputs: HIGGSFIELD_REQUEST_OUTPUTS,
}
