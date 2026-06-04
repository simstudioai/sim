import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyLeadInterestedTrigger = createInstantlyTrigger({
  id: 'instantly_lead_interested',
  name: 'Instantly Lead Interested',
  description: 'Trigger when an Instantly lead is marked interested',
  eventLabel: 'Lead Interested',
})
