import { DatabricksIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const DatabricksBlockDisplay = {
  type: 'databricks',
  name: 'Databricks',
  description: 'Run SQL queries and manage jobs on Databricks',
  category: 'tools',
  bgColor: '#F9F7F4',
  icon: DatabricksIcon,
  longDescription:
    'Connect to Databricks to execute SQL queries against SQL warehouses, trigger and monitor job runs, manage clusters, and retrieve run outputs. Requires a Personal Access Token and workspace host URL.',
  docsLink: 'https://docs.sim.ai/integrations/databricks',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay

export const DatabricksBlockMeta = {
  tags: ['data-warehouse', 'data-analytics', 'cloud'],
  url: 'https://www.databricks.com',
  templates: [
    {
      icon: DatabricksIcon,
      title: 'Databricks job runner',
      prompt:
        'Build a scheduled workflow that triggers a Databricks job daily, polls until completion, writes the run status and metrics to a control table, and pages on failure.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks cluster cost guard',
      prompt:
        'Create a scheduled workflow that lists Databricks clusters hourly, flags clusters that are running while idle, and posts a Slack alert with the candidates to shut down so the platform team can reclaim spend.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks notebook scheduler',
      prompt:
        'Build a workflow that runs a parameterized Databricks notebook, captures the outputs as files, and posts the result to a chosen Slack channel for review.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks ML feature freshness',
      prompt:
        'Create a scheduled workflow that runs SQL against Databricks feature tables to check the latest update timestamp per feature, alerts when a critical feature has stale data, and writes the alert details to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks model evaluator',
      prompt:
        'Build a workflow that runs a Databricks ML model evaluation job on the latest data, captures the metrics, writes results to a model-registry table, and pings Slack on regression.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks Delta Lake compactor',
      prompt:
        'Create a scheduled workflow that runs OPTIMIZE and VACUUM on Databricks Delta Lake tables weekly, captures the size and performance delta, and writes a maintenance report.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks job failure watcher',
      prompt:
        'Build a workflow that lists recent Databricks job runs every 15 minutes, detects failed runs, pulls the run output and error for an agent to summarize the likely cause, and posts an actionable Slack alert with a link to the run.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'engineering'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'run-sql-query',
      description:
        'Execute a SQL query against a Databricks SQL warehouse and return the results in a clean, summarized form.',
      content:
        '# Run a Databricks SQL Query\n\nQuery a table or view and summarize the result.\n\n## Steps\n1. Confirm the SQL warehouse and the query to run.\n2. Execute the SQL statement and wait for it to complete.\n3. Capture the returned rows and column schema.\n4. Summarize key findings (counts, totals, notable values).\n\n## Output\nThe query results plus a short plain-English summary of what they show.',
    },
    {
      name: 'trigger-job-run',
      description:
        'Trigger a Databricks job, capture the run id, and confirm it started successfully.',
      content:
        '# Trigger a Databricks Job\n\nKick off a job and confirm it launched.\n\n## Steps\n1. List jobs to confirm the target job id and name.\n2. Run the job with any required parameters.\n3. Capture the run id and starting state.\n\n## Output\nA confirmation with the job name, run id, and initial status.',
    },
    {
      name: 'monitor-job-run',
      description:
        'Check the status of a Databricks job run, pull its output, and diagnose failures.',
      content:
        '# Monitor a Databricks Job Run\n\nTrack a job run to completion and report results.\n\n## Steps\n1. Get the run for the given run id and read its lifecycle and result state.\n2. If still running, report progress; if finished, pull the run output.\n3. On failure, capture the error and the failing task.\n\n## Output\nA run summary with final state, key output, and (on failure) the error and failing task.',
    },
  ],
} as const satisfies BlockMeta
