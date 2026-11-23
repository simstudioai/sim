import type {
  HiggsfieldCharacterIdParams,
  HiggsfieldCharacterResponse,
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
import { safeUrlPathSegment } from '@/tools/url-path'

export const higgsfieldGetCharacterTool: ToolConfig<
  HiggsfieldCharacterIdParams,
  HiggsfieldCharacterResponse
> = {
  id: 'higgsfield_get_character',
  name: 'Higgsfield Get Character',
  description: 'Get a Soul ID character reference, including its training status.',
  version: '1.0.0',
  oauth: higgsfieldOAuth,
  params: {
    ...higgsfieldAuthParams,
    characterId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Soul ID character reference ID',
    },
  },
  request: {
    url: (params) =>
      buildHiggsfieldUrl(
        `/v1/custom-references/${safeUrlPathSegment(params.characterId.trim(), 'characterId')}`
      ),
    method: 'GET',
    headers: (params) => higgsfieldHeaders(params.accessToken),
  },
  transformResponse: async (response) => ({
    success: true,
    output: { character: mapHiggsfieldCharacter(await response.json()) },
  }),
  outputs: {
    character: {
      type: 'json',
      description: 'Character reference',
      properties: HIGGSFIELD_CHARACTER_PROPERTIES,
    },
  },
}
