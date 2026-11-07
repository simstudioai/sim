import { toArray, toRecord } from '@sim/utils/object'
import type {
  HiggsfieldListCharactersParams,
  HiggsfieldListCharactersResponse,
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

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export const higgsfieldListCharactersTool: ToolConfig<
  HiggsfieldListCharactersParams,
  HiggsfieldListCharactersResponse
> = {
  id: 'higgsfield_list_characters',
  name: 'Higgsfield List Characters',
  description:
    'List the Soul ID character references in the Higgsfield account, one page at a time.',
  version: '1.0.0',
  oauth: higgsfieldOAuth,
  params: {
    ...higgsfieldAuthParams,
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number, starting at 1 (default 1)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Characters per page (default 20)',
    },
  },
  request: {
    url: (params) =>
      buildHiggsfieldUrl('/v1/custom-references/list', {
        page: params.page,
        page_size: params.pageSize,
      }),
    method: 'GET',
    headers: (params) => higgsfieldHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        characters: toArray(data.items).map(mapHiggsfieldCharacter),
        total: numberOrNull(data.total),
        page: numberOrNull(data.page),
        pageSize: numberOrNull(data.page_size),
        totalPages: numberOrNull(data.total_pages),
      },
    }
  },
  outputs: {
    characters: {
      type: 'array',
      description: 'Character references on this page',
      items: { type: 'object', properties: HIGGSFIELD_CHARACTER_PROPERTIES },
    },
    total: { type: 'number', description: 'Total number of characters', nullable: true },
    page: { type: 'number', description: 'Current page number', nullable: true },
    pageSize: { type: 'number', description: 'Characters per page', nullable: true },
    totalPages: { type: 'number', description: 'Total number of pages', nullable: true },
  },
}
