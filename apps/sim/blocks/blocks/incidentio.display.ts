import { IncidentioIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const IncidentioBlockDisplay = {
  type: 'incidentio',
  name: 'incident.io',
  description: 'Manage incidents with incident.io',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: IncidentioIcon,
  longDescription:
    'Integrate incident.io into the workflow. Manage incidents, actions, follow-ups, workflows, schedules, escalations, custom fields, and more.',
  docsLink: 'https://docs.sim.ai/integrations/incidentio',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay

export const IncidentioBlockMeta = {
  tags: ['incident-management', 'monitoring'],
  url: 'https://incident.io',
  templates: [
    {
      icon: IncidentioIcon,
      title: 'incident.io commander',
      prompt:
        'Build a scheduled workflow that polls incident.io for newly declared incidents, opens a Slack war-room for each, invites responders from the on-call schedule, pulls related PagerDuty alerts, and pins the runbook.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack', 'pagerduty'],
    },
    {
      icon: IncidentioIcon,
      title: 'incident.io postmortem starter',
      prompt:
        'Create a scheduled workflow that polls incident.io for recently resolved incidents, pulls the Slack thread, related Sentry errors, and deploy timeline, then drafts a postmortem doc in Google Docs.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['sentry', 'google_docs'],
    },
    {
      icon: IncidentioIcon,
      title: 'incident.io action-item tracker',
      prompt:
        'Build a workflow that watches incident.io for new follow-up actions, creates Linear tickets for each, and writes a tracking table that surfaces overdue actions on a weekly digest.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: IncidentioIcon,
      title: 'incident.io weekly digest',
      prompt:
        'Create a scheduled weekly workflow that summarizes incident.io activity — declared incidents, MTTR, top affected services, action-item completion rate — and posts to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: IncidentioIcon,
      title: 'incident.io customer comms drafter',
      prompt:
        'Build a workflow that during a high-severity incident.io incident drafts customer status-page copy and a tailored email update, holds for approval, and dispatches once approved.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: IncidentioIcon,
      title: 'incident.io SLO impact mapper',
      prompt:
        'Create a workflow that on each incident.io incident maps impacted services to active SLOs, calculates SLO burn, and writes the impact analysis back to the incident timeline.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'analysis'],
    },
    {
      icon: IncidentioIcon,
      title: 'incident.io noise filter',
      prompt:
        'Build a workflow that pulls incident.io declared incidents, classifies a subset as low-impact noise, auto-resolves them after auditing, and writes a noise-rate metric to a table.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
    },
  ],
  skills: [
    {
      name: 'declare-incident-from-alert',
      description:
        'Open an incident.io incident from an inbound alert with the right severity and summary.',
      content:
        '# Declare an Incident From an Alert\n\nTurn a monitoring alert into a structured incident.io incident so responders can act fast.\n\n## Steps\n1. Look up available severities and pick the one matching the alert impact.\n2. Create the incident with a clear name, a summary describing impact and affected service, and the chosen severity.\n3. Set incident type and any required custom fields from the alert payload.\n4. Capture the new incident reference and link.\n\n## Output\nReturn the incident ID, reference, severity, and link. Confirm the responder channel was created so the team can jump in.',
    },
    {
      name: 'post-incident-update',
      description:
        'Update an active incident with current status and a progress note for stakeholders.',
      content:
        '# Post an Incident Update\n\nKeep stakeholders informed by moving an active incident through its lifecycle.\n\n## Steps\n1. Look up the incident by reference or ID to confirm its current status.\n2. List valid incident statuses and choose the next one (investigating, identified, monitoring, resolved).\n3. Update the incident with the new status and a concise progress message.\n\n## Output\nReturn the incident reference, the new status, and a one-line summary of what changed and when.',
    },
    {
      name: 'on-call-handoff-report',
      description: 'Summarize who is on call and recent open incidents for an on-call handoff.',
      content:
        '# On-Call Handoff Report\n\nBuild a clean handoff so the next on-call engineer knows the state of the world.\n\n## Steps\n1. List current schedules and active escalation paths to determine who is on call.\n2. List recent incidents and filter to those that are open or recently resolved.\n3. For each open incident, capture severity, status, and outstanding follow-ups.\n\n## Output\nReturn a handoff brief: who is on call now, open incidents with severity and status, and follow-ups that still need owners.',
    },
    {
      name: 'export-incident-followups',
      description:
        'Pull follow-ups from recent incidents into an actionable list for post-incident review.',
      content:
        '# Export Incident Follow-Ups\n\nGather the action items that came out of recent incidents so none slip through.\n\n## Steps\n1. List incidents within the target time window.\n2. For each, list its follow-ups and capture title, owner, status, and linked incident.\n3. Group follow-ups by owner and by open vs completed.\n\n## Output\nReturn a table of follow-ups grouped by owner with status and source incident, highlighting overdue or unassigned items.',
    },
  ],
} as const satisfies BlockMeta
