import type { ToolConfig } from '@/tools/types'
import {
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
  VANTA_TEST_ENTITY_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type {
  VantaListTestEntitiesParams,
  VantaListTestEntitiesResponse,
} from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaListTestEntitiesTool: ToolConfig<
  VantaListTestEntitiesParams,
  VantaListTestEntitiesResponse
> = {
  id: 'vanta_list_test_entities',
  name: 'Vanta List Test Entities',
  description:
    'List the failing or deactivated resource entities for a specific Vanta test, useful for finding exactly which resources need remediation',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client secret',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Vanta API region: "us" (api.vanta.com, default) or "gov" (api.vanta-gov.com)',
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

  request: {
    url: VANTA_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'vanta_list_test_entities',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
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
      optional: true,
      properties: VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
