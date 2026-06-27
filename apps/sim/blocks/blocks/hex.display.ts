import { HexIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const HexBlockDisplay = {
  type: 'hex',
  name: 'Hex',
  description: 'Run and manage Hex projects',
  category: 'tools',
  bgColor: '#14151A',
  icon: HexIcon,
  longDescription:
    'Integrate Hex into your workflow. Run projects, check run status, manage collections and groups, list users, and view data connections. Requires a Hex API token.',
  docsLink: 'https://docs.sim.ai/integrations/hex',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay

export const HexBlockMeta = {
  tags: ['data-analytics'],
  url: 'https://hex.tech',
  templates: [
    {
      icon: HexIcon,
      title: 'Hex project notebook runner',
      prompt:
        'Create a scheduled workflow that runs a Hex notebook with parameters every morning, waits for the run to finish, and posts a summary with the published notebook link to a Slack data channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: HexIcon,
      title: 'Hex anomaly digest',
      prompt:
        'Build a workflow that runs a Hex notebook for anomaly detection on key metrics nightly, captures detected anomalies into a table, and pages the on-call data team on Slack for severe deltas.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: HexIcon,
      title: 'Hex executive metrics email',
      prompt:
        'Create a scheduled weekly workflow that runs a Hex executive dashboard notebook, summarizes the run results, and emails a snapshot with the dashboard link to the leadership distribution list every Monday morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'enterprise'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: HexIcon,
      title: 'Hex + Tinybird realtime data app',
      prompt:
        'Create a workflow that powers a Hex data app with Tinybird realtime data, refreshes the dashboard on schedule, and writes usage analytics to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'sync'],
      alsoIntegrations: ['tinybird'],
    },
    {
      icon: HexIcon,
      title: 'Hex + Stripe revenue notebook',
      prompt:
        'Build a scheduled workflow that runs a Hex notebook over Stripe payment data daily, captures MRR, churn, and expansion metrics, and posts a summary with the notebook link to a Slack data channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
      alsoIntegrations: ['stripe', 'slack'],
    },
    {
      icon: HexIcon,
      title: 'Hex + Amplitude product notebook',
      prompt:
        'Create a scheduled workflow that runs a Hex notebook joining Amplitude data with internal sources weekly, captures retention and feature adoption, and emails a summary with the notebook link to the product team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'analysis'],
      alsoIntegrations: ['amplitude', 'gmail'],
    },
    {
      icon: HexIcon,
      title: 'Hex run failure monitor',
      prompt:
        'Build a workflow that lists recent Hex project runs every hour, checks each run status, and when a scheduled notebook fails pulls the error, summarizes the likely cause with an agent, and posts a Slack alert with a link to the run.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'analysis'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'run-project-with-params',
      description: 'Trigger a Hex project run with input parameters and poll until it completes.',
      content:
        '# Run Project With Params\n\nKick off a Hex project and wait for the result.\n\n## Steps\n1. If only a project name is known, list projects to resolve the project ID.\n2. Run the project, passing any input parameters the project expects.\n3. Capture the run ID and poll the run status until it reaches a terminal state (completed, errored, or killed).\n4. If it is still pending after a reasonable timeout, report the current status rather than blocking indefinitely.\n\n## Output\nReturn the run ID, final status, and any output or result link. On error, include the failure reason.',
    },
    {
      name: 'monitor-recent-runs',
      description: 'List recent Hex project runs, check their statuses, and surface failures.',
      content:
        '# Monitor Recent Runs\n\nWatch project runs and flag the ones that failed.\n\n## Steps\n1. List project runs for the relevant project or projects.\n2. Get the run status for each recent run.\n3. Filter to runs that errored or were killed and capture the error detail.\n4. Group successes and failures with timestamps.\n\n## Output\nReturn a summary of recent runs with status and timing, plus a flagged failures section with run IDs, error messages, and links. Suitable for an hourly monitoring digest.',
    },
    {
      name: 'cancel-stuck-run',
      description: 'Find a long-running or stuck Hex run and cancel it.',
      content:
        '# Cancel Stuck Run\n\nStop a run that is hung or no longer needed.\n\n## Steps\n1. List project runs and get the status of in-progress runs.\n2. Identify runs exceeding an expected duration or explicitly targeted for cancellation.\n3. Cancel the run by its run ID.\n4. Re-check the status to confirm cancellation took effect.\n\n## Output\nReturn the cancelled run ID and its confirmed final status. Note any run that could not be cancelled.',
    },
    {
      name: 'inventory-projects',
      description: 'List Hex projects, collections, and data connections to map analytics assets.',
      content:
        '# Inventory Projects\n\nMap what projects and data sources exist in the workspace.\n\n## Steps\n1. List projects and capture IDs, names, and owners.\n2. List collections and get details to see how projects are grouped.\n3. List data connections to map which sources power the projects.\n4. Cross-reference projects to their collections and data connections.\n\n## Output\nReturn an inventory of projects grouped by collection, each annotated with its data connections. Useful for governance and cleanup.',
    },
  ],
} as const satisfies BlockMeta
