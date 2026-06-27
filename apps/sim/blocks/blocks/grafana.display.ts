import { GrafanaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GrafanaBlockDisplay = {
  type: 'grafana',
  name: 'Grafana',
  description: 'Interact with Grafana dashboards, alerts, and annotations',
  category: 'tools',
  bgColor: '#F46800',
  icon: GrafanaIcon,
  longDescription:
    'Integrate Grafana into workflows. Manage dashboards, alerts, annotations, data sources, folders, and monitor health status.',
  docsLink: 'https://docs.sim.ai/integrations/grafana',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay

export const GrafanaBlockMeta = {
  tags: ['monitoring', 'data-analytics'],
  url: 'https://grafana.com',
  templates: [
    {
      icon: GrafanaIcon,
      title: 'Grafana alert auto-context',
      prompt:
        'Build a scheduled workflow that polls Grafana for firing alert rules, pulls related logs and recent deploys, summarizes them with an agent, and posts the enriched alert to PagerDuty and Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty', 'slack'],
    },
    {
      icon: GrafanaIcon,
      title: 'Grafana SLO scorecard',
      prompt:
        'Create a scheduled weekly workflow that queries Grafana for SLO compliance across services, calculates burn rates, and writes a scorecard to a tables-based SRE review board.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
    },
    {
      icon: GrafanaIcon,
      title: 'Grafana dashboard auditor',
      prompt:
        'Build a scheduled workflow that scans Grafana dashboards monthly for broken panels, unused dashboards, and missing alerts, and writes a cleanup queue for the platform team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: GrafanaIcon,
      title: 'Grafana metric export',
      prompt:
        'Create a workflow that exports Grafana metric queries on schedule into a Sim table, so the data can be combined with business metrics for unified reporting.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'sync'],
    },
    {
      icon: GrafanaIcon,
      title: 'Grafana incident annotator',
      prompt:
        'Build a scheduled workflow that polls PagerDuty for new incidents and adds Grafana annotations to relevant dashboards with the incident link, so engineers can see the context immediately on the timeline.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: GrafanaIcon,
      title: 'Grafana on-call digest',
      prompt:
        'Create a scheduled daily workflow that summarizes the past 24 hours of Grafana alerts by service and severity, and posts an on-call digest to Slack each morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GrafanaIcon,
      title: 'Grafana + Linear feature-impact',
      prompt:
        'Build a scheduled workflow that polls Grafana for metric regressions correlated with recent Linear releases and posts a regression review to the team Slack with the suspected change.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
      alsoIntegrations: ['linear', 'slack'],
    },
  ],
  skills: [
    {
      name: 'annotate-deploy',
      description:
        'Create a Grafana annotation marking a deploy or incident so it shows on dashboards.',
      content:
        '# Annotate Deploy\n\nMark a deploy, release, or incident on Grafana dashboards for correlation.\n\n## Steps\n1. Build the annotation text (e.g. version, PR link, who triggered it) and tags for filtering.\n2. Create an annotation with the event time, or a time range for incidents with a start and end.\n3. Optionally scope the annotation to a specific dashboard so it appears only there.\n4. List annotations for the window to confirm it was recorded.\n\n## Output\nReturn the annotation ID, time, and tags. Useful for correlating metric changes with deploys later.',
    },
    {
      name: 'review-firing-alerts',
      description:
        'List Grafana alert rules and surface those currently firing with their contact points.',
      content:
        '# Review Firing Alerts\n\nProduce a snapshot of alerting health for an on-call handoff or incident triage.\n\n## Steps\n1. List alert rules and capture each rule name, condition, and current state.\n2. Get details on rules that are firing or in a pending state.\n3. List contact points so each firing rule can be mapped to who gets notified.\n4. Group findings by severity or folder.\n\n## Output\nReturn a list of firing and pending alerts with rule name, state, and notification target, plus a count of healthy rules. Suitable for an on-call digest.',
    },
    {
      name: 'audit-dashboards',
      description: 'List Grafana dashboards and folders and report data sources each depends on.',
      content:
        '# Audit Dashboards\n\nInventory dashboards and the data sources they rely on.\n\n## Steps\n1. List folders and dashboards to build the full inventory.\n2. Get details for each dashboard of interest to read its panels and referenced data sources.\n3. List data sources, then check the health of each one to flag dashboards pointing at unreachable or deprecated sources.\n\n## Output\nReturn an inventory grouped by folder, each dashboard with its UID and the data sources it uses, plus a flagged list of dashboards whose data sources failed their health check.',
    },
    {
      name: 'provision-monitoring-folder',
      description:
        'Create a Grafana folder and seed it with a starter dashboard for a new service or team.',
      content:
        '# Provision Monitoring Folder\n\nSet up an organized monitoring home for a new service or team.\n\n## Steps\n1. Create a folder with a descriptive title for the service or team.\n2. List data sources and pick the one the new dashboard should query.\n3. Create a dashboard inside the folder with starter panels for the key metrics.\n4. Get the dashboard back to confirm it was created in the right folder.\n\n## Output\nReturn the folder UID and the new dashboard UID and link. Note the data source the dashboard was wired to.',
    },
    {
      name: 'provision-alerting',
      description:
        'Stand up a Grafana alert rule and the contact point it notifies for a new service.',
      content:
        '# Provision Alerting\n\nWire up end-to-end alerting for a service: a notification target plus the rule that fires to it.\n\n## Steps\n1. List existing contact points to avoid duplicating one.\n2. Create a contact point for the destination (Slack, email, or PagerDuty) with its settings.\n3. Create an alert rule in the target folder with the query data, condition, and for-duration.\n4. Get the alert rule back to confirm it was created and is not paused.\n\n## Output\nReturn the new contact point UID and alert rule UID, with the data source and threshold the rule evaluates.',
    },
  ],
} as const satisfies BlockMeta
