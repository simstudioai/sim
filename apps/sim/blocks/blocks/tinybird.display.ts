import { TinybirdIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const TinybirdBlockDisplay = {
  type: 'tinybird',
  name: 'Tinybird',
  description: 'Send events, query data, and manage Data Sources with Tinybird',
  category: 'tools',
  bgColor: '#2EF598',
  icon: TinybirdIcon,
  longDescription:
    'Interact with Tinybird: stream JSON or NDJSON events with the Events API, run SQL with the Query API, call published Pipe API Endpoints by name with dynamic parameters, and manage Data Sources by appending from a URL, truncating, or deleting rows by condition.',
  docsLink: 'https://docs.sim.ai/integrations/tinybird',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay

export const TinybirdBlockMeta = {
  tags: ['data-warehouse', 'data-analytics'],
  url: 'https://www.tinybird.co',
  templates: [
    {
      icon: TinybirdIcon,
      title: 'Tinybird pipe-as-API endpoint',
      prompt:
        'Create a workflow that calls a Tinybird published pipe with parameters on a schedule, normalizes the results, and writes them into a Sim table for downstream consumers.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'sync'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird realtime metric watcher',
      prompt:
        'Build a workflow that polls a Tinybird pipe every minute for a realtime KPI, compares against a rolling baseline, and pages PagerDuty when the metric crosses a SLO threshold.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird user-segment exporter',
      prompt:
        'Create a workflow that calls a Tinybird published endpoint with segment parameters, writes the user list to a table, and feeds it to a Loops campaign for targeted activation messaging.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'sync'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird usage-meter dashboard',
      prompt:
        'Build a workflow that exposes a Tinybird endpoint reporting per-customer usage for billing, refreshes a Sim table hourly, and surfaces top consumers to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird funnel analytics digest',
      prompt:
        'Create a scheduled workflow that queries a Tinybird pipe for daily signup, activation, and conversion counts, calculates step-over-step drop-off, and posts a funnel digest with week-over-week deltas to the growth Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['analysis', 'reporting', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird anomaly investigator',
      prompt:
        'Build a workflow triggered by an alert that calls a Tinybird pipe to pull the surrounding event data for the affected metric, has an agent summarize the likely cause, and opens a Linear issue with the supporting query results attached.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'analysis', 'monitoring'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird executive KPI report',
      prompt:
        'Create a scheduled weekly workflow that queries several Tinybird pipes for the company’s headline KPIs, assembles them into a Markdown report file with trend commentary, and emails it to the leadership team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analysis', 'enterprise'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'ingest-events',
      description: 'Stream JSON or NDJSON events into a Tinybird Data Source via the Events API.',
      content:
        '# Ingest Events into Tinybird\n\nStream realtime events into a Data Source so they are queryable within seconds.\n\n## Steps\n1. Use the Send Events operation with your Base URL and API Token.\n2. Set the Data Source name that matches your target table.\n3. Provide the events in the Data field, using NDJSON (one JSON object per line) for batches or JSON for a single object.\n4. Enable Wait for Acknowledgment when you need confirmation the rows landed before continuing.\n\n## Output\nReturn the count of successful_rows and quarantined_rows so you can confirm ingestion and catch rows that failed validation.',
    },
    {
      name: 'query-pipe-endpoint',
      description:
        'Call a published Tinybird Pipe API Endpoint with dynamic parameters and return the result.',
      content:
        '# Query a Tinybird Pipe Endpoint\n\nCall a published Pipe by name to get analytics results shaped by dynamic parameters.\n\n## Steps\n1. Use the Query Pipe Endpoint operation with the Base URL, API Token, and the Pipe Name (for example top_pages).\n2. Pass dynamic Parameters as a JSON object whose keys match the parameters the Pipe expects (for example start_date and limit).\n3. Optionally add SQL on top of the Pipe result using the advanced SQL field, selecting from _ to post-process.\n\n## Output\nReturn the result rows as JSON along with the column metadata and row count, ready to write to a table or summarize.',
    },
    {
      name: 'run-sql-query',
      description:
        'Run an ad-hoc SQL query against Tinybird with the Query API and return results.',
      content:
        '# Run a Tinybird SQL Query\n\nExecute SQL directly against your Tinybird data for ad-hoc analysis.\n\n## Steps\n1. Use the Query operation with the Base URL and API Token.\n2. Write the SQL Query and append FORMAT JSON to get structured rows back (other formats return raw text).\n3. Reference Data Sources or Pipes by name in the FROM clause.\n\n## Output\nReturn the result data as an array of objects plus the column metadata, row count, and execution statistics.',
    },
    {
      name: 'manage-datasource-rows',
      description:
        'Append from a URL, truncate, or delete rows by condition in a Tinybird Data Source.',
      content:
        "# Manage Tinybird Data Source Rows\n\nMaintain a Data Source by loading, clearing, or pruning its rows.\n\n## Steps\n1. To load data, use Append Data Source (from URL) with the Data Source name, a Source File URL, and the source format (CSV, NDJSON, or Parquet).\n2. To clear everything, use Truncate Data Source with the Data Source name.\n3. To remove specific rows, use Delete Data Source Rows with a SQL Delete Condition such as event_date < '2024-01-01'.\n4. Enable Dry Run on a delete first to preview how many rows would be removed.\n\n## Output\nReturn the job ID and status for append and delete operations so you can poll for completion, or confirm the truncate succeeded.",
    },
  ],
} as const satisfies BlockMeta
