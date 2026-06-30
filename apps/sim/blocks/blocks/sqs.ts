import { getErrorMessage } from '@sim/utils/errors'
import { SQSIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { SqsResponse } from '@/tools/sqs/types'

export const SQSBlock: BlockConfig<SqsResponse> = {
  type: 'sqs',
  name: 'Amazon SQS',
  description: 'Connect to Amazon SQS',
  longDescription: 'Integrate Amazon SQS into the workflow. Can send messages to SQS queues.',
  docsLink: 'https://docs.sim.ai/integrations/sqs',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: 'linear-gradient(45deg, #2E27AD 0%, #527FFF 100%)',
  iconColor: '#527FFF',
  icon: SQSIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [{ label: 'Send Message', id: 'send' }],
      value: () => 'send',
    },
    {
      id: 'region',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      required: true,
    },
    {
      id: 'accessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      password: true,
      required: true,
    },
    {
      id: 'secretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      placeholder: 'Your secret access key',
      password: true,
      required: true,
    },
    {
      id: 'queueUrl',
      title: 'Queue URL',
      type: 'short-input',
      placeholder: 'https://sqs.us-east-1.amazonaws.com/123456789012/my-queue',
      required: true,
    },
    // Data field for send message operation
    {
      id: 'messageGroupId',
      title: 'Message Group ID (optional)',
      type: 'short-input',
      placeholder: '5FAB0F0B-30C6-4427-9407-5634F4A3984A',
      condition: { field: 'operation', value: 'send' },
      required: false,
    },
    {
      id: 'messageDeduplicationId',
      title: 'Message Deduplication ID (optional)',
      type: 'short-input',
      placeholder: '5FAB0F0B-30C6-4427-9407-5634F4A3984A',
      condition: { field: 'operation', value: 'send' },
      required: false,
    },
    {
      id: 'data',
      title: 'Data (JSON)',
      type: 'code',
      placeholder: '{\n  "name": "John Doe",\n  "email": "john@example.com",\n  "active": true\n}',
      condition: { field: 'operation', value: 'send' },
      required: true,
    },
  ],
  tools: {
    access: ['sqs_send'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send':
            return 'sqs_send'
          default:
            throw new Error(`Invalid SQS operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, data, messageGroupId, messageDeduplicationId, ...rest } = params

        // Parse JSON fields
        const parseJson = (value: unknown, fieldName: string) => {
          if (!value) return undefined
          if (typeof value === 'object') return value
          if (typeof value === 'string' && value.trim()) {
            try {
              return JSON.parse(value)
            } catch (parseError) {
              const errorMsg = getErrorMessage(parseError, 'Unknown JSON error')
              throw new Error(`Invalid JSON in ${fieldName}: ${errorMsg}`)
            }
          }
          return undefined
        }

        const parsedData = parseJson(data, 'data')

        // Build connection config
        const connectionConfig = {
          region: rest.region,
          accessKeyId: rest.accessKeyId,
          secretAccessKey: rest.secretAccessKey,
        }

        // Build params object
        const result: Record<string, unknown> = { ...connectionConfig }

        if (rest.queueUrl) result.queueUrl = rest.queueUrl
        if (messageGroupId) result.messageGroupId = messageGroupId
        if (messageDeduplicationId) result.messageDeduplicationId = messageDeduplicationId
        if (parsedData !== undefined) result.data = parsedData

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'SQS operation to perform' },
    region: { type: 'string', description: 'AWS region' },
    accessKeyId: { type: 'string', description: 'AWS access key ID' },
    secretAccessKey: { type: 'string', description: 'AWS secret access key' },
    queueUrl: { type: 'string', description: 'SQS queue URL' },
    messageGroupId: {
      type: 'string',
      description: 'Message group ID (optional)',
    },
    messageDeduplicationId: {
      type: 'string',
      description: 'Message deduplication ID (optional)',
    },
    data: { type: 'json', description: 'Data for send message operation' },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Success or error message describing the operation outcome',
    },
    id: {
      type: 'string',
      description: 'Message ID',
    },
  },
}

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
