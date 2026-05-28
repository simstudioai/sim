import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyWebhookTrigger = createInstantlyTrigger({
  id: 'instantly_webhook',
  name: 'Instantly Webhook',
  description: 'Trigger workflow on any Instantly webhook event',
  eventLabel: 'All Events',
  includeDropdown: true,
})
