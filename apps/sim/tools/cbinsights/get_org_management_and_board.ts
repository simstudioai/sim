import type { CbInsightsOrgParams } from '@/tools/cbinsights/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

export interface CbInsightsOrgManagementParams extends CbInsightsOrgParams {
  titleIds?: number[] | string
}

export const cbinsightsGetOrgManagementAndBoardTool: InternalToolConfig<
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

  operation: {
    input: createInternalToolOperationInput,
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
