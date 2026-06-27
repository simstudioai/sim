import { CalComIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const CalComBlockDisplay = {
  type: 'calcom',
  name: 'Cal.com',
  description: 'Manage Cal.com bookings, event types, schedules, and availability',
  category: 'tools',
  bgColor: '#292929',
  icon: CalComIcon,
  longDescription:
    'Integrate Cal.com into your workflow. Create and manage bookings, event types, schedules, and check availability slots. Supports creating, listing, rescheduling, and canceling bookings, as well as managing event types and schedules. Can also trigger workflows based on Cal.com webhook events (booking created, cancelled, rescheduled). Connect your Cal.com account via OAuth.',
  docsLink: 'https://docs.sim.ai/integrations/calcom',
  integrationType: IntegrationType.Productivity,
  triggerAllowed: true,
} satisfies BlockDisplay

export const CalComBlockMeta = {
  tags: ['scheduling', 'calendar', 'meeting'],
  url: 'https://cal.com',
  templates: [
    {
      icon: CalComIcon,
      title: 'Cal.com booking prep brief',
      prompt:
        'Build a workflow that runs 30 minutes before a Cal.com booking, researches the attendee with Apollo, and emails the host a structured prep brief.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['apollo', 'gmail'],
    },
    {
      icon: CalComIcon,
      title: 'Cal.com post-meeting recap',
      prompt:
        'Create a workflow that runs after a Cal.com meeting ends, summarizes the meeting notes, and updates the linked Salesforce or HubSpot opportunity.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce', 'hubspot'],
    },
    {
      icon: CalComIcon,
      title: 'Cal.com no-show recovery',
      prompt:
        'Build a workflow that detects Cal.com no-shows, sends a polite reschedule email with a one-tap link, and updates the deal record with the no-show event.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: CalComIcon,
      title: 'Cal.com + Loops nurture',
      prompt:
        'Create a workflow that on a Cal.com booking enrolls the attendee into a Loops nurture campaign tailored to the meeting topic.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: CalComIcon,
      title: 'Cal.com round-robin balancer',
      prompt:
        'Build a workflow that watches Cal.com round-robin assignments, ensures equitable distribution across the team weekly, and adjusts the weights based on capacity.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: CalComIcon,
      title: 'Cal.com webhook to CRM',
      prompt:
        'Create a workflow triggered by a Cal.com booking webhook that creates or updates the contact in HubSpot, sets the lifecycle stage, and assigns the right owner.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: CalComIcon,
      title: 'Cal.com reschedule chaser',
      prompt:
        'Build a scheduled workflow that finds Cal.com bookings that have been rescheduled more than twice, posts a Slack alert to the host, and proposes a fixed time.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'book-a-meeting',
      description:
        'Create a Cal.com booking for an attendee on a chosen event type and time. Use to schedule a call once you know the slot and attendee details.',
      content:
        '# Book A Meeting\n\nCreate a confirmed Cal.com booking.\n\n## Steps\n1. Identify the event type to book (select it or pass its numeric event type id).\n2. Set the Start Time as an ISO 8601 UTC timestamp.\n3. Provide the attendee name, email, and IANA time zone (e.g. America/New_York). Add guests or a duration override if needed.\n4. Create the booking.\n\n## Output\nReturn the booking UID, start and end time, attendee, and the meeting URL. Confirm the booking to the user. If the slot is unavailable, suggest checking available slots first and propose alternatives.',
    },
    {
      name: 'find-available-slots',
      description:
        'Look up open time slots for a Cal.com event type within a date range. Use before booking to offer the attendee valid times.',
      content:
        '# Find Available Slots\n\nRetrieve bookable time slots for an event type.\n\n## Steps\n1. Select the event type (or pass its id, or an event type slug plus username).\n2. Set the Start Time and End Time of the window to search (ISO 8601 UTC).\n3. Set the attendee time zone so slots are returned in their local time, and a duration if the event supports multiple lengths.\n4. Read the returned slots.\n\n## Output\nReturn the available slots as a clean list of start times in the requested time zone. Summarize the next few openings for the user; if none exist in the window, widen the range and retry.',
    },
    {
      name: 'reschedule-or-cancel-booking',
      description:
        'Move a Cal.com booking to a new time or cancel it, with a reason. Use to handle change or cancellation requests for an existing booking.',
      content:
        '# Reschedule Or Cancel Booking\n\nChange or cancel an existing Cal.com booking.\n\n## Steps\n1. Identify the booking by its UID (use List Bookings to find it if you only have attendee or date details).\n2. To move it, use Reschedule Booking with the new Start Time (ISO 8601) and an optional rescheduling reason.\n3. To cancel, use Cancel Booking with an optional cancellation reason.\n4. For request-based event types, use Confirm Booking or Decline Booking instead.\n\n## Output\nReturn the booking UID and its new status (rescheduled, cancelled, confirmed, or declined) plus the updated time when applicable. Confirm the change to the user.',
    },
    {
      name: 'summarize-upcoming-bookings',
      description:
        'List and summarize upcoming Cal.com bookings for a period. Use for a daily agenda or to brief a host on their schedule.',
      content:
        '# Summarize Upcoming Bookings\n\nProduce an agenda from Cal.com bookings.\n\n## Steps\n1. Use List Bookings with status Upcoming.\n2. For each booking, read the title, start/end time, attendees, and meeting URL.\n3. Sort chronologically and group by day if the range spans multiple days.\n\n## Output\nReturn an ordered agenda: each entry with time, title, attendee name, and join link. Add a short headline like the number of meetings and the first start time so the host gets a quick read on the day.',
    },
  ],
} as const satisfies BlockMeta
