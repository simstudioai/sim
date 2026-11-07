import type {
  HiggsfieldCharacterResponse,
  HiggsfieldCreateCharacterParams,
} from '@/tools/higgsfield/types'
import { HIGGSFIELD_CHARACTER_PROPERTIES } from '@/tools/higgsfield/types'
import {
  buildHiggsfieldUrl,
  higgsfieldAuthParams,
  higgsfieldHeaders,
  higgsfieldOAuth,
  mapHiggsfieldCharacter,
} from '@/tools/higgsfield/utils'
import type { ToolConfig } from '@/tools/types'

const MAX_TRAINING_IMAGES = 100

/** Accepts a JSON array or one image URL per line; URLs may themselves contain commas. */
function parseImageUrls(value: HiggsfieldCreateCharacterParams['imageUrls']): string[] {
  let items: unknown = value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('[')) {
      try {
        items = JSON.parse(trimmed)
      } catch {
        throw new Error('Image URLs must be a JSON array or a list of URLs')
      }
    } else {
      items = trimmed.split('\n')
    }
  }
  if (!Array.isArray(items)) throw new Error('Image URLs must be a list of URLs')
  const urls = items.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
  if (urls.length === 0 || urls.length > MAX_TRAINING_IMAGES) {
    throw new Error(`Provide 1 to ${MAX_TRAINING_IMAGES} training image URLs`)
  }
  return urls
}

export const higgsfieldCreateCharacterTool: ToolConfig<
  HiggsfieldCreateCharacterParams,
  HiggsfieldCharacterResponse
> = {
  id: 'higgsfield_create_character',
  name: 'Higgsfield Create Character',
  description:
    'Train a reusable Soul ID character from public reference image URLs. Training runs in the background; use Get Character to check when it completes.',
  version: '1.0.0',
  oauth: higgsfieldOAuth,
  params: {
    ...higgsfieldAuthParams,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Character name (up to 100 characters)',
    },
    modelVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SOUL family that will use the character: v1, v2, or cinema (default v1)',
    },
    imageUrls: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: '1 to 100 public URLs of reference photos of the character',
      items: { type: 'string', description: 'Public image URL' },
    },
  },
  request: {
    url: () => buildHiggsfieldUrl('/v1/custom-references'),
    method: 'POST',
    headers: (params) => higgsfieldHeaders(params.accessToken, true),
    body: (params) => ({
      name: params.name,
      ...(params.modelVersion ? { model_version: params.modelVersion } : {}),
      input_images: parseImageUrls(params.imageUrls).map((url) => ({
        type: 'image_url',
        image_url: url,
      })),
    }),
  },
  transformResponse: async (response) => ({
    success: true,
    output: { character: mapHiggsfieldCharacter(await response.json()) },
  }),
  outputs: {
    character: {
      type: 'json',
      description: 'Created character reference',
      properties: HIGGSFIELD_CHARACTER_PROPERTIES,
    },
  },
}
