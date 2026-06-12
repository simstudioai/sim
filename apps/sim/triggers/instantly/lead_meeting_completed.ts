import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyLeadMeetingCompletedTrigger = createInstantlyTrigger({
  id: 'instantly_lead_meeting_completed',
  name: 'Instantly Lead Meeting Completed',
  description: 'Trigger when an Instantly lead completes a meeting',
  eventLabel: 'Lead Meeting Completed',
})
