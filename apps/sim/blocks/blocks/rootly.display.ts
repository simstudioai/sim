import { RootlyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const RootlyBlockDisplay = {
  type: 'rootly',
  name: 'Rootly',
  description: 'Manage incidents, alerts, and on-call with Rootly',
  category: 'tools',
  bgColor: '#6C72C8',
  icon: RootlyIcon,
  iconColor: '#6C72C8',
  longDescription:
    'Integrate Rootly incident management into workflows. Create and manage incidents, alerts, services, severities, and retrospectives.',
  docsLink: 'https://docs.sim.ai/integrations/rootly',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay

export const RootlyBlockMeta = {
  tags: ['incident-management', 'monitoring'],
  url: 'https://rootly.com',
  templates: [
    {
      icon: RootlyIcon,
      title: 'Rootly incident war-room',
      prompt:
        'Build a scheduled workflow that polls Rootly for newly opened incidents, creates a Slack war-room channel for each, invites responders, posts the incident summary, and keeps the channel topic in sync with severity.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RootlyIcon,
      title: 'Rootly retro generator',
      prompt:
        'Create a scheduled workflow that polls Rootly for recently closed incidents, drafts the retrospective doc, pulls the Slack thread and timeline, and assigns owners for follow-up actions in Linear.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack', 'linear'],
    },
    {
      icon: RootlyIcon,
      title: 'Rootly weekly digest',
      prompt:
        'Build a scheduled weekly workflow that summarizes Rootly incident counts, MTTR, top affected services, and outstanding action items, and posts a digest to leadership Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RootlyIcon,
      title: 'Rootly customer-comms drafter',
      prompt:
        'Create a workflow that drafts and queues customer-facing status updates during a Rootly incident based on severity and impacted services, holding for approval before publishing.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication'],
    },
    {
      icon: RootlyIcon,
      title: 'Rootly action-item tracker',
      prompt:
        'Build a workflow that tracks Rootly follow-up actions across incidents, opens Linear tickets, and writes a tables-based dashboard that flags overdue items by owner.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: RootlyIcon,
      title: 'Rootly on-call digest',
      prompt:
        'Create a scheduled daily workflow that summarizes the past 24 hours of Rootly pages, the on-call responder load by person, and writes a digest to the SRE Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RootlyIcon,
      title: 'Rootly + LangSmith agent-incident tracker',
      prompt:
        'Build a workflow that for each Rootly incident involving an AI agent attaches the LangSmith trace, captures the failure mode, and writes the agent-quality regression analysis.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'engineering'],
      alsoIntegrations: ['langsmith'],
    },
  ],
  skills: [
    {
      name: 'declare-incident',
      description: 'Open a Rootly incident with the right severity, service, and team assigned.',
      content:
        '# Declare Incident\n\nSpin up a structured Rootly incident from an alert or report.\n\n## Steps\n1. Run list_severities, list_services, and list_teams to resolve the correct ids.\n2. Run create_incident with a clear title, summary, severity, affected service, and owning team.\n3. Capture the returned incident id.\n4. Add an opening timeline note with add_incident_event.\n\n## Output\nReturn the incident id, severity, assigned team, and a link. Confirm the opening event was logged.',
    },
    {
      name: 'post-incident-update',
      description: 'Append a status update event to an active Rootly incident timeline.',
      content:
        '# Post Incident Update\n\nKeep an incident timeline current.\n\n## Steps\n1. Run get_incident to confirm the current state.\n2. Run add_incident_event with the update text (mitigation steps, customer impact, next checkpoint).\n3. Run update_incident if the severity or status has changed.\n\n## Output\nReturn the appended event and the current incident status.',
    },
    {
      name: 'triage-alerts',
      description:
        'List open Rootly alerts, acknowledge them, and escalate to an incident if needed.',
      content:
        '# Triage Alerts\n\nWork through the open alert queue.\n\n## Steps\n1. Run list_alerts to pull open alerts.\n2. For each, run get_alert for detail and run acknowledge_alert to claim it.\n3. If an alert warrants response, run create_incident and link it.\n4. Run resolve_alert once the alert is handled.\n\n## Output\nReturn how many alerts were acknowledged, resolved, and escalated to incidents.',
    },
    {
      name: 'check-on-call',
      description:
        'Look up who is currently on call across Rootly schedules and escalation policies.',
      content:
        '# Check On Call\n\nFind the right person to page right now.\n\n## Steps\n1. Run list_schedules to enumerate on-call schedules.\n2. Run list_on_calls to read the current rotation members.\n3. Cross-reference list_escalation_policies for the escalation path.\n\n## Output\nReturn the current on-call person per schedule and the escalation order.',
    },
    {
      name: 'track-action-items',
      description: 'Create and list retrospective action items tied to a Rootly incident.',
      content:
        '# Track Action Items\n\nCapture and follow up on postmortem action items.\n\n## Steps\n1. Run get_incident to confirm the incident context.\n2. Run create_action_item for each follow-up with a clear owner and description.\n3. Run list_action_items to review open items for the incident.\n\n## Output\nReturn the created action items and the list of outstanding follow-ups.',
    },
  ],
} as const satisfies BlockMeta
