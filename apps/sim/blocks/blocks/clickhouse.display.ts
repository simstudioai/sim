import { ClipboardList, File } from '@/components/emcn/icons'
import { ClickHouseIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ClickHouseBlockDisplay = {
  type: 'clickhouse',
  name: 'ClickHouse',
  description: 'Connect to a ClickHouse database',
  category: 'tools',
  bgColor: '#f9ff69',
  icon: ClickHouseIcon,
  longDescription:
    'Integrate ClickHouse into the workflow. Query and insert data, manage databases and tables, inspect schemas, monitor mutations and running queries, manage partitions, and execute raw SQL over the ClickHouse HTTP interface.',
  docsLink: 'https://docs.sim.ai/integrations/clickhouse',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay

export const ClickHouseBlockMeta = {
  tags: ['data-warehouse', 'data-analytics'],
  url: 'https://clickhouse.com',
  templates: [
    {
      icon: ClickHouseIcon,
      title: 'Natural-language ClickHouse query',
      prompt:
        'Build a workflow where I ask a question in plain English, an agent writes the matching ClickHouse SQL against my events table, runs the query, and returns the results formatted as a readable answer.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['data-analytics', 'data-warehouse'],
    },
    {
      icon: File,
      title: 'Daily ClickHouse metrics digest',
      prompt:
        'Create a scheduled workflow that runs a set of ClickHouse aggregation queries each morning, summarizes the key trends and anomalies with an agent, and posts the digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['data-analytics', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ClipboardList,
      title: 'Event ingestion to ClickHouse',
      prompt:
        'Build a workflow that takes incoming event payloads, maps them to the right columns with an agent, and bulk-inserts the rows into a ClickHouse table for analytics.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['data-analytics', 'data-warehouse'],
    },
  ],
  skills: [
    {
      name: 'answer-question-with-sql',
      description:
        'Translate a plain-English analytics question into ClickHouse SQL, run it, and return the answer. Use for ad-hoc data questions over a ClickHouse table.',
      content:
        '# Answer Question With SQL\n\nTurn a natural-language question into a ClickHouse query and report the result.\n\n## Steps\n1. If you do not know the schema, use Introspect Schema or Describe Table to learn the columns and types.\n2. Write a ClickHouse SELECT using ClickHouse functions (toDate, uniqExact, quantile, etc.). Filter on primary/sorting keys and add a LIMIT for exploratory queries.\n3. Run it with the Query (SELECT) operation against the connection (host, port, database, credentials).\n4. Inspect the returned rows and row count.\n\n## Output\nReturn the result as a small table plus a one-sentence answer to the original question. Include the SQL you ran so it is reproducible. If the query errors, report the message and adjust the SQL rather than guessing blindly.',
    },
    {
      name: 'summarize-metrics',
      description:
        'Run aggregation queries against ClickHouse and summarize key metrics and trends. Use for a recurring metrics digest or dashboard refresh.',
      content:
        '# Summarize Metrics\n\nCompute and summarize metrics from ClickHouse.\n\n## Steps\n1. Confirm the relevant table and time column with Describe Table if needed.\n2. Write aggregation queries (e.g. daily uniqExact users, counts, quantiles over a time window) using Query (SELECT).\n3. Run each query against the connection and collect the results.\n4. Compare against the prior period to spot increases, drops, or anomalies.\n\n## Output\nReturn a concise digest: the headline numbers, period-over-period change, and any notable anomalies. Keep it readable, lead with the most important metric, and note the time window covered.',
    },
    {
      name: 'bulk-insert-events',
      description:
        'Insert a batch of rows into a ClickHouse table after mapping them to the right columns. Use to ingest event or record payloads into ClickHouse.',
      content:
        '# Bulk Insert Events\n\nLoad a batch of records into a ClickHouse table.\n\n## Steps\n1. Use Describe Table to confirm the target column names and types.\n2. Map each incoming payload to those columns, coercing types (e.g. timestamps to DateTime format, numbers to the right width).\n3. Build a JSON array of row objects with consistent keys, then use Insert Rows (Bulk) against the table.\n4. Verify with Count Rows or a small SELECT.\n\n## Output\nReturn the number of rows inserted and any rows that were skipped or failed validation, with the reason. Confirm the new total row count so the caller knows ingestion succeeded.',
    },
  ],
} as const satisfies BlockMeta
