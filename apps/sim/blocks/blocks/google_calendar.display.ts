import { GoogleCalendarIcon, TwilioIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GoogleCalendarBlockDisplay = {
  type: 'google_calendar',
  name: 'Google Calendar (Legacy)',
  description: 'Manage Google Calendar events',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleCalendarIcon,
  longDescription:
    'Integrate Google Calendar into the workflow. Can create, read, update, and list calendar events.',
  docsLink: 'https://docs.sim.ai/integrations/google_calendar',
  integrationType: IntegrationType.Productivity,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const GoogleCalendarV2BlockDisplay = {
  ...GoogleCalendarBlockDisplay,
  type: 'google_calendar_v2',
  name: 'Google Calendar',
  integrationType: IntegrationType.Productivity,
  hideFromToolbar: false,
} satisfies BlockDisplay

export const GoogleCalendarBlockMeta = {
  tags: ['calendar', 'scheduling', 'google-workspace'],
  url: 'https://workspace.google.com/products/calendar',
  templates: [
    {
      icon: GoogleCalendarIcon,
      title: 'Meeting prep agent',
      prompt:
        'Create an agent that checks my Google Calendar each morning, researches every attendee and topic on the web, and prepares a brief for each meeting so I walk in fully prepared. Schedule it to run every weekday morning.',
      image: '/templates/meeting-prep-dark.png',
      modules: ['agent', 'scheduled', 'workflows'],
      category: 'popular',
      tags: ['founder', 'sales', 'research', 'automation'],
      featured: true,
    },
    {
      icon: TwilioIcon,
      title: 'SMS appointment reminders',
      prompt:
        'Create a scheduled workflow that checks Google Calendar each morning for appointments in the next 24 hours, and sends an SMS reminder to each attendee via Twilio with the meeting time, location, and any prep notes.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'communication', 'automation'],
      alsoIntegrations: ['twilio_sms'],
    },
    {
      icon: GoogleCalendarIcon,
      title: 'Booking-to-calendar scheduler',
      prompt:
        'Build a workflow that on a new Calendly booking creates the matching Google Calendar event, invites the attendees, attaches the meeting agenda, and writes the event link back so both systems stay in sync.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'scheduling', 'automation'],
      alsoIntegrations: ['calendly'],
    },
    {
      icon: GoogleCalendarIcon,
      title: 'Daily agenda digest',
      prompt:
        'Create a scheduled weekday workflow that lists my Google Calendar events for the day, summarizes them with attendee context and prep notes, and posts a clean morning agenda to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'reporting', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleCalendarIcon,
      title: 'Interview scheduling coordinator',
      prompt:
        "Build a workflow that when a candidate reaches the interview stage finds open slots across the panel's Google Calendars, creates the interview event with the video link, invites everyone, and emails the candidate the confirmation.",
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'scheduling', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleCalendarIcon,
      title: 'Meeting-load weekly report',
      prompt:
        'Create a scheduled weekly workflow that lists Google Calendar events for the team, computes total meeting hours and recurring-meeting load per person, writes the breakdown to a table, and flags anyone over the focus-time threshold.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['team', 'reporting', 'analysis'],
    },
    {
      icon: GoogleCalendarIcon,
      title: 'Calendar event note-taker prep',
      prompt:
        'Build a workflow that scans upcoming Google Calendar events for external meetings, researches each company and attendee, drafts talking points, and updates the event description so the notes travel with the invite.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
    },
  ],
  skills: [
    {
      name: 'schedule-meeting',
      description:
        'Create a Google Calendar event with the right time, attendees, and details, sending invites.',
      content:
        '# Schedule a Meeting\n\nCreate a calendar event and invite attendees.\n\n## Steps\n1. Determine the calendar (default to `primary`), title, start and end times, location, and description from the request.\n2. Convert times to ISO 8601 with the correct timezone offset (e.g., `2025-06-03T10:00:00-08:00`).\n3. If the request is conversational (e.g., "lunch with John tomorrow at noon"), use Quick Add instead of building each field by hand.\n4. Run Create Event (or Quick Add) with the attendee emails as a comma-separated list.\n5. Set Send Email Notifications to `all` so attendees are invited.\n\n## Output\nConfirm the created event: title, start/end in a readable format, attendees, and the event link (htmlLink). If a conflict is likely, note it.',
    },
    {
      name: 'summarize-daily-agenda',
      description:
        "List today's Google Calendar events and produce a clean, ordered agenda summary.",
      content:
        '# Summarize the Daily Agenda\n\nProduce a readable agenda for a day or window.\n\n## Steps\n1. Resolve the target window into UTC ISO timestamps for Start Time Filter (timeMin) and End Time Filter (timeMax). For "today", use 00:00:00Z to 23:59:59Z.\n2. Run List Events on the chosen calendar with those filters and a reasonable Max Results.\n3. Sort events chronologically and read summary, start/end, location, and attendees for each.\n4. Flag back-to-back meetings and any event with no agenda or description.\n\n## Output\nA chronological agenda. Each line: time range, title, location (if any), and attendee count. Add a short header with total meetings and total meeting hours.',
    },
    {
      name: 'find-and-reschedule-event',
      description: 'Locate an existing event and update its time, attendees, or details.',
      content:
        '# Find and Reschedule an Event\n\nUpdate an existing calendar event.\n\n## Steps\n1. If you do not have the event ID, run List Events over a suitable window and match by title/attendees to find the event ID.\n2. Run Get Event to read the current details and confirm it is the right one.\n3. Run Update Event with only the changed fields (new start/end in ISO 8601 with offset, new attendees, new location, or title).\n4. Set Send Email Notifications to `all` so attendees see the change.\n\n## Output\nConfirm what changed (old vs new time/attendees) and return the event link. If multiple events matched, list them and ask which to update before changing anything destructive.',
    },
    {
      name: 'invite-attendees-to-event',
      description: 'Add attendees to an existing Google Calendar event and notify them.',
      content:
        '# Invite Attendees to an Event\n\nAdd people to an event without recreating it.\n\n## Steps\n1. Obtain the event ID (use List Events to find it if needed).\n2. Collect the attendee emails to add as a comma-separated list.\n3. Run Invite Attendees with Replace Existing set to `Add to existing attendees` (unless asked to replace the whole list).\n4. Set Send Email Notifications to `all`.\n\n## Output\nConfirm the added attendees and the resulting full attendee list, with the event link.',
    },
  ],
} as const satisfies BlockMeta

export const GoogleCalendarV2BlockMeta = {
  tags: ['calendar', 'scheduling', 'google-workspace'],
  url: 'https://workspace.google.com/products/calendar',
} as const satisfies BlockMeta
