import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyAutoReplyReceivedTrigger = createInstantlyTrigger({
  id: 'instantly_auto_reply_received',
  name: 'Instantly Auto Reply Received',
  description: 'Trigger when Instantly receives an auto-reply from a lead',
  eventLabel: 'Auto Reply Received',
})
