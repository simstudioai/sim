import {
  BITBUCKET_FILE_METADATA_OUTPUT_PROPERTIES,
  type BitbucketFileMetadata,
  type BitbucketFileParams,
  type BitbucketToolResponse,
} from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_READ_RETRY,
  BITBUCKET_REPOSITORY_PARAMS,
  bitbucketHeaders,
  bitbucketJson,
  bitbucketRepositoryPath,
  encodeBitbucketRepositoryPath,
  encodeBitbucketSegment,
  normalizeBitbucketFileMetadata,
} from '@/tools/bitbucket/utils'
import { requireBitbucketSha1 } from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

export const bitbucketGetFileMetadataTool: ToolConfig<
  BitbucketFileParams,
  BitbucketToolResponse<{ file: BitbucketFileMetadata }>
> = {
  id: 'bitbucket_get_file_metadata',
  name: 'Bitbucket Get File Metadata',
  description: 'Inspect file size and attributes at a full repository commit SHA-1',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository-relative file path',
    },
  },
  request: {
    url: (params) =>
      `${BITBUCKET_API_BASE}${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/src/${encodeBitbucketSegment(requireBitbucketSha1(params.commit, 'commit'), 'commit')}/${encodeBitbucketRepositoryPath(params.path)}?format=meta`,
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: { file: normalizeBitbucketFileMetadata(await bitbucketJson(response)) },
  }),
  outputs: {
    file: {
      type: 'object',
      description: 'File metadata',
      properties: BITBUCKET_FILE_METADATA_OUTPUT_PROPERTIES,
    },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
