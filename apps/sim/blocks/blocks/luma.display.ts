import { LumaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const LumaBlockDisplay = {
  type: 'luma',
  name: 'Luma',
  description: 'Manage events and guests on Luma',
  category: 'tools',
  bgColor: '#000000',
  icon: LumaIcon,
  longDescription:
    'Integrate Luma into the workflow. Can create, update, look up, and cancel events, list calendar events, manage guest lists (get one or many, add guests, send invites, and update approval status).',
  docsLink: 'https://docs.sim.ai/integrations/luma',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay

export const LumaBlockMeta = {
  tags: ['events', 'calendar', 'scheduling'],
  url: 'https://luma.com',
  templates: [
    {
      icon: LumaIcon,
      title: 'Luma event reminder cadence',
      prompt:
        'Create a workflow that sends scheduled reminders to Luma event registrants — 7 days, 24 hours, 1 hour out — with personalized content based on RSVP type.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: LumaIcon,
      title: 'Luma registrant enricher',
      prompt:
        'Build a scheduled workflow that pulls the Luma event guest list, enriches each registrant with company data via Apollo, and pushes high-value attendees into HubSpot as leads.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'crm'],
      alsoIntegrations: ['apollo', 'hubspot'],
    },
    {
      icon: LumaIcon,
      title: 'Luma post-event followup',
      prompt:
        'Create a scheduled workflow that runs the day after a Luma event, pulls the guest list, segments attendees from no-shows, sends each segment a tailored followup, and writes attendance to the CRM.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'crm'],
      alsoIntegrations: ['gmail', 'hubspot'],
    },
    {
      icon: LumaIcon,
      title: 'Luma calendar import',
      prompt:
        'Build a scheduled workflow that pulls the Luma event guest list and creates a personalized Google Calendar invite for each new registrant with the event details, location, and prep links.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
      alsoIntegrations: ['google_calendar'],
    },
    {
      icon: LumaIcon,
      title: 'Luma + Discord community sync',
      prompt:
        'Create a scheduled workflow that pulls the Luma event guest list and adds each new registrant to the matching Discord community channel with the right role for event access.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['community', 'communication'],
      alsoIntegrations: ['discord'],
    },
    {
      icon: LumaIcon,
      title: 'Luma event-series analytics',
      prompt:
        'Build a scheduled workflow that pulls Luma event-series data, calculates conversion from registration to attendance to next action, and writes the analytics to a report file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
    },
    {
      icon: LumaIcon,
      title: 'Luma new-registrant welcome',
      prompt:
        'Create a scheduled workflow that pulls the Luma event guest list, finds registrants added since the last run, and sends each a personalized welcome email with what to expect and how to prepare.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'create-event',
      description:
        'Create a Luma event with a name, start time, timezone, description, and visibility.',
      content:
        '# Create Event\n\nSpin up a new Luma event ready to share.\n\n## Steps\n1. Decide the event name, start time as an ISO 8601 timestamp, and the IANA timezone.\n2. Create Event with those fields plus an optional end time or duration, a Markdown description, and a meeting URL for virtual events.\n3. Set visibility to public, members-only, or private as appropriate.\n\n## Output\nThe created event ID and URL, with its start time, timezone, and visibility.',
    },
    {
      name: 'add-guests-to-event',
      description: 'Add a batch of guests to a Luma event from a list of emails and names.',
      content:
        '# Add Guests to Event\n\nBulk-register guests on a Luma event.\n\n## Steps\n1. Confirm the target event ID.\n2. Build the guests JSON array, one object per guest with an email and optional name or first and last name.\n3. Add Guests with the event ID and the guest array.\n\n## Output\nConfirmation of how many guests were added and the event ID they were added to.',
    },
    {
      name: 'export-guest-list',
      description:
        'Pull a Luma event guest list, optionally filtered by approval status, for follow-up or enrichment.',
      content:
        '# Export Guest List\n\nRetrieve registrants for an event.\n\n## Steps\n1. Get Guests for the event ID, optionally filtering by approval status such as approved or waitlist.\n2. Page through results using the limit and pagination cursor until the full list is collected.\n3. Extract the fields you need, such as email, name, approval status, and registered or checked-in timestamps.\n\n## Output\nThe full guest list with key fields, ready to segment attendees from no-shows or feed into a CRM.',
    },
    {
      name: 'send-event-reminders',
      description:
        'Pull the Luma guest list and prepare personalized reminders for upcoming registrants.',
      content:
        '# Send Event Reminders\n\nPrepare reminder content for an upcoming Luma event.\n\n## Steps\n1. Get Event to read the name, start time, timezone, and meeting or location details.\n2. Get Guests filtered to approved registrants, paging until complete.\n3. For each guest, draft a personalized reminder with the event time in their context and the join or location info.\n\n## Output\nA per-guest list of email addresses and drafted reminder messages, ready to hand to an email or messaging step.',
    },
    {
      name: 'triage-event-registrations',
      description:
        'Review pending Luma registrations and approve, waitlist, or decline each guest.',
      content:
        '# Triage Event Registrations\n\nProcess pending registrations for an event with limited capacity.\n\n## Steps\n1. Get Guests filtered to the pending_approval status, paging until complete.\n2. Apply your approval criteria to each registrant (for example, work email domain or registration answers).\n3. Update Guest Status for each guest to approved, waitlist, or declined, identifying them by email or guest ID.\n\n## Output\nEach pending guest moved to a final approval status, with the applied status reported back per guest.',
    },
    {
      name: 'invite-guests-to-event',
      description:
        'Email Luma event invitations to a list of prospects with an optional custom message.',
      content:
        '# Invite Guests to Event\n\nSend invitations that recipients can accept, rather than registering them outright.\n\n## Steps\n1. Confirm the target event ID.\n2. Build a guests JSON array, one object per invitee with an email and optional name.\n3. Send Invites with the event ID, the guest array, and an optional short message.\n\n## Output\nThe count of guests invited, ready to log or report.',
    },
  ],
} as const satisfies BlockMeta
