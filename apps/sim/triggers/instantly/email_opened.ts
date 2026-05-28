import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyEmailOpenedTrigger = createInstantlyTrigger({
  id: 'instantly_email_opened',
  name: 'Instantly Email Opened',
  description: 'Trigger when a lead opens an Instantly email',
  eventLabel: 'Email Opened',
})
