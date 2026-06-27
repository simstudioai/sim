import { CloudWatchIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const CloudWatchBlockDisplay = {
  type: 'cloudwatch',
  name: 'CloudWatch',
  description: 'Query and monitor AWS CloudWatch logs, metrics, and alarms',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #B0084D 0%, #FF4F8B 100%)',
  icon: CloudWatchIcon,
  iconColor: '#FF4F8B',
  longDescription:
    'Integrate AWS CloudWatch into workflows. Run Log Insights queries, list log groups, retrieve log events, list and get metrics, and monitor alarms. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/cloudwatch',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay

export const CloudWatchBlockMeta = {
  tags: ['cloud', 'monitoring'],
  url: 'https://aws.amazon.com/cloudwatch',
  templates: [
    {
      icon: CloudWatchIcon,
      title: 'CloudWatch alarm digest',
      prompt:
        'Create a scheduled daily workflow that summarizes the past 24 hours of CloudWatch alarms by service and severity, identifies repeat offenders, and posts a digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CloudWatchIcon,
      title: 'CloudWatch log triage',
      prompt:
        'Build a scheduled workflow that runs CloudWatch Logs Insights queries hourly for error patterns, clusters matches, writes top groups to a triage table, and pings the on-call engineer.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: CloudWatchIcon,
      title: 'CloudWatch cost-control alerts',
      prompt:
        'Create a scheduled workflow that pulls CloudWatch billing alarms daily, projects month-end spend by service, and posts an alert when projection exceeds budget thresholds.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CloudWatchIcon,
      title: 'CloudWatch incident scribe',
      prompt:
        'Build a scheduled workflow that polls CloudWatch alarms every few minutes for any in ALARM state, captures the surrounding metrics and recent log excerpts, and writes a timeline file for the incident review.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: CloudWatchIcon,
      title: 'CloudWatch SLO burn-rate watcher',
      prompt:
        'Create a workflow that monitors CloudWatch SLO burn rate every five minutes, classifies severity, and pages the on-call team via PagerDuty when burn exceeds fast-burn thresholds.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: CloudWatchIcon,
      title: 'CloudWatch metric archiver',
      prompt:
        'Build a scheduled workflow that exports CloudWatch metric snapshots into S3 long-term storage, preserving granularity for compliance, and writing a manifest table.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: CloudWatchIcon,
      title: 'CloudWatch log error triager',
      prompt:
        'Create a workflow that runs a CloudWatch Logs Insights query against application log groups every few minutes, groups recurring error signatures with an agent, opens a Linear issue for any new error pattern, and posts a Slack alert.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'engineering'],
      alsoIntegrations: ['linear', 'slack'],
    },
  ],
  skills: [
    {
      name: 'investigate-error-spike',
      description:
        'Run a CloudWatch Logs Insights query to find and summarize error spikes in a log group over a time window.',
      content:
        '# Investigate CloudWatch Error Spike\n\nFind the cause of an error spike using Logs Insights.\n\n## Steps\n1. Identify the relevant log group and the time window to investigate.\n2. Run a Logs Insights query that filters for error or exception lines and aggregates by error type.\n3. Pull representative sample log events for the top error groups.\n4. Correlate timing with any recent deploys or traffic changes.\n\n## Output\nA summary of the top error types, their counts, sample messages, and the likely cause.',
    },
    {
      name: 'check-metric-health',
      description:
        'Pull CloudWatch metric statistics for a resource and report whether key metrics are within healthy ranges.',
      content:
        '# Check CloudWatch Metric Health\n\nReview key metrics for a resource against expected thresholds.\n\n## Steps\n1. Identify the namespace, metric names, and dimensions for the resource (e.g. CPUUtilization, latency, error rate).\n2. Get metric statistics over the chosen window with an appropriate period and statistic (Average, p99, Sum).\n3. Compare values against healthy thresholds.\n\n## Output\nA per-metric summary with the current value, trend, and whether it is within a healthy range.',
    },
    {
      name: 'review-alarm-state',
      description:
        'List CloudWatch alarms, report which are in ALARM or INSUFFICIENT_DATA, and optionally mute noisy alarms.',
      content:
        '# Review CloudWatch Alarm State\n\nGet a snapshot of alarm health across the account.\n\n## Steps\n1. Describe alarms and group them by state (OK, ALARM, INSUFFICIENT_DATA).\n2. For alarms in ALARM, capture the metric, threshold, and reason.\n3. If asked, mute alarms that are known-noisy during a maintenance window and note them.\n\n## Output\nA list of alarms currently firing or missing data, with the metric and threshold for each.',
    },
  ],
} as const satisfies BlockMeta
