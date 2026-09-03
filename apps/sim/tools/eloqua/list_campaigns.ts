import { createEloquaApplicationListTool } from '@/tools/eloqua/factories'

export const eloquaListCampaignsTool = createEloquaApplicationListTool({
  id: 'eloqua_list_campaigns',
  name: 'List Oracle Eloqua Campaigns',
  description: 'Retrieve one bounded page of campaigns from Oracle Eloqua.',
  path: '/api/rest/2.0/assets/campaigns',
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
    externalSystemId: params.externalSystemId,
    includeCrmIdsMapping: params.includeCrmIdsMapping,
  }),
})
