import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyLeadUnsubscribedTrigger = createInstantlyTrigger({
  id: 'instantly_lead_unsubscribed',
  name: 'Instantly Lead Unsubscribed',
  description: 'Trigger when an Instantly lead unsubscribes',
  eventLabel: 'Lead Unsubscribed',
})
