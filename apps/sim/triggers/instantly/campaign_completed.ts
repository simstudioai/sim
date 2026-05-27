import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyCampaignCompletedTrigger = createInstantlyTrigger({
  id: 'instantly_campaign_completed',
  name: 'Instantly Campaign Completed',
  description: 'Trigger when an Instantly campaign completes',
  eventLabel: 'Campaign Completed',
})
