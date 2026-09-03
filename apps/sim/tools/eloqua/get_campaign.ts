import { createEloquaApplicationItemTool } from '@/tools/eloqua/factories'
import { eloquaPositiveInteger } from '@/tools/eloqua/utils'

export const eloquaGetCampaignTool = createEloquaApplicationItemTool({
  id: 'eloqua_get_campaign',
  name: 'Get Oracle Eloqua Campaign',
  description: 'Retrieve one campaign by ID from Oracle Eloqua.',
  path: (id) => `/api/rest/2.0/assets/campaign/${id}`,
  resource: 'campaign',
  extraParams: {
    externalSystemId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'External system ID used for CRM campaign mapping',
    },
    includeCrmIdsMapping: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include CRM ID mapping information',
    },
  },
  query: (params) => ({
    externalSystemId: eloquaPositiveInteger(params.externalSystemId, 'Eloqua external system ID'),
    includeCrmIdsMapping: params.includeCrmIdsMapping,
  }),
})
