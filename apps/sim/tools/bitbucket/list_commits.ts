import {
  BITBUCKET_COMMIT_OUTPUT_PROPERTIES,
  BITBUCKET_PAGE_OUTPUT,
  type BitbucketCommit,
  type BitbucketListCommitsParams,
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
  normalizeBitbucketCommit,
  normalizeBitbucketPage,
} from '@/tools/bitbucket/utils'
import { optionalBitbucketString, optionalBitbucketStringArray } from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

export const bitbucketListCommitsTool: ToolConfig<
  BitbucketListCommitsParams,
  BitbucketToolResponse<BitbucketListOutput<BitbucketCommit>>
> = {
  id: 'bitbucket_list_commits',
  name: 'Bitbucket List Commits',
  description: 'List repository commits in reverse chronological order',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['repository'] },
  params: {
    ...BITBUCKET_REPOSITORY_PARAMS,
    include: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Branches, tags, or commit hashes whose history to include; omit to list commits on every ref',
      items: { type: 'string' },
    },
    exclude: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Branches, tags, or commit hashes whose reachable commits to leave out',
      items: { type: 'string' },
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only list commits that changed this file or directory',
    },
    ...BITBUCKET_PAGINATION_PARAMS,
  },
  request: {
    url: (params) => {
      const include = optionalBitbucketStringArray(params.include, 'include', 'include ref')
      const exclude = optionalBitbucketStringArray(params.exclude, 'exclude', 'exclude ref')
      const path = optionalBitbucketString(params.path, 'path')
      const url = bitbucketApiUrl(
        `${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/commits`,
        {
          nextUrl: params.nextUrl,
          pageLen: params.pageLen,
          query: { path },
        }
      )
      if (params.nextUrl !== undefined) return url
      const withRefs = new URL(url)
      for (const ref of include ?? []) withRefs.searchParams.append('include', ref)
      for (const ref of exclude ?? []) withRefs.searchParams.append('exclude', ref)
      return withRefs.toString()
    },
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: normalizeBitbucketPage(await bitbucketJson(response), normalizeBitbucketCommit),
  }),
  outputs: {
    items: {
      type: 'array',
      description: 'Commits',
      items: { type: 'object', properties: BITBUCKET_COMMIT_OUTPUT_PROPERTIES },
    },
    page: BITBUCKET_PAGE_OUTPUT,
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
