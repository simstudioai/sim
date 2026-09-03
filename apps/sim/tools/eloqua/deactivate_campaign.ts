import { createEloquaCampaignActionTool } from '@/tools/eloqua/factories'

export const eloquaDeactivateCampaignTool = createEloquaCampaignActionTool({
  id: 'eloqua_deactivate_campaign',
  name: 'Deactivate Oracle Eloqua Campaign',
  description: 'Return an active Oracle Eloqua campaign to draft status.',
  path: (id) => `/api/rest/2.0/assets/campaign/draft/${id}`,
  action: 'deactivate',
})
