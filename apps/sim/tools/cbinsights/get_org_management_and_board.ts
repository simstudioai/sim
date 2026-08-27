import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import {
  asArray,
  asNumber,
  cbInsightsRequest,
  compactBody,
  parseIdListParam,
  requireOrgId,
} from '@/tools/cbinsights/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface CbInsightsOrgManagementParams extends CbInsightsOrgParams {
  titleIds?: number[] | string
}

export const cbinsightsGetOrgManagementAndBoardTool: ToolConfig<
  CbInsightsOrgManagementParams,
  ToolResponse
> = {
  id: 'cbinsights_get_org_management_and_board',
  name: 'CB Insights Get Organization Management and Board',
  description:
    "Retrieve an organization's leadership team and board members with their education, work history, and board seats, plus the Management factor of its Mosaic Score.",
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
    orgId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'CB Insights organization ID. Resolve a name or website to one with Look Up Organizations, which never charges credits.',
    },
    titleIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'CB Insights person title IDs to filter the people returned, e.g. [50, 75]',
    },
  },

  request: { url: () => '', method: 'POST', headers: () => ({}) },

  directExecution: async (params, signal) => {
    const orgId = requireOrgId(params.orgId)
    return cbInsightsRequest<{ people?: unknown; mosaicManagement?: unknown }>(
      params,
      {
        path: `/v2/organizations/${orgId}/managementandboard`,
        body: compactBody({ titleIds: parseIdListParam(params.titleIds, 'titleIds') }),
      },
      (data) => ({
        people: asArray(data.people),
        mosaicManagement: asNumber(data.mosaicManagement),
      }),
      signal
    )
  },

  outputs: {
    people: {
      type: 'json',
      description:
        'People as [{personId, givenName, middleName, surname, email, linkedInUrl, education, workExperience, boardAssociations}]',
    },
    mosaicManagement: {
      type: 'number',
      nullable: true,
      description:
        'Management factor of the Mosaic Score, measuring the pedigree and track record of the leadership team',
    },
  },
}
