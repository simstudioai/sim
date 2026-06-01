import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyLeadMeetingBookedTrigger = createInstantlyTrigger({
  id: 'instantly_lead_meeting_booked',
  name: 'Instantly Lead Meeting Booked',
  description: 'Trigger when an Instantly lead books a meeting',
  eventLabel: 'Lead Meeting Booked',
})
