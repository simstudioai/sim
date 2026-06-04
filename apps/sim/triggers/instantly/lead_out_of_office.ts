import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyLeadOutOfOfficeTrigger = createInstantlyTrigger({
  id: 'instantly_lead_out_of_office',
  name: 'Instantly Lead Out Of Office',
  description: 'Trigger when an Instantly lead is out of office',
  eventLabel: 'Lead Out Of Office',
})
