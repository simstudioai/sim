import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyLeadNeutralTrigger = createInstantlyTrigger({
  id: 'instantly_lead_neutral',
  name: 'Instantly Lead Neutral',
  description: 'Trigger when an Instantly lead is marked neutral',
  eventLabel: 'Lead Neutral',
})
