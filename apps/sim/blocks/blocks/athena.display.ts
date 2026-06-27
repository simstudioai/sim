import { AthenaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const AthenaBlockDisplay = {
  type: 'athena',
  name: 'Athena',
  description: 'Run SQL queries on data in Amazon S3 using AWS Athena',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #4D27A8 0%, #A166FF 100%)',
  icon: AthenaIcon,
  iconColor: '#A166FF',
  longDescription:
    'Integrate AWS Athena into workflows. Execute SQL queries against data in S3, check query status, retrieve results, manage named queries, and list executions. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/athena',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay

export const AthenaBlockMeta = {
  tags: ['cloud', 'data-analytics'],
  url: 'https://aws.amazon.com/athena',
  templates: [
    {
      icon: AthenaIcon,
      title: 'Athena scheduled report runner',
      prompt:
        'Create a scheduled workflow that runs a saved AWS Athena query daily, writes the result rows to a Sim table, and posts a Slack summary of the top movers.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AthenaIcon,
      title: 'Athena S3 access audit',
      prompt:
        'Build a workflow that runs Athena queries against S3 access logs weekly, identifies unusual access patterns or new principals, and writes findings to a security audit table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: AthenaIcon,
      title: 'Athena cost-explorer query',
      prompt:
        'Build a scheduled workflow that runs Athena queries against AWS cost-and-usage reports daily, writes top cost movers per service to a table, and posts an anomaly digest to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AthenaIcon,
      title: 'Athena + Tinybird real-time bridge',
      prompt:
        'Build a workflow that combines historical Athena queries with realtime Tinybird endpoints into a unified reporting view, writes results to a dashboard table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'sync'],
      alsoIntegrations: ['tinybird'],
    },
    {
      icon: AthenaIcon,
      title: 'Athena + PostHog data-warehouse join',
      prompt:
        'Create a scheduled workflow that joins PostHog event exports with Athena historical data, computes funnel conversion across the join, and writes a daily report.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['product', 'analysis'],
      alsoIntegrations: ['posthog'],
    },
    {
      icon: AthenaIcon,
      title: 'Athena ad-hoc query agent',
      prompt:
        'Build a Slack agent that translates natural-language analytics questions into safe AWS Athena queries, executes them, and returns the table answer with the query for review.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'engineering'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AthenaIcon,
      title: 'Athena weekly executive metrics',
      prompt:
        'Create a scheduled weekly workflow that runs a set of AWS Athena queries against the data lake for revenue, retention, and usage metrics, writes the results to a metrics table, and emails a formatted scorecard to leadership.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'run-query',
      description:
        'Run a SQL query against data in S3 via Athena, wait for completion, and return the results. Use for ad-hoc analysis and reporting over your data lake.',
      content:
        '# Run Query\n\nExecute a SQL query in Athena and return the results.\n\n## Steps\n1. Compose the SQL, naming the database and confirming the output location.\n2. Start the query to obtain a query execution ID.\n3. Poll get query execution until the state is SUCCEEDED, FAILED, or CANCELLED.\n4. On success, fetch the query results and shape the rows into a clean table.\n\n## Output\nReturn the result rows plus the execution ID, data scanned, and runtime. On failure, surface the Athena error message and the SQL that caused it.',
    },
    {
      name: 'scheduled-metrics-report',
      description:
        'Run a saved or composed Athena query on a schedule to compute metrics and produce a report. Use for recurring KPI and usage reporting.',
      content:
        '# Scheduled Metrics Report\n\nCompute recurring metrics from data in S3.\n\n## Steps\n1. Use a named query, or compose the metrics SQL for the reporting period.\n2. Start the query and poll execution until it completes.\n3. Fetch the results and format the metrics for reporting.\n4. Compare against the prior period to highlight movement where relevant.\n\n## Output\nA metrics summary with current values, period-over-period change, and the execution ID for traceability.',
    },
    {
      name: 'manage-named-queries',
      description:
        'Create, look up, and list saved (named) queries in Athena to standardize reusable SQL. Use to maintain a library of vetted analytics queries.',
      content:
        '# Manage Named Queries\n\nMaintain a library of reusable Athena queries.\n\n## Steps\n1. To save a query, create a named query with a clear name, description, database, and the SQL body.\n2. To reuse one, list named queries or get a named query by ID to retrieve its SQL.\n3. Run the retrieved SQL via start query when execution is needed.\n4. Keep names and descriptions accurate so the right query is easy to find.\n\n## Output\nReport the named query ID and name for creates, or the resolved SQL for lookups.',
    },
  ],
} as const satisfies BlockMeta
