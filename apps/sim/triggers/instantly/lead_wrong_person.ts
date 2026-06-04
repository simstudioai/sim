import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyLeadWrongPersonTrigger = createInstantlyTrigger({
  id: 'instantly_lead_wrong_person',
  name: 'Instantly Lead Wrong Person',
  description: 'Trigger when an Instantly lead is marked wrong person',
  eventLabel: 'Lead Wrong Person',
})
