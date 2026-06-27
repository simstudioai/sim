import { CalendlyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const CalendlyBlockDisplay = {
  type: 'calendly',
  name: 'Calendly',
  description: 'Manage Calendly scheduling and events',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: CalendlyIcon,
  longDescription:
    'Integrate Calendly into your workflow. Manage event types, scheduled events, invitees, and webhooks. Can also trigger workflows based on Calendly webhook events (invitee scheduled, invitee canceled, routing form submitted). Requires Personal Access Token.',
  docsLink: 'https://docs.sim.ai/integrations/calendly',
  integrationType: IntegrationType.Productivity,
  triggerAllowed: true,
} satisfies BlockDisplay

export const CalendlyBlockMeta = {
  tags: ['scheduling', 'calendar', 'meeting'],
  url: 'https://calendly.com',
  templates: [
    {
      icon: CalendlyIcon,
      title: 'Scheduling follow-up automator',
      prompt:
        'Build a workflow that monitors new Calendly bookings, researches each attendee and their company, prepares a pre-meeting brief with relevant context, and sends a personalized confirmation email with an agenda and any prep materials.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['sales', 'research', 'automation'],
    },
    {
      icon: CalendlyIcon,
      title: 'Calendly meeting-prep brief',
      prompt:
        'Build a workflow that runs 30 minutes before a Calendly booking, researches the attendee and company with Apollo, and emails the host a structured prep brief.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['apollo', 'gmail'],
    },
    {
      icon: CalendlyIcon,
      title: 'Calendly post-meeting recap',
      prompt:
        'Create a workflow that runs after a Calendly meeting ends, pulls the meeting notes from the calendar, writes a CRM-ready summary, and updates the linked Salesforce opportunity.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: CalendlyIcon,
      title: 'Calendly no-show recovery',
      prompt:
        'Build a workflow that detects Calendly no-shows, sends a polite reschedule email with a one-tap link, and updates the deal record with the no-show event.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: CalendlyIcon,
      title: 'Calendly + Loops nurture',
      prompt:
        'Create a workflow that on a Calendly booking enrolls the attendee into a Loops nurture campaign tailored to the meeting topic, ensuring follow-up emails reach them before the meeting.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: CalendlyIcon,
      title: 'Calendly no-show tracker',
      prompt:
        "Build a scheduled workflow that lists yesterday's Calendly scheduled events, checks invitee status to find no-shows, logs them to a table for follow-up, and posts a recap of attended versus missed meetings to Slack.",
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CalendlyIcon,
      title: 'Calendly booking prep brief',
      prompt:
        'Create a workflow that on a new Calendly booking fetches the scheduled event and invitee details, researches the attendee and their company, and emails the meeting owner a one-page prep brief before the call.',
      modules: ['agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'list-upcoming-meetings',
      description:
        'Pull upcoming Calendly scheduled events for a date range and summarize them. Use to brief a host on their schedule or build a daily agenda.',
      content:
        '# List Upcoming Meetings\n\nSummarize upcoming Calendly events.\n\n## Steps\n1. Use List Scheduled Events. Filter to status active and set Min Start Time and Max Start Time (ISO 8601 UTC) for the window.\n2. Filter by user or organization URI when scoping to a specific host (Get Current User returns your URI if needed).\n3. For each event, read name, start_time, end_time, location, and scheduling_url; page with the page token if there are many.\n\n## Output\nReturn an ordered agenda: each meeting with time, name, location/join link, and the invitee. Add a one-line headline (count and first start time) for a quick read.',
    },
    {
      name: 'get-event-attendees',
      description:
        'Retrieve the invitees for a Calendly scheduled event, including answers and contact info. Use to prep for a meeting or sync attendees to a CRM.',
      content:
        '# Get Event Attendees\n\nList who is attending a Calendly event.\n\n## Steps\n1. Identify the scheduled event by its UUID or URI (use List Scheduled Events to locate it).\n2. Use List Event Invitees for that event; optionally filter by email or status.\n3. Read each invitee record: name, email, status, and any questions and answers captured at booking.\n\n## Output\nReturn the invitees with name, email, status, and their intake answers. Flag canceled or no-show invitees so they can be handled differently from confirmed attendees.',
    },
    {
      name: 'cancel-scheduled-event',
      description:
        'Cancel a Calendly scheduled event with an optional reason. Use to call off a meeting and notify the invitee through Calendly.',
      content:
        '# Cancel Scheduled Event\n\nCall off a Calendly meeting.\n\n## Steps\n1. Find the scheduled event UUID or URI (use List Scheduled Events filtered by invitee email or time if you only have those details).\n2. Use Cancel Event with the event UUID and a clear cancellation reason.\n3. Calendly notifies the invitee automatically.\n\n## Output\nReturn the event UUID and confirmation that it was canceled. Echo the reason. If the event is already canceled or cannot be found, report that instead of retrying.',
    },
  ],
} as const satisfies BlockMeta
