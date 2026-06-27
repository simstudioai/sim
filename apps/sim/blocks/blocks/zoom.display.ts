import { ZoomIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ZoomBlockDisplay = {
  type: 'zoom',
  name: 'Zoom',
  description: 'Create and manage Zoom meetings and recordings',
  category: 'tools',
  bgColor: '#2D8CFF',
  icon: ZoomIcon,
  iconColor: '#2D8CFF',
  longDescription:
    'Integrate Zoom into workflows. Create, list, update, and delete Zoom meetings. Get meeting details, invitations, recordings, and participants. Manage cloud recordings programmatically.',
  docsLink: 'https://docs.sim.ai/integrations/zoom',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay

export const ZoomBlockMeta = {
  tags: ['meeting', 'calendar', 'scheduling'],
  url: 'https://www.zoom.com',
  templates: [
    {
      icon: ZoomIcon,
      title: 'Zoom recording recap',
      prompt:
        'Build a workflow that runs after a Zoom meeting ends, pulls the cloud recording transcript, summarizes decisions and action items, and posts the recap to the linked Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ZoomIcon,
      title: 'Zoom meeting prep brief',
      prompt:
        'Create a scheduled workflow that runs each morning, lists today’s Zoom meetings, researches attendees with Apollo and the web, and emails a prep brief 30 minutes before each meeting.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'sales'],
      alsoIntegrations: ['apollo', 'gmail'],
    },
    {
      icon: ZoomIcon,
      title: 'Zoom webinar follow-up',
      prompt:
        'Build a workflow that runs after a Zoom webinar, pulls the registrant and attendee lists, sends a follow-up email with the recording link, and writes attendance into HubSpot for marketing scoring.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'crm'],
      alsoIntegrations: ['hubspot', 'gmail'],
    },
    {
      icon: ZoomIcon,
      title: 'Zoom + Notion meeting notes',
      prompt:
        'Create a workflow that watches for Zoom recordings, transcribes, and writes a structured meeting-notes page to Notion under the right team space, with action items linked to owners.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'content'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: ZoomIcon,
      title: 'Zoom sales-call deal updater',
      prompt:
        'Build a workflow that runs after a Zoom sales call, summarizes objections, next steps, and stage signals from the transcript, and updates the linked Salesforce or HubSpot opportunity.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce', 'hubspot'],
    },
    {
      icon: ZoomIcon,
      title: 'Zoom recurring 1:1 logger',
      prompt:
        'Create a workflow that captures Zoom 1:1 meeting recaps, appends them to a per-employee log file, and surfaces talking points for the next 1:1 to the manager in Slack.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['team', 'individual'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ZoomIcon,
      title: 'Zoom + Telegram recap pusher',
      prompt:
        'Create a workflow that runs after a Zoom meeting, summarizes the transcript, and pushes the recap to a chosen Telegram channel for asynchronous review.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'communication'],
      alsoIntegrations: ['telegram'],
    },
  ],
  skills: [
    {
      name: 'schedule-meeting',
      description:
        'Create a Zoom meeting with a topic, time, and settings, and return the join details.',
      content:
        '# Schedule a Zoom Meeting\n\nBook a meeting and capture its join link.\n\n## Steps\n1. Gather the host user ID, meeting topic, start time, duration, and timezone.\n2. Choose the meeting type, typically scheduled, and set options like recording and waiting room.\n3. Call the create-meeting operation.\n4. Capture the meeting ID, join URL, and passcode returned.\n\n## Output\nReturn the meeting ID, join URL, passcode, and start time. If you need formatted invite text, fetch the meeting invitation.',
    },
    {
      name: 'reschedule-meeting',
      description:
        'Find a Zoom meeting and update its time, topic, or settings without recreating it.',
      content:
        '# Reschedule a Zoom Meeting\n\nMove or adjust an existing meeting.\n\n## Steps\n1. Locate the meeting by ID, or list meetings for the host and match on topic.\n2. Get the meeting to read its current settings.\n3. Call update-meeting with only the fields that change, such as start time or duration.\n4. Confirm the update and re-fetch the join details if they changed.\n\n## Output\nReport the meeting ID, the old and new time, and confirm the join URL is unchanged or updated. Note who should be re-notified.',
    },
    {
      name: 'fetch-meeting-recordings',
      description:
        'Retrieve cloud recordings for a past Zoom meeting and return the download links.',
      content:
        '# Fetch Zoom Meeting Recordings\n\nCollect the recordings from a completed meeting.\n\n## Steps\n1. Identify the meeting ID, or use list-recordings to find recent recorded meetings.\n2. Call get-meeting-recordings for the chosen meeting.\n3. Collect the recording files, their types (video, audio, transcript), and download URLs.\n\n## Output\nReturn each recording file with its type, size, and download URL, plus the meeting topic and date. Note if no recordings exist for the meeting.',
    },
  ],
} as const satisfies BlockMeta
