import { TemporalIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const TemporalBlockDisplay = {
  type: 'temporal',
  name: 'Temporal',
  description: 'Start, signal, query, and manage Temporal workflow executions',
  category: 'tools',
  bgColor: '#141414',
  icon: TemporalIcon,
  longDescription:
    "Connect to a Temporal cluster over the server's HTTP API to start workflow executions, send signals, run queries against workflow state, describe and list executions, fetch event histories, and cancel or terminate running workflows. API key only required for servers with authentication enabled.",
  docsLink: 'https://docs.sim.ai/integrations/temporal',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay

export const TemporalBlockMeta = {
  tags: ['automation'],
  url: 'https://temporal.io',
  templates: [
    {
      icon: TemporalIcon,
      title: 'Temporal order approval gate',
      prompt:
        'Create a workflow that receives an approval decision from a form, signals the matching Temporal order workflow with the decision, and posts a confirmation to Slack with the workflow ID and current status.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'approvals'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TemporalIcon,
      title: 'Temporal failed workflow digest',
      prompt:
        'Build a scheduled daily workflow that lists Temporal executions that failed or timed out in the last 24 hours, pulls the close event from each history to extract the failure, and posts a digest to Slack grouped by workflow type.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TemporalIcon,
      title: 'Temporal stuck workflow watcher',
      prompt:
        'Create a scheduled workflow that lists running Temporal executions, describes each one to inspect pending activities, flags workflows whose activities are retrying with high attempt counts, and opens a Linear ticket with the failure details.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: TemporalIcon,
      title: 'Temporal kickoff from intake form',
      prompt:
        'Build a workflow that starts a Temporal workflow execution with input assembled from an intake form submission, polls describe until the execution closes, and writes the final status and timing to a tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: TemporalIcon,
      title: 'Temporal status lookup agent',
      prompt:
        'Create an agent that answers "where is my order" questions by querying the matching Temporal workflow for its current state and summarizing the progress, falling back to the latest history events when no query handler responds.',
      modules: ['agent'],
      category: 'support',
      tags: ['customer-support'],
    },
    {
      icon: TemporalIcon,
      title: 'Temporal runaway workflow janitor',
      prompt:
        'Build a scheduled weekly workflow that lists Temporal executions running longer than seven days, describes each to confirm it is stalled, requests cancellation with a recorded reason, and terminates any execution that ignores the cancellation after a grace period.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: TemporalIcon,
      title: 'Temporal incident escalation bridge',
      prompt:
        'Create a workflow that signals a Temporal incident-response workflow with escalation details when a monitoring alert fires, using signal-with-start so a new incident workflow is created if one is not already running.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['incident-management', 'automation'],
      alsoIntegrations: ['pagerduty'],
    },
  ],
  skills: [
    {
      name: 'start-workflow-execution',
      description:
        'Start a Temporal workflow execution with the right input and report the workflow and run IDs.',
      content:
        '# Start a Temporal Workflow\n\nKick off a workflow execution on the cluster.\n\n## Steps\n1. Confirm the workflow type, task queue, and a unique workflow ID.\n2. Assemble the JSON input arguments for the workflow.\n3. Start the workflow and capture the run ID.\n4. Describe the execution to confirm it is running.\n\n## Output\nA confirmation with the workflow ID, run ID, and initial status.',
    },
    {
      name: 'investigate-failed-workflow',
      description:
        'Describe a failed Temporal workflow and pull its close event to explain why it failed.',
      content:
        '# Investigate a Failed Temporal Workflow\n\nDiagnose a workflow failure.\n\n## Steps\n1. Describe the workflow to confirm its status and timing.\n2. Fetch the history filtered to the close event to get the failure details.\n3. If needed, fetch earlier history pages to trace the failing activity.\n4. Summarize the root cause.\n\n## Output\nA failure summary with the failing event, error message, and a recommendation.',
    },
    {
      name: 'signal-running-workflow',
      description: 'Send a signal to a running Temporal workflow and confirm it was delivered.',
      content:
        '# Signal a Temporal Workflow\n\nDeliver data or a decision to a running execution.\n\n## Steps\n1. Find the target execution by workflow ID (or list executions to locate it).\n2. Send the signal with the JSON payload.\n3. Query or describe the workflow to confirm the signal took effect.\n\n## Output\nA confirmation with the workflow ID, signal name, and resulting state.',
    },
    {
      name: 'audit-running-workflows',
      description: 'List running Temporal executions and surface long-running or stuck workflows.',
      content:
        '# Audit Running Temporal Workflows\n\nFind executions that need attention.\n\n## Steps\n1. List executions filtered to ExecutionStatus = "Running".\n2. Sort by start time and flag the longest-running executions.\n3. Describe flagged executions to inspect pending activities and retry counts.\n4. Recommend cancellation or escalation for stuck workflows.\n\n## Output\nA per-workflow report with age, pending activities, and a recommended action.',
    },
  ],
} as const satisfies BlockMeta
