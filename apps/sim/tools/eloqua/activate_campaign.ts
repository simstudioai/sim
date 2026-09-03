import { createEloquaCampaignActionTool } from '@/tools/eloqua/factories'

export const eloquaActivateCampaignTool = createEloquaCampaignActionTool({
  id: 'eloqua_activate_campaign',
  name: 'Activate Oracle Eloqua Campaign',
  description: 'Activate or schedule an Oracle Eloqua campaign.',
  path: (id) => `/api/rest/2.0/assets/campaign/active/${id}`,
  action: 'activate',
})
