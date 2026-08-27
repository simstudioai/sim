import type { CbInsightsOrgListParams, CbInsightsOrgListResponse } from '@/tools/cbinsights/types'
import {
  asArray,
  cbInsightsRequest,
  compactBody,
  parseIdListParam,
  requireOrgIds,
} from '@/tools/cbinsights/utils'
import type { ToolConfig } from '@/tools/types'

interface CbInsightsListManagementAndBoardParams extends CbInsightsOrgListParams {
  titleIds?: number[] | string
}

export const cbinsightsListManagementAndBoardTool: ToolConfig<
  CbInsightsListManagementAndBoardParams,
  CbInsightsOrgListResponse
> = {
  id: 'cbinsights_list_management_and_board',
  name: 'CB Insights List Management and Board',
  description:
    'Retrieve leadership teams, board members, and the Management factor of the Mosaic Score for up to 100 organizations at once.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CB Insights API client ID, exchanged for a bearer token before each call',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CB Insights API client secret, exchanged for a bearer token before each call',
    },
    orgIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'CB Insights organization IDs, 1-100 per request, e.g. [129410, 1034157]',
    },
    titleIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights person title IDs to filter the people returned, e.g. [50, 75]',
    },
  },

  request: { url: () => '', method: 'POST', headers: () => ({}) },

  directExecution: async (params, signal) =>
    cbInsightsRequest<{ orgs?: unknown }>(
      params,
      {
        path: '/v2/managementandboard',
        body: compactBody({
          orgIds: requireOrgIds(params.orgIds),
          titleIds: parseIdListParam(params.titleIds, 'titleIds'),
        }),
      },
      (data) => ({ orgs: asArray(data.orgs) }),
      signal
    ),

  outputs: {
    orgs: {
      type: 'json',
      description:
        'Organizations as [{orgId, managementAndBoard: {mosaicManagement, people}}]. An organization with no data is omitted from the response.',
    },
  },
}
