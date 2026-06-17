import type { ToolConfig } from '@/tools/types'
import {
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
  VANTA_RISK_SCENARIO_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type {
  VantaListRiskScenariosParams,
  VantaListRiskScenariosResponse,
} from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaListRiskScenariosTool: ToolConfig<
  VantaListRiskScenariosParams,
  VantaListRiskScenariosResponse
> = {
  id: 'vanta_list_risk_scenarios',
  name: 'Vanta List Risk Scenarios',
  description:
    'List the risk scenarios in a Vanta risk register with likelihood/impact scores, treatment decisions, and review status',
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
    searchString: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search string to filter risk scenarios',
    },
    includeIgnored: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include ignored risk scenarios',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by scenario type: "Risk Scenario" or "Enterprise Risk"',
    },
    ownerMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated owner emails to filter by',
    },
    categoryMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated risk categories to filter by',
    },
    ciaCategoryMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated CIA categories to filter by: Confidentiality, Integrity, Availability',
    },
    treatmentTypeMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated treatments to filter by: Mitigate, Transfer, Avoid, Accept',
    },
    inherentScoreGroupMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated inherent score groups to filter by: "Very low", Low, Med, High, Critical',
    },
    residualScoreGroupMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated residual score groups to filter by: "Very low", Low, Med, High, Critical',
    },
    reviewStatusMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated review statuses to filter by: APPROVED, DRAFT, NOT_REVIEWED, AWAITING_SUBMISSION, PENDING_APPROVAL, REQUESTED_CHANGES',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to order results by: description or createdAt',
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
      operation: 'vanta_list_risk_scenarios',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      searchString: params.searchString,
      includeIgnored: params.includeIgnored,
      type: params.type,
      ownerMatchesAny: params.ownerMatchesAny,
      categoryMatchesAny: params.categoryMatchesAny,
      ciaCategoryMatchesAny: params.ciaCategoryMatchesAny,
      treatmentTypeMatchesAny: params.treatmentTypeMatchesAny,
      inherentScoreGroupMatchesAny: params.inherentScoreGroupMatchesAny,
      residualScoreGroupMatchesAny: params.residualScoreGroupMatchesAny,
      reviewStatusMatchesAny: params.reviewStatusMatchesAny,
      orderBy: params.orderBy,
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaListRiskScenariosResponse>(
    'Failed to list Vanta risk scenarios'
  ),

  outputs: {
    riskScenarios: {
      type: 'array',
      description: 'Risk scenarios matching the filters',
      items: { type: 'object', properties: VANTA_RISK_SCENARIO_OUTPUT_PROPERTIES },
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
