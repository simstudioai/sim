import type { CodaSearchPrincipalsParams, CodaSearchPrincipalsResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  optionalTrimmed,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

interface RawSearchPrincipals {
  users?: Array<{ name: string; loginId: string; pictureLink?: string }>
  groups?: Array<{ groupId: string; groupName: string }>
}

export const codaSearchPrincipalsTool: ToolConfig<
  CodaSearchPrincipalsParams,
  CodaSearchPrincipalsResponse
> = {
  id: 'coda_search_principals',
  name: 'Coda Search Principals',
  description:
    'Search for users and groups a Coda doc can be shared with (up to 20 of each). Returns nothing without a query.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name or email to search for',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'acl', 'principals', 'search'), {
        query: optionalTrimmed(params.query),
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as RawSearchPrincipals
    return {
      success: true,
      output: {
        users: (data.users ?? []).map((user) => ({
          name: user.name,
          loginId: user.loginId,
          pictureLink: user.pictureLink ?? null,
        })),
        groups: (data.groups ?? []).map((group) => ({
          groupId: group.groupId,
          groupName: group.groupName,
        })),
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'Matching users',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'User name' },
          loginId: { type: 'string', description: 'User email address' },
          pictureLink: { type: 'string', description: 'Avatar link', nullable: true },
        },
      },
    },
    groups: {
      type: 'array',
      description: 'Matching groups',
      items: {
        type: 'object',
        properties: {
          groupId: { type: 'string', description: 'Group ID' },
          groupName: { type: 'string', description: 'Group name' },
        },
      },
    },
  },
}
