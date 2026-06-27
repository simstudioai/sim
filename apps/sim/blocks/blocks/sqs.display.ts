import { SQSIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const SQSBlockDisplay = {
  type: 'sqs',
  name: 'Amazon SQS',
  description: 'Connect to Amazon SQS',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #2E27AD 0%, #527FFF 100%)',
  icon: SQSIcon,
  iconColor: '#527FFF',
  longDescription: 'Integrate Amazon SQS into the workflow. Can send messages to SQS queues.',
  docsLink: 'https://docs.sim.ai/integrations/sqs',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay

export const SQSBlockMeta = {
  tags: ['cloud', 'messaging', 'automation'],
  url: 'https://aws.amazon.com/sqs',
  templates: [
    {
      icon: SQSIcon,
      title: 'SQS event dispatcher',
      prompt:
        'Build a workflow that runs after a customer event is processed, formats a structured message, and pushes it onto an Amazon SQS queue so downstream worker services can pick it up. Log every dispatched event into a table for audit and replay.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
    },
    {
      icon: SQSIcon,
      title: 'Dead-letter queue replayer',
      prompt:
        'Create a scheduled workflow that runs every morning, scans a table of failed jobs, regenerates the original payload, and republishes each failed message to its Amazon SQS queue with retry metadata so transient failures are recovered automatically.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
    },
    {
      icon: SQSIcon,
      title: 'Webhook to SQS bridge',
      prompt:
        'Build a workflow exposed as a webhook endpoint that accepts inbound events from third-party services, validates the payload against a schema, transforms it into your internal event format, sends it to Amazon SQS for asynchronous processing, and returns an acknowledgement to the caller.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
    },
    {
      icon: SQSIcon,
      title: 'Alert fan-out queue',
      prompt:
        'Create a workflow triggered by PagerDuty or Datadog alerts that classifies severity, decorates the payload with runbook context, and pushes the enriched alert to an Amazon SQS queue so multiple downstream notifiers and ticketing systems can consume it independently.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'automation'],
      alsoIntegrations: ['pagerduty', 'datadog'],
    },
    {
      icon: SQSIcon,
      title: 'Batch order processor',
      prompt:
        'Build a workflow that takes a list of orders from a table and queues each one as a separate Amazon SQS message for parallel downstream processing. Track each enqueued message ID in the table so you can correlate downstream results back to the originating row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'ecommerce', 'automation'],
    },
    {
      icon: SQSIcon,
      title: 'Scheduled fan-out job',
      prompt:
        'Create a scheduled workflow that runs every fifteen minutes, queries pending items from a table, batches them, and pushes one Amazon SQS message per batch to your worker queue. Update the table with batch IDs and timestamps so reprocessing is deterministic.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
    },
    {
      icon: SQSIcon,
      title: 'Cross-service notifier',
      prompt:
        'Build a workflow that listens for completed builds in your CI tool, composes a status payload with build metadata and artifact links, and sends the payload to an Amazon SQS queue so internal services like deploy, audit, and notification workers can react asynchronously.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
    },
  ],
  skills: [
    {
      name: 'enqueue-job-message',
      description:
        'Send a structured job message to an Amazon SQS queue to hand off background work.',
      content:
        '# Enqueue Job Message\n\nPublish a task onto an SQS queue for a worker to process asynchronously.\n\n## Steps\n1. Identify the target queue URL.\n2. Build the message body as JSON describing the job (type, payload, identifiers).\n3. For a FIFO queue, set the message group and deduplication IDs.\n4. Send the message.\n\n## Output\nConfirm the message was sent with its message ID and the queue it was placed on.',
    },
    {
      name: 'send-ordered-fifo-message',
      description:
        'Send a message to an Amazon SQS FIFO queue with a message group ID and deduplication ID for ordered, exactly-once delivery.',
      content:
        '# Send Ordered FIFO Message\n\nDispatch a message to a FIFO queue when ordering within a stream and de-duplication matter.\n\n## Steps\n1. Identify the FIFO queue URL.\n2. Build the JSON message body.\n3. Set the message group ID so messages in the same group stay ordered, and set a deduplication ID to prevent duplicate sends.\n4. Send the message.\n\n## Output\nConfirm the message was sent with its message ID, group ID, and the queue it was placed on.',
    },
  ],
} as const satisfies BlockMeta
