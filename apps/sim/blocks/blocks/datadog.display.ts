import { DatadogIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const DatadogBlockDisplay = {
  type: 'datadog',
  name: 'Datadog',
  description: 'Monitor infrastructure, applications, and logs with Datadog',
  category: 'tools',
  bgColor: '#632CA6',
  icon: DatadogIcon,
  iconColor: '#632CA6',
  longDescription:
    'Integrate Datadog monitoring into workflows. Submit metrics, manage monitors, query logs, create events, handle downtimes, and more.',
  docsLink: 'https://docs.sim.ai/integrations/datadog',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay

export const DatadogBlockMeta = {
  tags: ['monitoring', 'incident-management', 'error-tracking'],
  url: 'https://www.datadoghq.com',
  templates: [
    {
      icon: DatadogIcon,
      title: 'Infrastructure health report',
      prompt:
        'Create a scheduled daily workflow that queries Datadog for key infrastructure metrics — error rates, latency percentiles, CPU and memory usage — logs them to a table for trend tracking, and sends a morning Slack report highlighting any anomalies or degradations.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'infrastructure', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DatadogIcon,
      title: 'Datadog alert-to-Linear bridge',
      prompt:
        'Build a scheduled workflow that polls Datadog monitors for any in an alerting state, classifies severity, creates a Linear ticket for non-paging issues with full context, and posts a Slack notification linking both.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['linear', 'slack'],
    },
    {
      icon: DatadogIcon,
      title: 'Datadog SLO weekly review',
      prompt:
        'Create a scheduled weekly workflow that queries Datadog timeseries for the key reliability metrics behind each service SLO, computes error budget burn, and writes a narrative review file for the SRE team to discuss in the weekly meeting.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
    },
    {
      icon: DatadogIcon,
      title: 'Datadog cost optimizer',
      prompt:
        'Build a scheduled workflow that queries Datadog estimated-usage timeseries for the top custom metrics by volume, writes optimization recommendations to a finance review file, and pings the platform team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DatadogIcon,
      title: 'Datadog monitor config backup',
      prompt:
        'Create a scheduled workflow that lists every Datadog monitor nightly, fetches each monitor’s full configuration, exports the definitions as JSON to S3 with version history, and writes a manifest to a tracking table for restore drills.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: DatadogIcon,
      title: 'Datadog deploy guardrail',
      prompt:
        'Build a workflow triggered after a deploy that creates a Datadog event marker, queries error-rate and latency timeseries over the next few minutes, and pages the team via PagerDuty if the metrics breach the rollback threshold.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'engineering'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: DatadogIcon,
      title: 'Datadog SLO weekly report',
      prompt:
        'Create a scheduled weekly workflow that queries Datadog timeseries for key service SLOs, lists which monitors fired during the week, writes the SLO compliance numbers to a table, and emails an availability summary to the on-call leads.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'reporting', 'monitoring'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'triage-firing-monitors',
      description:
        'List Datadog monitors, surface those in alert or warn state, and summarize what is firing and why.',
      content:
        '# Triage Firing Datadog Monitors\n\nGet a clear picture of what is alerting right now.\n\n## Steps\n1. List monitors and filter to those in Alert or Warn states.\n2. For each, get the monitor details: query, threshold, and current value.\n3. Group by service or tag to find common root causes.\n\n## Output\nA prioritized list of firing monitors with the metric, threshold, and likely affected service.',
    },
    {
      name: 'investigate-logs',
      description:
        'Query Datadog logs for a service and time window to find errors and summarize patterns.',
      content:
        '# Investigate Datadog Logs\n\nSearch logs to diagnose an issue.\n\n## Steps\n1. Confirm the service, environment, and time window.\n2. Query logs filtering for error/critical status and the relevant service tag.\n3. Aggregate by error message or type to find the dominant patterns.\n4. Pull sample log lines for the top patterns.\n\n## Output\nA summary of the top error patterns with counts and sample log lines.',
    },
    {
      name: 'analyze-metric-trend',
      description:
        'Query a Datadog timeseries metric over a window and report the trend, anomalies, and current value.',
      content:
        '# Analyze a Datadog Metric Trend\n\nUnderstand how a metric is behaving over time.\n\n## Steps\n1. Confirm the metric query and the time window.\n2. Query the timeseries and compute the trend (rising, flat, falling).\n3. Identify spikes, dips, or anomalies and when they occurred.\n\n## Output\nA short analysis with the current value, overall trend, and any notable anomalies with timestamps.',
    },
    {
      name: 'schedule-maintenance-downtime',
      description:
        'Create a Datadog downtime to mute monitors during a maintenance window, then confirm the scope and timing.',
      content:
        '# Schedule Datadog Maintenance Downtime\n\nSuppress alerts during planned maintenance.\n\n## Steps\n1. Confirm the scope (tags/monitors) and the start and end times.\n2. Create the downtime with that scope and window.\n3. Verify it was created by listing active downtimes.\n\n## Output\nA confirmation of the downtime with its scope, start/end time, and id.',
    },
  ],
} as const satisfies BlockMeta
