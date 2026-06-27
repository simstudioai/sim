import { DagsterIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const DagsterBlockDisplay = {
  type: 'dagster',
  name: 'Dagster',
  description: 'Orchestrate data pipelines and manage job runs with Dagster',
  category: 'tools',
  bgColor: '#ffffff',
  icon: DagsterIcon,
  longDescription:
    'Connect to a Dagster instance to launch job runs, monitor run status, list available jobs across repositories, terminate or delete runs, reexecute failed runs, fetch run logs, and manage schedules and sensors. API token only required for Dagster+.',
  docsLink: 'https://docs.sim.ai/integrations/dagster',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay

export const DagsterBlockMeta = {
  tags: ['data-analytics', 'automation'],
  url: 'https://dagster.io',
  templates: [
    {
      icon: DagsterIcon,
      title: 'Dagster pipeline status digest',
      prompt:
        'Create a scheduled daily workflow that pulls Dagster run statuses for the previous day, identifies failed and skipped runs, and posts a digest with links to the worst offenders in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DagsterIcon,
      title: 'Dagster asset freshness watcher',
      prompt:
        'Build a scheduled workflow that polls Dagster assets, checks each critical asset’s latest materialization timestamp against a freshness threshold, alerts when an asset becomes stale, and opens a Linear ticket for the data-platform team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: DagsterIcon,
      title: 'Dagster job kickoff orchestrator',
      prompt:
        'Create a workflow that triggers a Dagster job with run parameters when an upstream condition is satisfied, polls until completion, and writes the run outcome to a control table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: DagsterIcon,
      title: 'Dagster cost dashboard',
      prompt:
        'Build a scheduled weekly workflow that pulls Dagster run durations, calculates compute cost per pipeline, and writes a weekly cost dashboard to a finance review file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: DagsterIcon,
      title: 'Dagster lineage map',
      prompt:
        'Create a workflow that exports Dagster asset lineage into a graph database for cross-pipeline impact analysis when an upstream source schema changes.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
      alsoIntegrations: ['neo4j'],
    },
    {
      icon: DagsterIcon,
      title: 'Dagster sensor health watcher',
      prompt:
        'Build a scheduled workflow that lists Dagster sensors, checks their tick history, and alerts Slack when a sensor stops emitting ticks unexpectedly.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DagsterIcon,
      title: 'Dagster + Databricks coordinator',
      prompt:
        'Create a workflow that orchestrates a Dagster job that triggers a Databricks notebook, waits for completion, captures outputs, and writes the unified run history to a tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['databricks'],
    },
  ],
  skills: [
    {
      name: 'launch-pipeline-run',
      description:
        'Launch a Dagster job run with the right config and report the run id and starting status.',
      content:
        '# Launch a Dagster Pipeline Run\n\nKick off a data pipeline job.\n\n## Steps\n1. List jobs to confirm the target job name.\n2. Assemble the run config (partitions, tags, resources) for the run.\n3. Launch the run and capture the run id.\n4. Confirm the run entered the queue or started.\n\n## Output\nA confirmation with the run id, job name, and initial status.',
    },
    {
      name: 'monitor-failed-runs',
      description:
        'List recent Dagster runs, surface failures, and pull logs to diagnose why a run failed.',
      content:
        '# Monitor Failed Dagster Runs\n\nFind and diagnose pipeline failures.\n\n## Steps\n1. List recent runs and filter to those in a failed state.\n2. For each failed run, get the run details and pull its logs.\n3. Identify the failing step/op and the error message.\n4. Decide whether a re-execute of the failed steps is appropriate.\n\n## Output\nA per-run failure summary with the failing op, error, and a recommendation (retry or investigate).',
    },
    {
      name: 'reexecute-failed-run',
      description:
        'Re-execute a failed Dagster run from the point of failure and confirm the new run started.',
      content:
        '# Re-execute a Failed Dagster Run\n\nRetry a pipeline from where it broke.\n\n## Steps\n1. Get the failed run to confirm its id and failure point.\n2. Re-execute the run, scoping to the failed and downstream steps when supported.\n3. Capture the new run id and status.\n\n## Output\nA confirmation with the original run id, the new run id, and the re-execution scope.',
    },
    {
      name: 'manage-schedules',
      description:
        'List Dagster schedules and sensors and start or stop them to control automated pipeline execution.',
      content:
        '# Manage Dagster Schedules\n\nControl which automated triggers are running.\n\n## Steps\n1. List schedules and sensors with their current running state.\n2. Identify the schedule or sensor to change.\n3. Start or stop it as requested.\n4. Confirm the new state.\n\n## Output\nA confirmation of which schedules/sensors were started or stopped and their resulting state.',
    },
  ],
} as const satisfies BlockMeta
