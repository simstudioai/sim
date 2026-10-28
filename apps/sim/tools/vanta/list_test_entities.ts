import type { InternalToolConfig } from '@/tools/types'
import {
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
  VANTA_TEST_ENTITY_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type {
  VantaListTestEntitiesParams,
  VantaListTestEntitiesResponse,
} from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaListTestEntitiesTool: InternalToolConfig<
  VantaListTestEntitiesParams,
  VantaListTestEntitiesResponse
> = {
  id: 'vanta_list_test_entities',
  name: 'Vanta List Test Entities',
  description:
    'List the failing or deactivated resource entities for a specific Vanta test, useful for finding exactly which resources need remediation',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'vanta',
    credentialKind: 'service-account',
    authoritativeParams: ['apiDomain'],
    retryOnUnauthorized: true,
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token supplied by the saved Vanta credential',
    },
    apiDomain: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'API origin supplied by the saved Vanta credential',
    },
    testId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the test (e.g., test-aws-cloudtrail-enabled)',
    },
    entityStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter entities by status: FAILING or DEACTIVATED',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items per page (1-100, default 10)',
    },
    pageCursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor: pass the endCursor from the previous response to fetch the next page',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'vanta_list_test_entities',
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
      testId: params.testId,
      entityStatus: params.entityStatus,
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaListTestEntitiesResponse>(
    'Failed to list Vanta test entities'
  ),

  outputs: {
    entities: {
      type: 'array',
      description: 'Resource entities for the test',
      items: { type: 'object', properties: VANTA_TEST_ENTITY_OUTPUT_PROPERTIES },
    },
    pageInfo: {
      type: 'json',
      description:
        'Cursor pagination info for the returned page; pass endCursor as pageCursor to fetch the next page',
      nullable: true,
      properties: VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
