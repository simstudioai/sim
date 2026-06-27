import { PagerDutyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const PagerDutyBlockDisplay = {
  type: 'pagerduty',
  name: 'PagerDuty',
  description: 'Manage incidents and on-call schedules with PagerDuty',
  category: 'tools',
  bgColor: '#06AC38',
  icon: PagerDutyIcon,
  iconColor: '#06AC38',
  longDescription:
    'Integrate PagerDuty into your workflow to list, create, and update incidents, add notes, list services, and check on-call schedules.',
  docsLink: 'https://docs.sim.ai/integrations/pagerduty',
  integrationType: IntegrationType.Observability,
  triggerAllowed: true,
} satisfies BlockDisplay

export const PagerDutyBlockMeta = {
  tags: ['incident-management', 'monitoring'],
  url: 'https://www.pagerduty.com',
  templates: [
    {
      icon: PagerDutyIcon,
      title: 'PagerDuty incident war room',
      prompt:
        'Build a scheduled workflow that polls PagerDuty for new severity-1 incidents, opens a Slack war-room channel, invites responders, posts the incident summary, and updates the channel topic with status.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PagerDutyIcon,
      title: 'PagerDuty on-call digest',
      prompt:
        'Create a scheduled daily workflow that summarizes the past 24 hours of PagerDuty incidents, MTTR, and on-call load by responder, and posts a Slack digest to the SRE channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PagerDutyIcon,
      title: 'PagerDuty escalation auditor',
      prompt:
        'Build a scheduled weekly workflow that audits PagerDuty escalation policies, on-call schedules, and gaps in coverage, and writes a remediation backlog to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: PagerDutyIcon,
      title: 'PagerDuty postmortem starter',
      prompt:
        'Create a scheduled workflow that polls PagerDuty for newly resolved incidents and opens a postmortem doc for each with the timeline, responders, and Slack thread linked, ready for the team to fill in root cause.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['google_docs'],
    },
    {
      icon: PagerDutyIcon,
      title: 'PagerDuty auto-triage enricher',
      prompt:
        'Build a scheduled workflow that polls PagerDuty for new incidents, pulls the affected service details, queries recent logs and the latest deploy, and posts an enriched triage summary with likely cause back as an incident note for the responder.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'incident-management', 'automation'],
    },
    {
      icon: PagerDutyIcon,
      title: 'PagerDuty customer-impact notifier',
      prompt:
        'Create a scheduled workflow that polls PagerDuty for incidents on customer-facing services, looks up affected accounts in Salesforce, and drafts a status-page update plus a Slack alert to the customer success team for high-impact outages.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'incident-management', 'communication'],
      alsoIntegrations: ['slack', 'salesforce'],
    },
    {
      icon: PagerDutyIcon,
      title: 'PagerDuty alert-to-ticket bridge',
      prompt:
        'Build a workflow that creates a PagerDuty incident from inbound monitoring alerts, opens a matching Linear issue with the same severity and links the two, and logs the pairing in a table so engineering can track alert-to-fix time.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'incident-management', 'ticketing'],
      alsoIntegrations: ['linear'],
    },
  ],
  skills: [
    {
      name: 'open-incident',
      description:
        'Create a PagerDuty incident on a service with a title, urgency, and description so responders get paged.',
      content:
        '# Open Incident\n\nCreate a new PagerDuty incident and page the on-call responder.\n\n## Steps\n1. Use the Create Incident operation with the target Service ID and a clear, specific Title summarizing the problem.\n2. Set Urgency (high or low) based on customer impact and add a Description with affected systems, symptoms, and any error signatures.\n3. Optionally set an Escalation Policy ID or Assignee User ID to route the page directly.\n4. Capture the returned incident ID, number, and web URL for follow-up.\n\n## Output\nReport the new incident number, urgency, assigned service, and the PagerDuty URL so the team can jump straight to the incident.',
    },
    {
      name: 'triage-active-incidents',
      description:
        'List triggered and acknowledged PagerDuty incidents and produce a prioritized triage summary.',
      content:
        '# Triage Active Incidents\n\nReview what is currently on fire and summarize it for the team.\n\n## Steps\n1. Use List Incidents filtered to Triggered then Acknowledged statuses, sorted by created at (newest first).\n2. Optionally scope to specific Service IDs or a Since window to focus on a team or recent activity.\n3. Group results by service and urgency, flagging high-urgency triggered incidents that are still unacknowledged.\n4. For each, note title, age, status, and the responsible service.\n\n## Output\nA prioritized list leading with unacknowledged high-urgency incidents, including incident number, service, age, and URL.',
    },
    {
      name: 'resolve-and-note-incident',
      description:
        'Update a PagerDuty incident status and add a resolution note documenting what was done.',
      content:
        '# Resolve and Note Incident\n\nClose out an incident with a clear audit trail.\n\n## Steps\n1. Use Update Incident with the Incident ID and set Status to acknowledged or resolved as appropriate.\n2. Use Add Note on the same Incident ID to record the root cause, the fix applied, and any follow-up actions.\n3. Provide a valid From Email (a real PagerDuty user) since these write operations require it.\n4. Confirm the new status from the response.\n\n## Output\nState the incident number, its new status, and a one-line summary of the note that was attached.',
    },
    {
      name: 'check-whos-on-call',
      description:
        'List current PagerDuty on-call assignments for given schedules or escalation policies.',
      content:
        '# Check Who Is On Call\n\nFind the right person to reach right now.\n\n## Steps\n1. Use List On-Calls, optionally scoped by Escalation Policy IDs or Schedule IDs.\n2. Set a Since and Until window to look at the current or an upcoming shift.\n3. Map each on-call entry to its escalation level so primary versus backup responders are clear.\n\n## Output\nA concise roster: who is on call at level 1 (primary) and level 2 (backup) per schedule, with the time window covered.',
    },
  ],
} as const satisfies BlockMeta
