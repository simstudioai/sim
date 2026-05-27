import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyLeadClosedTrigger = createInstantlyTrigger({
  id: 'instantly_lead_closed',
  name: 'Instantly Lead Closed',
  description: 'Trigger when an Instantly lead is marked closed',
  eventLabel: 'Lead Closed',
})
