import { GoogleBigQueryIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GoogleBigQueryBlockDisplay = {
  type: 'google_bigquery',
  name: 'Google BigQuery',
  description: 'Query, list, and insert data in Google BigQuery',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleBigQueryIcon,
  longDescription:
    'Connect to Google BigQuery to run SQL queries, list datasets and tables, get table metadata, and insert rows.',
  docsLink: 'https://docs.sim.ai/integrations/google_bigquery',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay

export const GoogleBigQueryBlockMeta = {
  tags: ['data-warehouse', 'google-workspace', 'data-analytics'],
  url: 'https://cloud.google.com/bigquery',
  templates: [
    {
      icon: GoogleBigQueryIcon,
      title: 'BigQuery scheduled report runner',
      prompt:
        'Build a scheduled workflow that runs a saved BigQuery query daily, writes the result rows to a Sim table, and posts a Slack summary of the top movers.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleBigQueryIcon,
      title: 'BigQuery customer 360 builder',
      prompt:
        'Create a scheduled workflow that joins BigQuery sources — Stripe, product events, support tickets — into a single per-customer profile table refreshed daily.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'sync'],
    },
    {
      icon: GoogleBigQueryIcon,
      title: 'BigQuery cost-tracking alerts',
      prompt:
        'Build a scheduled daily workflow that pulls BigQuery slot and storage usage, projects month-end spend, and posts a Slack alert when projection exceeds budget.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleBigQueryIcon,
      title: 'BigQuery anomaly notifier',
      prompt:
        'Create a workflow that runs BigQuery anomaly-detection queries on key metrics hourly, writes any anomalies to a tracking table, and pages the on-call data team on severe deltas.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'analysis'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: GoogleBigQueryIcon,
      title: 'BigQuery + Sheets exec dashboard',
      prompt:
        'Build a scheduled workflow that pulls a BigQuery executive dashboard query weekly, writes the result into a chosen Google Sheet, and notifies leadership the new snapshot is ready.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'enterprise'],
      alsoIntegrations: ['google_sheets', 'gmail'],
    },
    {
      icon: GoogleBigQueryIcon,
      title: 'BigQuery schema drift detector',
      prompt:
        'Create a scheduled workflow that snapshots BigQuery dataset schemas, diffs against the prior snapshot, and opens a Linear ticket on unexpected schema changes.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: GoogleBigQueryIcon,
      title: 'BigQuery NL analytics agent',
      prompt:
        "Build a Slack agent that lists BigQuery datasets and tables to understand the schema, translates a teammate's natural-language question into a safe BigQuery SQL query, runs it, and replies with the result table plus the query used.",
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'engineering'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'answer-question-with-sql',
      description:
        'Inspect BigQuery schema, translate a natural-language question into safe SQL, run it, and return results.',
      content:
        '# Answer Question With SQL\n\nUse BigQuery to answer a data question from plain English.\n\n## Steps\n1. List datasets and tables, and Get Table on the relevant ones to understand the schema and column types.\n2. Translate the question into a single read-only BigQuery Standard SQL query, scoping it with filters and a LIMIT to control cost.\n3. Use Run Query to execute it.\n\n## Output\nReturn the result rows as a table plus the exact SQL query used, so the answer is verifiable. If the schema cannot support the question, say what is missing.',
    },
    {
      name: 'explore-dataset-schema',
      description:
        'List BigQuery datasets and tables and summarize the schema of a dataset for an analyst.',
      content:
        '# Explore Dataset Schema\n\nUse BigQuery to map out what data is available.\n\n## Steps\n1. List datasets in the project.\n2. List tables in the target dataset.\n3. Get Table on each relevant table to read its columns, types, and descriptions.\n\n## Output\nReturn a structured schema summary: each table with its columns, types, and a one-line purpose. Highlight likely join keys so an analyst can plan queries.',
    },
    {
      name: 'load-rows-to-table',
      description: 'Insert structured rows into a BigQuery table for logging or pipeline output.',
      content:
        '# Load Rows to Table\n\nUse BigQuery to write structured records into a table.\n\n## Steps\n1. Confirm the target dataset and table, and Get Table to verify the expected columns and types.\n2. Shape the incoming records to match the table schema exactly.\n3. Use Insert Rows to write the batch.\n\n## Output\nReturn the count of rows inserted and any rows rejected with their error. If types did not match the schema, report which fields failed rather than silently dropping data.',
    },
  ],
} as const satisfies BlockMeta
