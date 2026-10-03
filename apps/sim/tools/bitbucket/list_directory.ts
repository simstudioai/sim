import {
  BITBUCKET_DIRECTORY_ENTRY_OUTPUT_PROPERTIES,
  BITBUCKET_PAGE_OUTPUT,
  type BitbucketDirectoryEntry,
  type BitbucketListDirectoryParams,
  type BitbucketListOutput,
  type BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_PAGINATION_PARAMS,
  BITBUCKET_READ_RETRY,
  BITBUCKET_REPOSITORY_PARAMS,
  bitbucketApiUrl,
  bitbucketHeaders,
  bitbucketJson,
  bitbucketRepositoryPath,
  encodeBitbucketRepositoryPath,
  encodeBitbucketSegment,
  normalizeBitbucketDirectoryEntry,
  normalizeBitbucketPage,
} from '@/tools/bitbucket/utils'
import { optionalBitbucketString, requireBitbucketSha1 } from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

export const bitbucketListDirectoryTool: ToolConfig<
  BitbucketListDirectoryParams,
  BitbucketToolResponse<BitbucketListOutput<BitbucketDirectoryEntry>>
> = {
  id: 'bitbucket_list_directory',
  name: 'Bitbucket List Directory',
  description: 'List one shallow repository directory at a full commit SHA-1',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['repository'] },
  params: {
    ...BITBUCKET_REPOSITORY_PARAMS,
    commit: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full 40-character commit SHA-1',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Repository-relative directory path; omit for the root',
    },
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bitbucket tree-entry filtering expression',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bitbucket tree-entry sort expression',
    },
    ...BITBUCKET_PAGINATION_PARAMS,
  },
  request: {
    url: (params) => {
      const directoryPath = encodeBitbucketRepositoryPath(params.path ?? '', true)
      const commit = requireBitbucketSha1(params.commit, 'commit')
      const q = optionalBitbucketString(params.q, 'q')
      const sort = optionalBitbucketString(params.sort, 'sort')
      return bitbucketApiUrl(
        `${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/src/${encodeBitbucketSegment(commit, 'commit')}/${directoryPath}`,
        {
          nextUrl: params.nextUrl,
          pageLen: params.pageLen,
          query: { q, sort },
          nextPathPrefix: `${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/src`,
          nextPathSuffix: directoryPath,
          nextRevision: commit,
        }
      )
    },
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: normalizeBitbucketPage(await bitbucketJson(response), normalizeBitbucketDirectoryEntry),
  }),
  outputs: {
    items: {
      type: 'array',
      description: 'Directory entries',
      items: { type: 'object', properties: BITBUCKET_DIRECTORY_ENTRY_OUTPUT_PROPERTIES },
    },
    page: BITBUCKET_PAGE_OUTPUT,
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
