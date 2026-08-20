import {
  BITBUCKET_PAGE_OUTPUT,
  BITBUCKET_REPOSITORY_OUTPUT_PROPERTIES,
  type BitbucketListOutput,
  type BitbucketListRepositoriesParams,
  type BitbucketRepository,
  type BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_ACCESS_TOKEN_PARAM,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_PAGINATION_PARAMS,
  BITBUCKET_READ_RETRY,
  bitbucketApiUrl,
  bitbucketHeaders,
  bitbucketJson,
  encodeBitbucketSegment,
  normalizeBitbucketPage,
  normalizeBitbucketRepository,
} from '@/tools/bitbucket/utils'
import { optionalBitbucketEnum, optionalBitbucketString } from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

const BITBUCKET_REPOSITORY_ROLES = ['admin', 'contributor', 'member', 'owner'] as const

export const bitbucketListRepositoriesTool: ToolConfig<
  BitbucketListRepositoriesParams,
  BitbucketToolResponse<BitbucketListOutput<BitbucketRepository>>
> = {
  id: 'bitbucket_list_repositories',
  name: 'Bitbucket List Repositories',
  description: 'List repositories in a Bitbucket Cloud workspace',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['repository'] },
  params: {
    workspaceSlug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bitbucket workspace slug or UUID',
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Caller role filter: admin, contributor, member, or owner',
    },
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bitbucket filtering expression',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bitbucket sort expression',
    },
    ...BITBUCKET_PAGINATION_PARAMS,
    accessToken: BITBUCKET_ACCESS_TOKEN_PARAM,
  },
  request: {
    url: (params) => {
      const role = optionalBitbucketEnum(params.role, 'role', BITBUCKET_REPOSITORY_ROLES)
      const q = optionalBitbucketString(params.q, 'q')
      const sort = optionalBitbucketString(params.sort, 'sort')
      return bitbucketApiUrl(
        `/repositories/${encodeBitbucketSegment(params.workspaceSlug, 'workspaceSlug')}`,
        {
          nextUrl: params.nextUrl,
          pageLen: params.pageLen,
          query: { role, q, sort },
        }
      )
    },
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: normalizeBitbucketPage(await bitbucketJson(response), normalizeBitbucketRepository),
  }),
  outputs: {
    items: {
      type: 'array',
      description: 'Repositories',
      items: { type: 'object', properties: BITBUCKET_REPOSITORY_OUTPUT_PROPERTIES },
    },
    page: BITBUCKET_PAGE_OUTPUT,
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
