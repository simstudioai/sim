import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyReplyReceivedTrigger = createInstantlyTrigger({
  id: 'instantly_reply_received',
  name: 'Instantly Reply Received',
  description: 'Trigger when a lead replies to an Instantly email',
  eventLabel: 'Reply Received',
})
