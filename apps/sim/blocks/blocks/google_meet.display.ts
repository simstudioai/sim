import { GoogleMeetIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GoogleMeetBlockDisplay = {
  type: 'google_meet',
  name: 'Google Meet',
  description: 'Create and manage Google Meet meetings',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleMeetIcon,
  longDescription:
    'Integrate Google Meet into your workflow. Create meeting spaces, get space details, end conferences, list conference records, and view participants.',
  docsLink: 'https://docs.sim.ai/integrations/google_meet',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay

export const GoogleMeetBlockMeta = {
  tags: ['meeting', 'google-workspace', 'scheduling'],
  url: 'https://workspace.google.com/products/meet',
  templates: [
    {
      icon: GoogleMeetIcon,
      title: 'Google Meet conference recap to Drive',
      prompt:
        'Build a workflow that pulls the conference record and participant list for a finished Google Meet, generates a structured attendance and follow-up recap with an agent, and saves the document to a per-team folder in Google Drive.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['team', 'content'],
      alsoIntegrations: ['google_drive'],
    },
    {
      icon: GoogleMeetIcon,
      title: 'Google Meet daily meeting links',
      prompt:
        "Create a scheduled workflow that reads the day's meetings from a table each morning, creates a Google Meet space for each one, and emails attendees the agenda and join link via Gmail.",
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleMeetIcon,
      title: 'Google Meet conference record archiver',
      prompt:
        'Build a scheduled workflow that lists Google Meet conference records, captures attendance and duration per meeting, and writes the history to a source-of-truth meetings table for reporting.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
    },
    {
      icon: GoogleMeetIcon,
      title: 'Google Meet auto-invite from CRM',
      prompt:
        'Create a workflow that watches Salesforce for new meetings logged on opportunities, creates a matching Google Meet event, invites the right attendees, and writes the meeting link back to the opportunity.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: GoogleMeetIcon,
      title: 'Google Meet daily standup link',
      prompt:
        'Build a scheduled workflow that posts the day’s Google Meet standup link to the team Slack channel five minutes before standup, with the rolling agenda from the standup table.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleMeetIcon,
      title: 'Google Meet customer interview logger',
      prompt:
        'Create a workflow that takes a customer-interview note or transcript, pulls the matching Google Meet conference record and participants for context, extracts themes, quotes, and feature requests with an agent, and writes structured rows to a research table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'product'],
    },
    {
      icon: GoogleMeetIcon,
      title: 'Google Meet retro publisher',
      prompt:
        'Build a workflow that runs after a sprint-retro Google Meet, summarizes what went well, what to improve, and action items, and posts the retro to a Notion page tagged with the sprint number.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['notion'],
    },
  ],
  skills: [
    {
      name: 'create-meeting-space',
      description: 'Create a Google Meet space and return its join link and meeting code.',
      content:
        '# Create a Meeting Space\n\nSpin up a Google Meet space to share.\n\n## Steps\n1. Decide the Access Type: Open (anyone with link), Trusted (organization members), or Restricted (invited only).\n2. Optionally set Entry Point Access if the space should only be joinable from the creating app.\n3. Run the Create Space operation.\n4. Capture the meeting URI and meeting code from the response.\n\n## Output\nReturn the meeting link (meetingUri), the meeting code, the access type, and the space resource name so it can be referenced or shared.',
    },
    {
      name: 'summarize-meeting-attendance',
      description:
        'Pull a Google Meet conference record and its participants to report who attended.',
      content:
        '# Summarize Meeting Attendance\n\nReport attendance for a finished meeting.\n\n## Steps\n1. If you only have the space, run List Conference Records (filter by `space.name = "spaces/..."`) to find the conference record name.\n2. Run Get Conference Record to read start time, end time, and duration.\n3. Run List Participants on that conference record name, paging through results.\n4. Build the attendee list and compute meeting duration.\n\n## Output\nAn attendance summary: meeting start/end and duration, total participant count, and the list of participants. Flag the meeting if no participants are recorded.',
    },
    {
      name: 'list-recent-conferences',
      description: 'List recent Google Meet conference records for reporting or archival.',
      content:
        '# List Recent Conferences\n\nEnumerate past Meet conferences.\n\n## Steps\n1. Run List Conference Records with a Page Size; optionally apply a Filter (e.g., by space name or time).\n2. Page through using the next page token until you have the needed window.\n3. For each record capture the conference record name, associated space, start time, and end time.\n4. Optionally fetch participants per record (List Participants) when attendance is needed.\n\n## Output\nA list of conferences sorted by start time, each with space, start/end, and duration. Include the conference record name so any record can be drilled into.',
    },
  ],
} as const satisfies BlockMeta
