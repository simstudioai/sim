import { getErrorMessage } from '@sim/utils/errors'
import { SQSIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { SqsResponse } from '@/tools/sqs/types'

export const SQSBlock: BlockConfig<SqsResponse> = {
  type: 'sqs',
  name: 'Amazon SQS',
  description: 'Connect to Amazon SQS',
  longDescription:
    'Integrate Amazon SQS into the workflow. Send and receive messages one at a time or in batches of ten, delete messages, extend visibility timeouts, manage queues along with their attributes and tags, and redrive messages out of a dead-letter queue.',
  docsLink: 'https://docs.sim.ai/integrations/sqs',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: 'linear-gradient(45deg, #2E27AD 0%, #527FFF 100%)',
  iconColor: '#527FFF',
  icon: SQSIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Amazon SQS',
    sentences: {
      byOperation: {
        send: [
          { text: 'Send', field: 'data', core: true },
          { text: 'to queue', field: 'queueUrl', core: true },
        ],
        send_message_batch: [
          { text: 'Send', field: 'sendEntries', core: true },
          { text: 'to queue', field: 'queueUrl', core: true },
        ],
        receive_message: [
          { text: 'Receive messages from queue', field: 'queueUrl', core: true },
          { text: ', up to', field: 'maxNumberOfMessages' },
        ],
        delete_message: [
          { text: 'Delete', field: 'receiptHandle', core: true },
          { text: 'from queue', field: 'queueUrl', core: true },
        ],
        delete_message_batch: [
          { text: 'Delete a batch of received messages from queue', field: 'queueUrl', core: true },
        ],
        change_message_visibility: [
          { text: 'Hide', field: 'receiptHandle', core: true },
          { text: 'for', field: 'visibilityTimeout', core: true, after: 'seconds' },
          { text: ', on queue', field: 'queueUrl' },
        ],
        change_message_visibility_batch: [
          {
            text: 'Change the visibility of a batch of received messages on queue',
            field: 'queueUrl',
            core: true,
          },
        ],
        list_queues: [
          'List queues',
          { text: ', named starting with', field: 'queueNamePrefix' },
          { text: ', up to', field: 'maxResults' },
        ],
        get_queue_url: [{ text: 'Look up the URL of queue', field: 'queueName', core: true }],
        get_queue_attributes: [
          { text: 'Read the attributes of queue', field: 'queueUrl', core: true },
        ],
        set_queue_attributes: [
          { text: 'Update the attributes of queue', field: 'queueUrl', core: true },
        ],
        create_queue: [{ text: 'Create queue', field: 'queueName', core: true }],
        delete_queue: [{ text: 'Delete queue', field: 'queueUrl', core: true }],
        purge_queue: [{ text: 'Delete every message in queue', field: 'queueUrl', core: true }],
        list_dead_letter_source_queues: [
          {
            text: 'List the queues that redrive to dead-letter queue',
            field: 'queueUrl',
            core: true,
          },
        ],
        list_queue_tags: [{ text: 'List the tags on queue', field: 'queueUrl', core: true }],
        tag_queue: [
          { text: 'Tag queue', field: 'queueUrl', core: true },
          { text: 'with', field: 'queueTags', core: true },
        ],
        untag_queue: [
          { text: 'Remove', field: 'tagKeys', core: true },
          { text: 'from queue', field: 'queueUrl', core: true },
        ],
        start_message_move_task: [
          { text: 'Redrive the messages held in', field: 'sourceArn', core: true },
          { text: ', delivering them to', field: 'destinationArn' },
        ],
        list_message_move_tasks: [
          { text: 'List the message move tasks for', field: 'sourceArn', core: true },
        ],
        cancel_message_move_task: [
          { text: 'Cancel message move task', field: 'taskHandle', core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Message', id: 'send' },
        { label: 'Send Message Batch', id: 'send_message_batch' },
        { label: 'Receive Message', id: 'receive_message' },
        { label: 'Delete Message', id: 'delete_message' },
        { label: 'Delete Message Batch', id: 'delete_message_batch' },
        { label: 'Change Message Visibility', id: 'change_message_visibility' },
        { label: 'Change Message Visibility Batch', id: 'change_message_visibility_batch' },
        { label: 'List Queues', id: 'list_queues' },
        { label: 'Get Queue URL', id: 'get_queue_url' },
        { label: 'Get Queue Attributes', id: 'get_queue_attributes' },
        { label: 'Set Queue Attributes', id: 'set_queue_attributes' },
        { label: 'Create Queue', id: 'create_queue' },
        { label: 'Delete Queue', id: 'delete_queue' },
        { label: 'Purge Queue', id: 'purge_queue' },
        { label: 'List Dead-Letter Source Queues', id: 'list_dead_letter_source_queues' },
        { label: 'List Queue Tags', id: 'list_queue_tags' },
        { label: 'Tag Queue', id: 'tag_queue' },
        { label: 'Untag Queue', id: 'untag_queue' },
        { label: 'Start Message Move Task', id: 'start_message_move_task' },
        { label: 'List Message Move Tasks', id: 'list_message_move_tasks' },
        { label: 'Cancel Message Move Task', id: 'cancel_message_move_task' },
      ],
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
      condition: {
        field: 'operation',
        value: [
          'send',
          'send_message_batch',
          'receive_message',
          'delete_message',
          'delete_message_batch',
          'change_message_visibility',
          'change_message_visibility_batch',
          'get_queue_attributes',
          'set_queue_attributes',
          'delete_queue',
          'purge_queue',
          'list_dead_letter_source_queues',
          'list_queue_tags',
          'tag_queue',
          'untag_queue',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'send',
          'send_message_batch',
          'receive_message',
          'delete_message',
          'delete_message_batch',
          'change_message_visibility',
          'change_message_visibility_batch',
          'get_queue_attributes',
          'set_queue_attributes',
          'delete_queue',
          'purge_queue',
          'list_dead_letter_source_queues',
          'list_queue_tags',
          'tag_queue',
          'untag_queue',
        ],
      },
    },
    {
      id: 'queueName',
      title: 'Queue Name',
      type: 'short-input',
      placeholder: 'my-queue (a FIFO queue name ends in .fifo)',
      condition: { field: 'operation', value: ['create_queue', 'get_queue_url'] },
      required: { field: 'operation', value: ['create_queue', 'get_queue_url'] },
    },
    {
      id: 'queueOwnerAwsAccountId',
      title: 'Queue Owner AWS Account ID',
      type: 'short-input',
      placeholder: '123456789012',
      condition: { field: 'operation', value: 'get_queue_url' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'data',
      title: 'Data (JSON)',
      canvasNoun: 'a message body',
      type: 'code',
      placeholder: '{\n  "name": "John Doe",\n  "email": "john@example.com",\n  "active": true\n}',
      condition: { field: 'operation', value: 'send' },
      required: { field: 'operation', value: 'send' },
    },
    {
      id: 'messageGroupId',
      title: 'Message Group ID',
      type: 'short-input',
      placeholder: '5FAB0F0B-30C6-4427-9407-5634F4A3984A',
      condition: { field: 'operation', value: 'send' },
      required: false,
    },
    {
      id: 'messageDeduplicationId',
      title: 'Message Deduplication ID',
      type: 'short-input',
      placeholder: '5FAB0F0B-30C6-4427-9407-5634F4A3984A',
      condition: { field: 'operation', value: 'send' },
      required: false,
    },
    {
      id: 'delaySeconds',
      title: 'Delay Seconds',
      type: 'short-input',
      placeholder: '0-900',
      condition: { field: 'operation', value: 'send' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'messageAttributes',
      title: 'Message Attributes',
      type: 'code',
      placeholder: '{\n  "priority": { "dataType": "Number", "stringValue": "1" }\n}',
      condition: { field: 'operation', value: 'send' },
      required: false,
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an SQS message attribute map as JSON. Each key is the attribute name and each value is an object with "dataType" (String or Number, optionally with a custom label such as Number.float) and "stringValue". Binary attributes are not supported. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'sendEntries',
      title: 'Message Entries',
      canvasNoun: 'a batch of messages',
      type: 'code',
      placeholder:
        '[\n  { "id": "msg-1", "data": { "orderId": 1 } },\n  { "id": "msg-2", "data": { "orderId": 2 } }\n]',
      condition: { field: 'operation', value: 'send_message_batch' },
      required: { field: 'operation', value: 'send_message_batch' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an array of at most 10 Amazon SQS batch send entries. Each entry is an object with a unique "id" (letters, digits, hyphens, underscores) and a "data" JSON object holding the message body. Optional per-entry keys are delaySeconds, messageGroupId, messageDeduplicationId, and messageAttributes. Return ONLY the JSON array.',
        generationType: 'json-array',
      },
    },
    {
      id: 'receiptHandle',
      title: 'Receipt Handle',
      canvasNoun: 'a received message',
      type: 'short-input',
      placeholder: 'Receipt handle returned by Receive Message',
      condition: { field: 'operation', value: ['delete_message', 'change_message_visibility'] },
      required: { field: 'operation', value: ['delete_message', 'change_message_visibility'] },
    },
    {
      id: 'visibilityTimeout',
      title: 'Visibility Timeout',
      canvasNoun: 'a timeout',
      type: 'short-input',
      placeholder: '0-43200 seconds',
      condition: { field: 'operation', value: 'change_message_visibility' },
      required: { field: 'operation', value: 'change_message_visibility' },
    },
    {
      id: 'deleteEntries',
      title: 'Delete Entries',
      type: 'code',
      placeholder:
        '[\n  { "id": "msg-1", "receiptHandle": "AQEB..." },\n  { "id": "msg-2", "receiptHandle": "AQEB..." }\n]',
      condition: { field: 'operation', value: 'delete_message_batch' },
      required: { field: 'operation', value: 'delete_message_batch' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an array of at most 10 Amazon SQS delete-message batch entries. Each entry is an object with a unique "id" and the "receiptHandle" of a received message. Return ONLY the JSON array.',
        generationType: 'json-array',
      },
    },
    {
      id: 'visibilityEntries',
      title: 'Visibility Entries',
      type: 'code',
      placeholder:
        '[\n  { "id": "msg-1", "receiptHandle": "AQEB...", "visibilityTimeout": 120 }\n]',
      condition: { field: 'operation', value: 'change_message_visibility_batch' },
      required: { field: 'operation', value: 'change_message_visibility_batch' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an array of at most 10 Amazon SQS change-message-visibility batch entries. Each entry is an object with a unique "id", the "receiptHandle" of a received message, and an optional "visibilityTimeout" in seconds between 0 and 43200. Return ONLY the JSON array.',
        generationType: 'json-array',
      },
    },
    {
      id: 'maxNumberOfMessages',
      title: 'Max Messages',
      type: 'short-input',
      placeholder: '1-10 (default 1)',
      condition: { field: 'operation', value: 'receive_message' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'waitTimeSeconds',
      title: 'Wait Time (Long Poll)',
      type: 'short-input',
      placeholder: '0-20 seconds (default 0)',
      condition: { field: 'operation', value: 'receive_message' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'receiveVisibilityTimeout',
      title: 'Visibility Timeout',
      type: 'short-input',
      placeholder: '0-43200 seconds (defaults to the queue setting)',
      condition: { field: 'operation', value: 'receive_message' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'messageAttributeNames',
      title: 'Message Attribute Names',
      type: 'code',
      placeholder: '["All"]',
      condition: { field: 'operation', value: 'receive_message' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'messageSystemAttributeNames',
      title: 'Message System Attribute Names',
      type: 'code',
      placeholder: '["SentTimestamp", "ApproximateReceiveCount"]',
      condition: { field: 'operation', value: 'receive_message' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'receiveRequestAttemptId',
      title: 'Receive Request Attempt ID',
      type: 'short-input',
      placeholder: 'FIFO deduplication token for a retried receive',
      condition: { field: 'operation', value: 'receive_message' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'queueNamePrefix',
      title: 'Queue Name Prefix',
      type: 'short-input',
      placeholder: 'orders-',
      condition: { field: 'operation', value: 'list_queues' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '1-1000 (set it to receive a next token)',
      condition: {
        field: 'operation',
        value: ['list_queues', 'list_dead_letter_source_queues'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'nextToken',
      title: 'Next Token',
      type: 'short-input',
      placeholder: 'Pagination token from a previous run',
      condition: {
        field: 'operation',
        value: ['list_queues', 'list_dead_letter_source_queues'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'attributeNames',
      title: 'Attribute Names',
      type: 'code',
      placeholder: '["All"]',
      condition: { field: 'operation', value: 'get_queue_attributes' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'queueAttributes',
      title: 'Queue Attributes',
      type: 'code',
      placeholder: '{\n  "VisibilityTimeout": "60",\n  "MessageRetentionPeriod": "345600"\n}',
      condition: { field: 'operation', value: 'set_queue_attributes' },
      required: { field: 'operation', value: 'set_queue_attributes' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Amazon SQS queue attribute map as JSON. Keys are documented queue attribute names such as VisibilityTimeout, DelaySeconds, MessageRetentionPeriod, MaximumMessageSize, ReceiveMessageWaitTimeSeconds, RedrivePolicy, RedriveAllowPolicy, Policy, KmsMasterKeyId, KmsDataKeyReusePeriodSeconds, SqsManagedSseEnabled, or ContentBasedDeduplication. Every value must be a string. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'createQueueAttributes',
      title: 'Queue Attributes',
      type: 'code',
      placeholder: '{\n  "FifoQueue": "true",\n  "VisibilityTimeout": "30"\n}',
      condition: { field: 'operation', value: 'create_queue' },
      required: false,
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Amazon SQS queue attribute map as JSON for a new queue. Keys are documented queue attribute names such as FifoQueue, ContentBasedDeduplication, VisibilityTimeout, DelaySeconds, MessageRetentionPeriod, MaximumMessageSize, ReceiveMessageWaitTimeSeconds, RedrivePolicy, or SqsManagedSseEnabled. Every value must be a string. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'createQueueTags',
      title: 'Tags',
      type: 'code',
      placeholder: '{\n  "env": "prod",\n  "team": "payments"\n}',
      condition: { field: 'operation', value: 'create_queue' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'queueTags',
      title: 'Tags',
      canvasNoun: 'tags',
      type: 'code',
      placeholder: '{\n  "env": "prod",\n  "team": "payments"\n}',
      condition: { field: 'operation', value: 'tag_queue' },
      required: { field: 'operation', value: 'tag_queue' },
    },
    {
      id: 'tagKeys',
      title: 'Tag Keys',
      canvasNoun: 'tags',
      type: 'code',
      placeholder: '["env", "team"]',
      condition: { field: 'operation', value: 'untag_queue' },
      required: { field: 'operation', value: 'untag_queue' },
    },
    {
      id: 'sourceArn',
      title: 'Source Queue ARN',
      canvasNoun: 'a dead-letter queue',
      type: 'short-input',
      placeholder: 'arn:aws:sqs:us-east-1:123456789012:my-dlq',
      condition: {
        field: 'operation',
        value: ['start_message_move_task', 'list_message_move_tasks'],
      },
      required: {
        field: 'operation',
        value: ['start_message_move_task', 'list_message_move_tasks'],
      },
    },
    {
      id: 'destinationArn',
      title: 'Destination Queue ARN',
      type: 'short-input',
      placeholder: 'Leave empty to redrive to each original source queue',
      condition: { field: 'operation', value: 'start_message_move_task' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'maxNumberOfMessagesPerSecond',
      title: 'Max Messages Per Second',
      type: 'short-input',
      placeholder: '1-500 (empty moves as fast as possible)',
      condition: { field: 'operation', value: 'start_message_move_task' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'moveTaskMaxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '1-10 (default 1)',
      condition: { field: 'operation', value: 'list_message_move_tasks' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'taskHandle',
      title: 'Task Handle',
      type: 'short-input',
      placeholder: 'Task handle returned by Start Message Move Task',
      condition: { field: 'operation', value: 'cancel_message_move_task' },
      required: { field: 'operation', value: 'cancel_message_move_task' },
    },
  ],
  tools: {
    access: [
      'sqs_send',
      'sqs_send_message_batch',
      'sqs_receive_message',
      'sqs_delete_message',
      'sqs_delete_message_batch',
      'sqs_change_message_visibility',
      'sqs_change_message_visibility_batch',
      'sqs_list_queues',
      'sqs_get_queue_url',
      'sqs_get_queue_attributes',
      'sqs_set_queue_attributes',
      'sqs_create_queue',
      'sqs_delete_queue',
      'sqs_purge_queue',
      'sqs_list_dead_letter_source_queues',
      'sqs_list_queue_tags',
      'sqs_tag_queue',
      'sqs_untag_queue',
      'sqs_start_message_move_task',
      'sqs_list_message_move_tasks',
      'sqs_cancel_message_move_task',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send':
            return 'sqs_send'
          case 'send_message_batch':
            return 'sqs_send_message_batch'
          case 'receive_message':
            return 'sqs_receive_message'
          case 'delete_message':
            return 'sqs_delete_message'
          case 'delete_message_batch':
            return 'sqs_delete_message_batch'
          case 'change_message_visibility':
            return 'sqs_change_message_visibility'
          case 'change_message_visibility_batch':
            return 'sqs_change_message_visibility_batch'
          case 'list_queues':
            return 'sqs_list_queues'
          case 'get_queue_url':
            return 'sqs_get_queue_url'
          case 'get_queue_attributes':
            return 'sqs_get_queue_attributes'
          case 'set_queue_attributes':
            return 'sqs_set_queue_attributes'
          case 'create_queue':
            return 'sqs_create_queue'
          case 'delete_queue':
            return 'sqs_delete_queue'
          case 'purge_queue':
            return 'sqs_purge_queue'
          case 'list_dead_letter_source_queues':
            return 'sqs_list_dead_letter_source_queues'
          case 'list_queue_tags':
            return 'sqs_list_queue_tags'
          case 'tag_queue':
            return 'sqs_tag_queue'
          case 'untag_queue':
            return 'sqs_untag_queue'
          case 'start_message_move_task':
            return 'sqs_start_message_move_task'
          case 'list_message_move_tasks':
            return 'sqs_list_message_move_tasks'
          case 'cancel_message_move_task':
            return 'sqs_cancel_message_move_task'
          default:
            throw new Error(`Invalid SQS operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, ...rest } = params

        const parseJson = (value: unknown, fieldName: string) => {
          if (value === undefined || value === null || value === '') return undefined
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

        /**
         * `Number.parseInt` stops at the first non-digit, so `1.5` and `10abc`
         * would forward `1` and `10` — a different setting than the one typed.
         * `Number` rejects both by producing a non-integer or `NaN`.
         */
        const parseInteger = (value: unknown, fieldName: string) => {
          if (value === undefined || value === null || value === '') return undefined
          const text = String(value).trim()
          if (!text) return undefined
          const parsed = Number(text)
          if (!Number.isInteger(parsed)) {
            throw new Error(`${fieldName} must be a whole number`)
          }
          return parsed
        }

        const result: Record<string, unknown> = {
          region: rest.region,
          accessKeyId: rest.accessKeyId,
          secretAccessKey: rest.secretAccessKey,
        }

        switch (operation) {
          case 'send': {
            result.queueUrl = rest.queueUrl
            const data = parseJson(rest.data, 'data')
            if (data !== undefined) result.data = data
            const delaySeconds = parseInteger(rest.delaySeconds, 'delaySeconds')
            if (delaySeconds !== undefined) result.delaySeconds = delaySeconds
            const messageAttributes = parseJson(rest.messageAttributes, 'messageAttributes')
            if (messageAttributes !== undefined) result.messageAttributes = messageAttributes
            if (rest.messageGroupId) result.messageGroupId = rest.messageGroupId
            if (rest.messageDeduplicationId) {
              result.messageDeduplicationId = rest.messageDeduplicationId
            }
            break
          }
          case 'send_message_batch': {
            result.queueUrl = rest.queueUrl
            const entries = parseJson(rest.sendEntries, 'entries')
            if (entries !== undefined) result.entries = entries
            break
          }
          case 'receive_message': {
            result.queueUrl = rest.queueUrl
            const maxNumberOfMessages = parseInteger(
              rest.maxNumberOfMessages,
              'maxNumberOfMessages'
            )
            if (maxNumberOfMessages !== undefined) result.maxNumberOfMessages = maxNumberOfMessages
            const waitTimeSeconds = parseInteger(rest.waitTimeSeconds, 'waitTimeSeconds')
            if (waitTimeSeconds !== undefined) result.waitTimeSeconds = waitTimeSeconds
            const visibilityTimeout = parseInteger(
              rest.receiveVisibilityTimeout,
              'visibilityTimeout'
            )
            if (visibilityTimeout !== undefined) result.visibilityTimeout = visibilityTimeout
            const messageAttributeNames = parseJson(
              rest.messageAttributeNames,
              'messageAttributeNames'
            )
            if (messageAttributeNames !== undefined) {
              result.messageAttributeNames = messageAttributeNames
            }
            const messageSystemAttributeNames = parseJson(
              rest.messageSystemAttributeNames,
              'messageSystemAttributeNames'
            )
            if (messageSystemAttributeNames !== undefined) {
              result.messageSystemAttributeNames = messageSystemAttributeNames
            }
            if (rest.receiveRequestAttemptId) {
              result.receiveRequestAttemptId = rest.receiveRequestAttemptId
            }
            break
          }
          case 'delete_message': {
            result.queueUrl = rest.queueUrl
            result.receiptHandle = rest.receiptHandle
            break
          }
          case 'delete_message_batch': {
            result.queueUrl = rest.queueUrl
            const entries = parseJson(rest.deleteEntries, 'entries')
            if (entries !== undefined) result.entries = entries
            break
          }
          case 'change_message_visibility': {
            result.queueUrl = rest.queueUrl
            result.receiptHandle = rest.receiptHandle
            const visibilityTimeout = parseInteger(rest.visibilityTimeout, 'visibilityTimeout')
            if (visibilityTimeout !== undefined) result.visibilityTimeout = visibilityTimeout
            break
          }
          case 'change_message_visibility_batch': {
            result.queueUrl = rest.queueUrl
            const entries = parseJson(rest.visibilityEntries, 'entries')
            if (entries !== undefined) result.entries = entries
            break
          }
          case 'list_queues': {
            if (rest.queueNamePrefix) result.queueNamePrefix = rest.queueNamePrefix
            const maxResults = parseInteger(rest.maxResults, 'maxResults')
            if (maxResults !== undefined) result.maxResults = maxResults
            if (rest.nextToken) result.nextToken = rest.nextToken
            break
          }
          case 'get_queue_url': {
            result.queueName = rest.queueName
            if (rest.queueOwnerAwsAccountId) {
              result.queueOwnerAwsAccountId = rest.queueOwnerAwsAccountId
            }
            break
          }
          case 'get_queue_attributes': {
            result.queueUrl = rest.queueUrl
            const attributeNames = parseJson(rest.attributeNames, 'attributeNames')
            if (attributeNames !== undefined) result.attributeNames = attributeNames
            break
          }
          case 'set_queue_attributes': {
            result.queueUrl = rest.queueUrl
            const attributes = parseJson(rest.queueAttributes, 'attributes')
            if (attributes !== undefined) result.attributes = attributes
            break
          }
          case 'create_queue': {
            result.queueName = rest.queueName
            const attributes = parseJson(rest.createQueueAttributes, 'attributes')
            if (attributes !== undefined) result.attributes = attributes
            const tags = parseJson(rest.createQueueTags, 'tags')
            if (tags !== undefined) result.tags = tags
            break
          }
          case 'delete_queue':
          case 'purge_queue':
          case 'list_queue_tags': {
            result.queueUrl = rest.queueUrl
            break
          }
          case 'list_dead_letter_source_queues': {
            result.queueUrl = rest.queueUrl
            const maxResults = parseInteger(rest.maxResults, 'maxResults')
            if (maxResults !== undefined) result.maxResults = maxResults
            if (rest.nextToken) result.nextToken = rest.nextToken
            break
          }
          case 'tag_queue': {
            result.queueUrl = rest.queueUrl
            const tags = parseJson(rest.queueTags, 'tags')
            if (tags !== undefined) result.tags = tags
            break
          }
          case 'untag_queue': {
            result.queueUrl = rest.queueUrl
            const tagKeys = parseJson(rest.tagKeys, 'tagKeys')
            if (tagKeys !== undefined) result.tagKeys = tagKeys
            break
          }
          case 'start_message_move_task': {
            result.sourceArn = rest.sourceArn
            if (rest.destinationArn) result.destinationArn = rest.destinationArn
            const maxPerSecond = parseInteger(
              rest.maxNumberOfMessagesPerSecond,
              'maxNumberOfMessagesPerSecond'
            )
            if (maxPerSecond !== undefined) result.maxNumberOfMessagesPerSecond = maxPerSecond
            break
          }
          case 'list_message_move_tasks': {
            result.sourceArn = rest.sourceArn
            const maxResults = parseInteger(rest.moveTaskMaxResults, 'maxResults')
            if (maxResults !== undefined) result.maxResults = maxResults
            break
          }
          case 'cancel_message_move_task': {
            result.taskHandle = rest.taskHandle
            break
          }
        }

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
    queueName: { type: 'string', description: 'SQS queue name' },
    queueOwnerAwsAccountId: {
      type: 'string',
      description: '12-digit AWS account ID of the queue owner',
    },
    data: { type: 'json', description: 'Message body to send, as a JSON object' },
    messageGroupId: { type: 'string', description: 'Message group ID for FIFO queues' },
    messageDeduplicationId: {
      type: 'string',
      description: 'Message deduplication ID for FIFO queues',
    },
    delaySeconds: { type: 'number', description: 'Seconds to delay delivery of the message' },
    messageAttributes: {
      type: 'json',
      description: 'Message attributes keyed by name, each with dataType and stringValue',
    },
    sendEntries: {
      type: 'json',
      description: 'Batch send entries, each with id, data, and optional per-message settings',
    },
    receiptHandle: { type: 'string', description: 'Receipt handle of a received message' },
    visibilityTimeout: {
      type: 'number',
      description: 'New visibility timeout in seconds for a received message',
    },
    deleteEntries: {
      type: 'json',
      description: 'Batch delete entries, each with id and receiptHandle',
    },
    visibilityEntries: {
      type: 'json',
      description:
        'Batch visibility entries, each with id, receiptHandle, and an optional visibilityTimeout',
    },
    maxNumberOfMessages: { type: 'number', description: 'Maximum messages to receive (1-10)' },
    waitTimeSeconds: { type: 'number', description: 'Long-poll wait time in seconds (0-20)' },
    receiveVisibilityTimeout: {
      type: 'number',
      description: 'Visibility timeout applied to the received messages',
    },
    messageAttributeNames: {
      type: 'json',
      description: 'Names of user-defined message attributes to return',
    },
    messageSystemAttributeNames: {
      type: 'json',
      description: 'System attribute names to return with each message',
    },
    receiveRequestAttemptId: {
      type: 'string',
      description: 'FIFO deduplication token for a retried receive',
    },
    queueNamePrefix: {
      type: 'string',
      description: 'Return only queues whose name starts with this',
    },
    maxResults: { type: 'number', description: 'Maximum results to return (1-1000)' },
    nextToken: { type: 'string', description: 'Pagination token from a previous request' },
    attributeNames: { type: 'json', description: 'Queue attribute names to read' },
    queueAttributes: { type: 'json', description: 'Queue attributes to set, as string values' },
    createQueueAttributes: {
      type: 'json',
      description: 'Queue attributes for the new queue, as string values',
    },
    createQueueTags: { type: 'json', description: 'Tags to apply to the new queue' },
    queueTags: { type: 'json', description: 'Tags to apply to the queue' },
    tagKeys: { type: 'json', description: 'Tag keys to remove, as an array of strings' },
    sourceArn: { type: 'string', description: 'ARN of the source queue for a message move task' },
    destinationArn: {
      type: 'string',
      description: 'ARN of the destination queue for a message move task',
    },
    maxNumberOfMessagesPerSecond: {
      type: 'number',
      description: 'Throttle for a message move task, up to 500 messages per second',
    },
    moveTaskMaxResults: { type: 'number', description: 'Maximum move tasks to return (1-10)' },
    taskHandle: { type: 'string', description: 'Handle of a message move task' },
  },
  outputs: {
    message: {
      type: 'string',
      description: 'Success or error message describing the operation outcome',
    },
    id: { type: 'string', description: 'Message ID of the sent message' },
    md5OfMessageBody: { type: 'string', description: 'MD5 digest of the sent message body' },
    md5OfMessageAttributes: {
      type: 'string',
      description: 'MD5 digest of the sent message attributes',
    },
    sequenceNumber: {
      type: 'string',
      description: 'Sequence number assigned by a FIFO queue',
    },
    messages: {
      type: 'json',
      description:
        'Received messages (messageId, receiptHandle, body, md5OfBody, md5OfMessageAttributes, attributes, messageAttributes)',
    },
    successful: {
      type: 'json',
      description: 'Batch entries that succeeded',
    },
    failed: {
      type: 'json',
      description: 'Batch entries that failed (id, senderFault, code, message)',
    },
    successCount: { type: 'number', description: 'Number of batch entries that succeeded' },
    failureCount: { type: 'number', description: 'Number of batch entries that failed' },
    queueUrls: { type: 'json', description: 'Queue URLs returned by a list operation' },
    queueUrl: { type: 'string', description: 'URL of a single queue' },
    nextToken: { type: 'string', description: 'Pagination token for the next page of results' },
    count: { type: 'number', description: 'Number of items returned' },
    attributes: {
      type: 'json',
      description: 'Queue attributes as string values keyed by attribute name',
    },
    tags: { type: 'json', description: 'Queue tags as string values keyed by tag key' },
    results: {
      type: 'json',
      description:
        'Message move tasks (taskHandle, status, sourceArn, destinationArn, maxNumberOfMessagesPerSecond, approximateNumberOfMessagesMoved, approximateNumberOfMessagesToMove, failureReason, startedTimestamp)',
    },
    taskHandle: { type: 'string', description: 'Handle of the started message move task' },
    approximateNumberOfMessagesMoved: {
      type: 'number',
      description: 'Approximate number of messages moved before a task was cancelled',
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
      title: 'SQS dead-letter replayer',
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
      title: 'SQS alert enricher',
      prompt:
        'Create a workflow triggered by PagerDuty or Datadog alerts that classifies severity, decorates the payload with runbook context, and pushes the enriched alert to an Amazon SQS queue so multiple downstream notifiers and ticketing systems can consume it independently.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'automation'],
      alsoIntegrations: ['pagerduty', 'datadog'],
    },
    {
      icon: SQSIcon,
      title: 'SQS batch order queue',
      prompt:
        'Build a workflow that takes a list of orders from a table and queues each one as a separate Amazon SQS message for parallel downstream processing. Track each enqueued message ID in the table so you can correlate downstream results back to the originating row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'ecommerce', 'automation'],
    },
    {
      icon: SQSIcon,
      title: 'Scheduled SQS fan-out',
      prompt:
        'Create a scheduled workflow that runs every fifteen minutes, queries pending items from a table, batches them, and pushes one Amazon SQS message per batch to your worker queue. Update the table with batch IDs and timestamps so reprocessing is deterministic.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
    },
    {
      icon: SQSIcon,
      title: 'SQS cross-service notifier',
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
    {
      name: 'drain-queue-batch',
      description:
        'Receive a batch of Amazon SQS messages with long polling, process them, and delete each one so it is not redelivered.',
      content:
        '# Drain Queue Batch\n\nPull a batch of work off an SQS queue, act on it, and acknowledge it. This is the standard consumer loop: a message stays invisible for its visibility timeout and reappears unless it is deleted.\n\n## Steps\n1. Receive from the queue with a max message count of up to 10 and a wait time of up to 20 seconds so the call long-polls instead of returning empty.\n2. Process each returned message body.\n3. Delete each processed message by its receipt handle, using the batch delete when more than one succeeded.\n4. Leave any message you could not process undeleted so it becomes visible again or lands in the dead-letter queue.\n\n## Output\nReport how many messages were received, how many were processed, and how many were deleted.',
    },
    {
      name: 'extend-processing-lease',
      description:
        'Extend the visibility timeout of an in-flight Amazon SQS message so long-running work finishes before the message is redelivered.',
      content:
        '# Extend Processing Lease\n\nWhen handling a message takes longer than the queue visibility timeout, extend the timeout so another consumer does not pick up the same message and the eventual delete does not fail.\n\n## Steps\n1. Note the receipt handle of the message being processed.\n2. Before the current visibility timeout expires, change the message visibility to a new timeout that covers the remaining work, up to 43200 seconds.\n3. Repeat while processing continues.\n4. Delete the message once the work is done.\n\n## Output\nReport the message the lease was extended for and the new timeout in seconds.',
    },
    {
      name: 'redrive-dead-letter-queue',
      description:
        'Move messages out of an Amazon SQS dead-letter queue back to their source queue, and track the move task to completion.',
      content:
        '# Redrive Dead-Letter Queue\n\nAfter fixing the defect that caused failures, replay the messages parked in a dead-letter queue.\n\n## Steps\n1. List the source queues that redrive to the dead-letter queue to confirm which workloads are affected.\n2. Start a message move task from the dead-letter queue ARN, leaving the destination empty to return each message to its original source queue. Throttle it with a per-second cap if the consumers are fragile.\n3. List the move tasks for the queue to watch status, messages moved, and messages left to move.\n4. Cancel the task if the replay needs to stop; only a running task can be cancelled.\n\n## Output\nReport the task handle, its status, and how many messages were moved.',
    },
    {
      name: 'check-queue-backlog',
      description:
        'Read the message counts and configuration of an Amazon SQS queue to judge backlog and consumer health.',
      content:
        '# Check Queue Backlog\n\nInspect a queue before scaling consumers or opening an incident.\n\n## Steps\n1. Resolve the queue URL from its name if you only have the name.\n2. Read the queue attributes, requesting ApproximateNumberOfMessages, ApproximateNumberOfMessagesNotVisible, ApproximateNumberOfMessagesDelayed, VisibilityTimeout, and RedrivePolicy.\n3. Compare the visible backlog against the in-flight count to tell a slow consumer from an absent one.\n4. If a redrive policy is set, check the dead-letter queue backlog too.\n\n## Output\nReport the visible, in-flight, and delayed message counts, the visibility timeout, and whether a dead-letter queue is configured.',
    },
    {
      name: 'provision-worker-queue',
      description:
        'Create an Amazon SQS queue with a dead-letter queue, a visibility timeout matched to the work, and cost-allocation tags.',
      content:
        '# Provision Worker Queue\n\nStand up a queue for a new background workload with the settings a production consumer needs.\n\n## Steps\n1. Create the dead-letter queue first so its ARN exists.\n2. Read the dead-letter queue attributes to get its QueueArn.\n3. Create the main queue, setting VisibilityTimeout to comfortably exceed the expected processing time, MessageRetentionPeriod to the replay window you want, and RedrivePolicy pointing at the dead-letter queue ARN with a maxReceiveCount. Add FifoQueue when ordering matters, naming the queue with a .fifo suffix.\n4. Tag both queues with owner and environment for cost allocation.\n\n## Output\nReport the URLs of the created queues and the redrive policy linking them.',
    },
    {
      name: 'reset-queue-for-test',
      description:
        'Clear every message from a non-production Amazon SQS queue so a test run starts from a known empty state.',
      content:
        '# Reset Queue For Test\n\nEmpty a scratch or staging queue between test runs. Purging deletes every message and cannot be undone, so confirm the queue is not production.\n\n## Steps\n1. Resolve the queue URL and read its attributes to confirm the environment tag and current message count.\n2. Purge the queue.\n3. Wait before purging again; SQS rejects a second purge within 60 seconds of the first.\n4. Re-read the message count to confirm the queue is empty.\n\n## Output\nReport the queue purged and how many messages it held beforehand.',
    },
  ],
} as const satisfies BlockMeta
