import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyLeadNoShowTrigger = createInstantlyTrigger({
  id: 'instantly_lead_no_show',
  name: 'Instantly Lead No Show',
  description: 'Trigger when an Instantly lead is marked no show',
  eventLabel: 'Lead No Show',
})
