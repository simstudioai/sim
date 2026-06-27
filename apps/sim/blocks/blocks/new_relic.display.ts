import { NewRelicIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const NewRelicBlockDisplay = {
  type: 'new_relic',
  name: 'New Relic',
  description: 'Query observability data and record deployments in New Relic',
  category: 'tools',
  bgColor: '#000000',
  icon: NewRelicIcon,
  longDescription:
    'Integrate New Relic into workflows. Run NRQL queries, search monitored entities, fetch entity details, and record deployment change events.',
  docsLink: 'https://docs.sim.ai/integrations/new_relic',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay

export const NewRelicBlockMeta = {
  tags: ['monitoring', 'error-tracking', 'incident-management'],
  url: 'https://newrelic.com',
  templates: [
    {
      icon: NewRelicIcon,
      title: 'New Relic health report',
      prompt:
        'Create a scheduled daily workflow that runs NRQL queries against New Relic for error rate, latency percentiles, and throughput, logs the results to a table for trend tracking, and Slacks a morning summary highlighting any degradations.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: NewRelicIcon,
      title: 'New Relic deployment tracker',
      prompt:
        'Build a workflow that fires after each production release, records a New Relic deployment change event for the affected entity, and posts a Slack note linking the deployment to the dashboard for the on-call engineer.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: NewRelicIcon,
      title: 'New Relic anomaly investigator',
      prompt:
        'Create a workflow triggered by an alert that runs targeted NRQL queries to pull the surrounding error and latency data, searches related New Relic entities for blast radius, summarizes likely causes, and opens a Linear ticket.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: NewRelicIcon,
      title: 'New Relic entity inventory',
      prompt:
        'Build a scheduled weekly workflow that searches New Relic for all monitored entities, fetches details for each, logs them into an inventory table, and Slacks a diff of newly added or removed services.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: NewRelicIcon,
      title: 'New Relic SLO weekly review',
      prompt:
        'Create a scheduled weekly workflow that runs NRQL queries to compute error budget burn for each service, writes a narrative review file for the SRE team, and links the supporting dashboards.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
    },
    {
      icon: NewRelicIcon,
      title: 'New Relic cost-by-service breakdown',
      prompt:
        'Build a scheduled monthly workflow that runs NRQL queries to attribute data ingest and compute to each New Relic entity, writes a per-team cost breakdown to a table, and emails finance the services trending over budget.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'finance', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: NewRelicIcon,
      title: 'New Relic incident war-room kickoff',
      prompt:
        'Create a workflow triggered by a PagerDuty incident that runs NRQL queries for the impacted service, pulls the latest deployment change event from New Relic, and posts a war-room summary with golden-signal charts to the incident Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'incident-management'],
      alsoIntegrations: ['pagerduty', 'slack'],
    },
  ],
  skills: [
    {
      name: 'query-golden-signals',
      description:
        'Run NRQL to pull latency, error rate, and throughput for a service over a time window.',
      content:
        '# Query Golden Signals\n\nUse New Relic NRQL to read the golden signals for a service.\n\n## Steps\n1. Identify the service or application name, using Search Entities if it is unknown.\n2. Build NRQL queries for throughput, average and p95 latency, and error rate over the requested window using SELECT ... FROM Transaction WHERE appName = ... SINCE ...\n3. Run NRQL Query for each signal and collect the values.\n\n## Output\nA short table of throughput, latency p50/p95, and error rate with the time window stated. Flag any signal that looks anomalous.',
    },
    {
      name: 'investigate-error-spike',
      description:
        'Use NRQL to break down a New Relic error spike by type and impacted transaction.',
      content:
        '# Investigate Error Spike\n\nDrill into an error spike for a service in New Relic.\n\n## Steps\n1. Run an NRQL query counting errors over time to confirm and bound the spike window.\n2. Break the errors down by error.class, message, and transactionName using FACET.\n3. Use Get Entity to add context such as the service health and recent alerts.\n4. Check for a recent Create Deployment Event near the spike start to correlate with a release.\n\n## Output\nThe top error types by count, the most impacted transactions, and whether a recent deployment lines up with the spike.',
    },
    {
      name: 'record-deployment-marker',
      description: 'Create a New Relic deployment event so releases line up with metric changes.',
      content:
        '# Record Deployment Marker\n\nMark a deployment in New Relic to correlate releases with performance.\n\n## Steps\n1. Identify the target entity with Search Entities to get its GUID.\n2. Run Create Deployment Event with the version, and include the commit or changelog and the user who deployed.\n3. Confirm the marker is associated with the right entity.\n\n## Output\nConfirm the deployment event created, with the entity name, version, and timestamp.',
    },
  ],
} as const satisfies BlockMeta
