import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyLeadNotInterestedTrigger = createInstantlyTrigger({
  id: 'instantly_lead_not_interested',
  name: 'Instantly Lead Not Interested',
  description: 'Trigger when an Instantly lead is marked not interested',
  eventLabel: 'Lead Not Interested',
})
