import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyEmailSentTrigger = createInstantlyTrigger({
  id: 'instantly_email_sent',
  name: 'Instantly Email Sent',
  description: 'Trigger when Instantly sends an email',
  eventLabel: 'Email Sent',
})
