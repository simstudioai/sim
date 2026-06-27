import { TriggerDevIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const TriggerDevBlockDisplay = {
  type: 'trigger_dev',
  name: 'Trigger.dev',
  description: 'Trigger tasks and manage runs and schedules',
  category: 'tools',
  bgColor: '#000000',
  icon: TriggerDevIcon,
  longDescription:
    'Integrate Trigger.dev into the workflow. Trigger and batch trigger background tasks, retrieve and control runs (cancel, replay, reschedule, tags, metadata, events, traces), manage cron schedules, environment variables, queues, deployments, and waitpoint tokens, and query run data with TRQL.',
  docsLink: 'https://docs.sim.ai/integrations/trigger_dev',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay

export const TriggerDevBlockMeta = {
  tags: ['automation', 'ci-cd', 'monitoring'],
  url: 'https://trigger.dev',
  templates: [
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev job kickoff',
      prompt:
        'Build a workflow that receives an event from another system, triggers the matching Trigger.dev background task with a JSON payload, and returns the run ID for tracking.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev failed-run monitor',
      prompt:
        'Build a scheduled workflow that lists Trigger.dev runs with status FAILED or CRASHED from the last hour, summarizes the failures per task, and posts a digest to the engineering Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['monitoring', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev auto-retry agent',
      prompt:
        'Create an agent that lists failed Trigger.dev runs, inspects each run error to decide whether the failure looks transient, and replays the runs that are safe to retry.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'devops'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev run-output collector',
      prompt:
        'Build a workflow that triggers a Trigger.dev task, polls Get Run until the run completes, and writes the run output and timing details into a results table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'sync'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev schedule manager',
      prompt:
        'Create an agent that manages Trigger.dev cron schedules per customer — creating a schedule with the customer ID as external ID on signup, and deactivating or deleting it on churn.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'scheduling'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev stuck-run janitor',
      prompt:
        'Build a scheduled workflow that lists Trigger.dev runs still executing past their expected duration, cancels the stuck runs, and posts the canceled run IDs to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['monitoring', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev compute cost reporter',
      prompt:
        'Create a weekly scheduled workflow that uses Trigger.dev Execute Query to aggregate compute cost and duration per task for the past week, and emails a cost report to the team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'devops'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev human approval gate',
      prompt:
        'Build a workflow where a Trigger.dev task waits on a waitpoint token, an approver reviews the request in Slack, and the workflow completes the waitpoint token with the approval decision so the task resumes.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'approvals'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev deploy watchdog',
      prompt:
        'Create a workflow that checks the latest Trigger.dev deployment after each release, and if the deployment failed or new runs start crashing, promotes the previous deployment version and alerts the on-call channel.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'trigger-task-and-wait',
      description:
        'Trigger a Trigger.dev background task with a payload and poll until the run completes, returning its output.',
      content:
        '# Trigger Task and Wait\n\nKick off a Trigger.dev background task and collect its result.\n\n## Steps\n1. Use the Trigger Task operation with the task identifier and a JSON payload. Set an idempotency key when the same event might arrive twice.\n2. Poll the Get Run operation with the returned run ID until the status is COMPLETED, FAILED, CANCELED, CRASHED, or another terminal state.\n3. On COMPLETED, read the run output. On failure states, read the attempts to surface the error message.\n\n## Output\nReturn the run ID, final status, duration, and the run output — or the error details if the run did not complete.',
    },
    {
      name: 'monitor-failed-runs',
      description:
        'List recent failed Trigger.dev runs, group them by task, and produce a failure digest. Use for run health monitoring.',
      content:
        '# Monitor Failed Runs\n\nReview recent Trigger.dev failures and summarize what needs attention.\n\n## Steps\n1. Use the List Runs operation with a status filter of FAILED, CRASHED, SYSTEM_FAILURE and a created-within period (e.g., 1h or 1d).\n2. Group the runs by task identifier and count failures per task.\n3. For the most affected tasks, fetch a representative run with Get Run and pull the attempt error message.\n\n## Output\nReport failures per task with counts, representative error messages, and run IDs. If nothing failed, say so briefly.',
    },
    {
      name: 'replay-transient-failures',
      description:
        'Inspect failed Trigger.dev runs and replay the ones whose errors look transient (timeouts, rate limits, network).',
      content:
        '# Replay Transient Failures\n\nRetry failed Trigger.dev runs that are safe to run again.\n\n## Steps\n1. List runs with status FAILED for the relevant period and task filter.\n2. For each run, use Get Run and inspect the attempt errors. Treat timeouts, rate limits, and network errors as transient; treat validation and logic errors as permanent.\n3. Use the Replay Run operation on transient failures only, and record the new run IDs.\n\n## Output\nList the replayed runs (old run ID to new run ID) and the runs skipped as permanent failures, with the reason for each decision.',
    },
    {
      name: 'human-approval-waitpoint',
      description:
        'Create a Trigger.dev waitpoint token for a task to wait on, then complete it with approval data once a human decides.',
      content:
        '# Human Approval Waitpoint\n\nGate a Trigger.dev task on an external decision using waitpoint tokens.\n\n## Steps\n1. Use Create Waitpoint Token with a timeout (e.g., 1d) and an idempotency key tied to the request, and pass the token ID to the task that should wait.\n2. When the decision arrives, use Complete Waitpoint Token with the token ID and a JSON payload like {"status": "approved"} so the waiting run resumes with that data.\n3. Use Get Waitpoint Token or List Waitpoint Tokens to check for tokens that are still WAITING or have TIMED_OUT.\n\n## Output\nReport the token ID, its status, and the completion data passed to the run. Flag tokens that timed out without a decision.',
    },
    {
      name: 'manage-cron-schedules',
      description:
        'Create, update, activate, deactivate, or delete Trigger.dev cron schedules for a task, scoped by external ID.',
      content:
        '# Manage Cron Schedules\n\nKeep Trigger.dev schedules in sync with the desired cadence.\n\n## Steps\n1. Use List Schedules to find existing schedules for the task, matching on external ID when schedules are per customer or per resource.\n2. Create a schedule with the task identifier, cron expression, timezone, and a deduplication key so reruns do not create duplicates.\n3. Update the cron or timezone on an existing schedule by ID, and use Activate or Deactivate to pause and resume without deleting.\n4. Delete schedules that are no longer needed.\n\n## Output\nReport the schedule ID, task, cron expression, timezone, active state, and next run time after the change.',
    },
  ],
} as const satisfies BlockMeta
