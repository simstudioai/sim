import {
  BITBUCKET_PAGE_OUTPUT,
  BITBUCKET_PIPELINE_OUTPUT_PROPERTIES,
  type BitbucketListOutput,
  type BitbucketListPipelinesParams,
  type BitbucketPipeline,
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
  normalizeBitbucketPage,
  normalizeBitbucketPipeline,
} from '@/tools/bitbucket/utils'
import {
  optionalBitbucketEnum,
  optionalBitbucketSha1,
  optionalBitbucketString,
} from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

const BITBUCKET_PIPELINE_LIST_REF_TYPES = ['BRANCH', 'TAG', 'ANNOTATED_TAG'] as const
const BITBUCKET_PIPELINE_LIST_SELECTOR_TYPES = [
  'BRANCH',
  'TAG',
  'CUSTOM',
  'PULLREQUESTS',
  'DEFAULT',
] as const
const BITBUCKET_PIPELINE_TRIGGER_TYPES = ['PUSH', 'MANUAL', 'SCHEDULED', 'PARENT_STEP'] as const
const BITBUCKET_PIPELINE_STATUSES = [
  'PARSING',
  'PENDING',
  'PAUSED',
  'HALTED',
  'BUILDING',
  'ERROR',
  'PASSED',
  'FAILED',
  'STOPPED',
  'UNKNOWN',
] as const
export const bitbucketListPipelinesTool: ToolConfig<
  BitbucketListPipelinesParams,
  BitbucketToolResponse<BitbucketListOutput<BitbucketPipeline>>
> = {
  id: 'bitbucket_list_pipelines',
  name: 'Bitbucket List Pipelines',
  description: 'List pipelines for a Bitbucket Cloud repository',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['pipeline'] },
  params: {
    ...BITBUCKET_REPOSITORY_PARAMS,
    refType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reference type filter: BRANCH, TAG, or ANNOTATED_TAG',
    },
    refName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reference name filter',
    },
    commitHash: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full 40-character target commit SHA-1 filter',
    },
    selectorType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Selector type filter: BRANCH, TAG, CUSTOM, PULLREQUESTS, or DEFAULT',
    },
    selectorPattern: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pipeline selector pattern filter',
    },
    triggerType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trigger filter: PUSH, MANUAL, SCHEDULED, or PARENT_STEP',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pipeline status filter',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bitbucket pipeline sort expression',
    },
    ...BITBUCKET_PAGINATION_PARAMS,
  },
  request: {
    url: (params) => {
      const refType = optionalBitbucketEnum(
        params.refType,
        'refType',
        BITBUCKET_PIPELINE_LIST_REF_TYPES
      )
      const selectorType = optionalBitbucketEnum(
        params.selectorType,
        'selectorType',
        BITBUCKET_PIPELINE_LIST_SELECTOR_TYPES
      )
      const triggerType = optionalBitbucketEnum(
        params.triggerType,
        'triggerType',
        BITBUCKET_PIPELINE_TRIGGER_TYPES
      )
      const status = optionalBitbucketEnum(params.status, 'status', BITBUCKET_PIPELINE_STATUSES)
      const commitHash = optionalBitbucketSha1(params.commitHash, 'commitHash')
      const refName = optionalBitbucketString(params.refName, 'refName')
      const selectorPattern = optionalBitbucketString(params.selectorPattern, 'selectorPattern')
      const sort = optionalBitbucketString(params.sort, 'sort')
      return bitbucketApiUrl(
        `${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/pipelines`,
        {
          nextUrl: params.nextUrl,
          pageLen: params.pageLen,
          query: {
            'target.ref_type': refType,
            'target.ref_name': refName,
            'target.commit.hash': commitHash,
            'target.selector.type': selectorType,
            'target.selector.pattern': selectorPattern,
            trigger_type: triggerType,
            status,
            sort,
          },
        }
      )
    },
    method: 'GET',
    headers: (params) => bitbucketHeaders(params.accessToken),
    retry: BITBUCKET_READ_RETRY,
  },
  transformResponse: async (response) => ({
    success: true,
    output: normalizeBitbucketPage(await bitbucketJson(response), normalizeBitbucketPipeline),
  }),
  outputs: {
    items: {
      type: 'array',
      description: 'Pipelines',
      items: { type: 'object', properties: BITBUCKET_PIPELINE_OUTPUT_PROPERTIES },
    },
    page: BITBUCKET_PAGE_OUTPUT,
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
