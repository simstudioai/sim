import type { ToolConfig } from '@/tools/types'
import {
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
  VANTA_TEST_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type { VantaListTestsParams, VantaListTestsResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaListTestsTool: ToolConfig<VantaListTestsParams, VantaListTestsResponse> = {
  id: 'vanta_list_tests',
  name: 'Vanta List Tests',
  description:
    'List the automated compliance tests in a Vanta account, with filters for status, framework, integration, control, owner, and category',
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
    statusFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by test status: OK, DEACTIVATED, NEEDS_ATTENTION, IN_PROGRESS, INVALID, or NOT_APPLICABLE',
    },
    frameworkFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by framework ID (e.g., soc2)',
    },
    integrationFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by integration ID (e.g., aws)',
    },
    controlFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by control ID',
    },
    ownerFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by owner user ID',
    },
    categoryFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by test category (e.g., ACCOUNTS_ACCESS, COMPUTERS, INFRASTRUCTURE, POLICIES, VULNERABILITY_MANAGEMENT)',
    },
    isInRollout: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by whether the test is in rollout',
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
      operation: 'vanta_list_tests',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      statusFilter: params.statusFilter,
      frameworkFilter: params.frameworkFilter,
      integrationFilter: params.integrationFilter,
      controlFilter: params.controlFilter,
      ownerFilter: params.ownerFilter,
      categoryFilter: params.categoryFilter,
      isInRollout: params.isInRollout,
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaListTestsResponse>(
    'Failed to list Vanta tests'
  ),

  outputs: {
    tests: {
      type: 'array',
      description: 'Tests matching the filters',
      items: { type: 'object', properties: VANTA_TEST_OUTPUT_PROPERTIES },
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
