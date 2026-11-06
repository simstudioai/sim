import type {
  HiggsfieldCharacterIdParams,
  HiggsfieldDeleteCharacterResponse,
} from '@/tools/higgsfield/types'
import {
  buildHiggsfieldUrl,
  higgsfieldAuthParams,
  higgsfieldHeaders,
  higgsfieldOAuth,
} from '@/tools/higgsfield/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const higgsfieldDeleteCharacterTool: ToolConfig<
  HiggsfieldCharacterIdParams,
  HiggsfieldDeleteCharacterResponse
> = {
  id: 'higgsfield_delete_character',
  name: 'Higgsfield Delete Character',
  description: 'Permanently delete a Soul ID character reference.',
  version: '1.0.0',
  oauth: higgsfieldOAuth,
  params: {
    ...higgsfieldAuthParams,
    characterId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Soul ID character reference ID to delete',
    },
  },
  request: {
    url: (params) =>
      buildHiggsfieldUrl(
        `/v1/custom-references/${safeUrlPathSegment(params.characterId.trim(), 'characterId')}`
      ),
    method: 'DELETE',
    headers: (params) => higgsfieldHeaders(params.accessToken),
  },
  transformResponse: async (_response, params) => {
    if (!params) throw new Error('Higgsfield delete character requires request context')
    return { success: true, output: { characterId: params.characterId.trim(), deleted: true } }
  },
  outputs: {
    characterId: { type: 'string', description: 'ID of the deleted character' },
    deleted: { type: 'boolean', description: 'Whether the character was deleted' },
  },
}
