import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyEmailBouncedTrigger = createInstantlyTrigger({
  id: 'instantly_email_bounced',
  name: 'Instantly Email Bounced',
  description: 'Trigger when an Instantly email bounces',
  eventLabel: 'Email Bounced',
})
