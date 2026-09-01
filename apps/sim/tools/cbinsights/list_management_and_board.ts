import type { CbInsightsOrgListParams, CbInsightsOrgListResponse } from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export interface CbInsightsListManagementAndBoardParams extends CbInsightsOrgListParams {
  titleIds?: number[] | string
}

export const cbinsightsListManagementAndBoardTool: InternalToolConfig<
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

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    orgs: {
      type: 'json',
      description:
        'Organizations as [{orgId, managementAndBoard: {mosaicManagement, people}}]. An organization with no data is omitted from the response.',
    },
  },
}
