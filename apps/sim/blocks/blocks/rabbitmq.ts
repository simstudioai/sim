import { RabbitmqIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { RabbitmqResponse } from '@/tools/rabbitmq/types'

/** Operations that act on a single named queue. */
const QUEUE_OPERATIONS = [
  'rabbitmq_get_messages',
  'rabbitmq_get_queue',
  'rabbitmq_create_queue',
  'rabbitmq_delete_queue',
  'rabbitmq_purge_queue',
  'rabbitmq_list_bindings',
]

/** Operations that act on a single named exchange. */
const EXCHANGE_OPERATIONS = [
  'rabbitmq_get_exchange',
  'rabbitmq_create_exchange',
  'rabbitmq_delete_exchange',
  'rabbitmq_list_exchange_bindings',
]

/** Operations that expose page, page size, and name filtering. */
const PAGINATED_OPERATIONS = [
  'rabbitmq_list_queues',
  'rabbitmq_list_exchanges',
  'rabbitmq_list_connections',
  'rabbitmq_list_channels',
]

const POLICY_OPERATIONS = ['rabbitmq_create_policy', 'rabbitmq_delete_policy']

export const RabbitmqBlock: BlockConfig<RabbitmqResponse> = {
  type: 'rabbitmq',
  name: 'RabbitMQ',
  description: 'Publish and read messages and manage queues in RabbitMQ',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Connect agents to a RabbitMQ broker through its Management HTTP API. Publish messages to exchanges, read messages off queues, declare queues, exchanges, bindings, and policies, and inspect broker health, queue depth, consumers, connections, and cluster nodes. Works with self-hosted brokers and managed offerings such as CloudAMQP as long as the management plugin is reachable.',
  docsLink: 'https://docs.sim.ai/integrations/rabbitmq',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#FFFFFF',
  icon: RabbitmqIcon,

  canvasPresentation: {
    defaultTitle: 'RabbitMQ',
    sentences: {
      byOperation: {
        rabbitmq_publish_message: [
          { text: 'Publish a message to', field: 'exchange', core: true },
          { text: 'with routing key', field: 'routingKey', core: true },
        ],
        rabbitmq_get_messages: [{ text: 'Read messages from', field: 'queue', core: true }],
        rabbitmq_list_queues: [
          'List queues',
          { text: 'in vhost', field: 'vhost' },
          { text: ', matching', field: 'name' },
        ],
        rabbitmq_get_queue: [{ text: 'Read queue', field: 'queue', core: true }],
        rabbitmq_create_queue: [{ text: 'Declare queue', field: 'queue', core: true }],
        rabbitmq_delete_queue: [
          {
            text: 'Delete queue',
            field: 'queue',
            core: true,
            after: 'and every message in it',
          },
        ],
        rabbitmq_purge_queue: [{ text: 'Discard every message in', field: 'queue', core: true }],
        rabbitmq_list_exchanges: [
          'List exchanges',
          { text: 'in vhost', field: 'vhost' },
          { text: ', matching', field: 'name' },
        ],
        rabbitmq_get_exchange: [{ text: 'Read exchange', field: 'exchange', core: true }],
        rabbitmq_create_exchange: [
          { text: 'Declare exchange', field: 'exchange', core: true },
          { text: 'of type', field: 'exchangeType' },
        ],
        rabbitmq_delete_exchange: [
          {
            text: 'Delete exchange',
            field: 'exchange',
            core: true,
            after: 'and every binding on it',
          },
        ],
        rabbitmq_list_bindings: [{ text: 'List bindings into', field: 'queue', core: true }],
        rabbitmq_list_exchange_bindings: [
          { text: 'List everything routed out of', field: 'exchange', core: true },
        ],
        rabbitmq_create_binding: [
          { text: 'Bind', field: 'queue', core: true },
          { text: 'to exchange', field: 'exchange', core: true },
          { text: 'on routing key', field: 'routingKey' },
        ],
        rabbitmq_delete_binding: [
          { text: 'Unbind', field: 'destination', core: true },
          { text: 'from exchange', field: 'exchange', core: true },
        ],
        rabbitmq_get_overview: ['Read broker status and totals'],
        rabbitmq_health_check: [{ text: 'Run health check', field: 'check', core: true }],
        rabbitmq_list_nodes: ['List cluster nodes and their resource alarms'],
        rabbitmq_list_vhosts: ['List virtual hosts'],
        rabbitmq_list_connections: ['List client connections'],
        rabbitmq_list_channels: ['List open channels'],
        rabbitmq_list_consumers: ['List consumers', { text: 'in vhost', field: 'vhost' }],
        rabbitmq_list_policies: ['List policies', { text: 'in vhost', field: 'vhost' }],
        rabbitmq_create_policy: [
          { text: 'Apply policy', field: 'policyName', core: true },
          { text: 'to names matching', field: 'pattern', core: true },
        ],
        rabbitmq_delete_policy: [{ text: 'Delete policy', field: 'policyName', core: true }],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Publish Message', id: 'rabbitmq_publish_message' },
        { label: 'Get Messages', id: 'rabbitmq_get_messages' },
        { label: 'List Queues', id: 'rabbitmq_list_queues' },
        { label: 'Get Queue', id: 'rabbitmq_get_queue' },
        { label: 'Create Queue', id: 'rabbitmq_create_queue' },
        { label: 'Delete Queue', id: 'rabbitmq_delete_queue' },
        { label: 'Purge Queue', id: 'rabbitmq_purge_queue' },
        { label: 'List Exchanges', id: 'rabbitmq_list_exchanges' },
        { label: 'Get Exchange', id: 'rabbitmq_get_exchange' },
        { label: 'Create Exchange', id: 'rabbitmq_create_exchange' },
        { label: 'Delete Exchange', id: 'rabbitmq_delete_exchange' },
        { label: 'List Queue Bindings', id: 'rabbitmq_list_bindings' },
        { label: 'List Exchange Bindings', id: 'rabbitmq_list_exchange_bindings' },
        { label: 'Create Binding', id: 'rabbitmq_create_binding' },
        { label: 'Delete Binding', id: 'rabbitmq_delete_binding' },
        { label: 'Get Overview', id: 'rabbitmq_get_overview' },
        { label: 'Health Check', id: 'rabbitmq_health_check' },
        { label: 'List Nodes', id: 'rabbitmq_list_nodes' },
        { label: 'List Virtual Hosts', id: 'rabbitmq_list_vhosts' },
        { label: 'List Connections', id: 'rabbitmq_list_connections' },
        { label: 'List Channels', id: 'rabbitmq_list_channels' },
        { label: 'List Consumers', id: 'rabbitmq_list_consumers' },
        { label: 'List Policies', id: 'rabbitmq_list_policies' },
        { label: 'Create Policy', id: 'rabbitmq_create_policy' },
        { label: 'Delete Policy', id: 'rabbitmq_delete_policy' },
      ],
      value: () => 'rabbitmq_publish_message',
    },

    {
      id: 'host',
      title: 'Management URL',
      type: 'short-input',
      placeholder: 'https://rabbit.example.com:15672',
      description:
        'Base URL of the RabbitMQ management plugin, including scheme and port. Must use https unless the broker is on a loopback host',
      required: true,
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Enter username',
      required: true,
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Enter password',
      password: true,
      required: true,
    },
    {
      id: 'vhost',
      title: 'Virtual Host',
      type: 'short-input',
      placeholder: '/',
      description: 'Virtual host to operate on. Leave empty to use the default vhost',
      mode: 'advanced',
    },

    {
      id: 'exchange',
      title: 'Exchange',
      type: 'short-input',
      placeholder: 'orders (leave empty for the default exchange)',
      description:
        'Publishing to the default exchange routes by queue name, so set the routing key to the target queue',
      condition: {
        field: 'operation',
        value: [
          'rabbitmq_publish_message',
          'rabbitmq_create_binding',
          'rabbitmq_delete_binding',
          ...EXCHANGE_OPERATIONS,
        ],
      },
      required: {
        field: 'operation',
        value: [
          'rabbitmq_create_binding',
          'rabbitmq_delete_binding',
          'rabbitmq_create_exchange',
          'rabbitmq_delete_exchange',
        ],
      },
    },
    {
      id: 'exchangeType',
      title: 'Exchange Type',
      type: 'dropdown',
      options: [
        { label: 'Direct — exact routing key match', id: 'direct' },
        { label: 'Topic — wildcard routing key patterns', id: 'topic' },
        { label: 'Fanout — every bound queue', id: 'fanout' },
        { label: 'Headers — match on binding arguments', id: 'headers' },
      ],
      value: () => 'direct',
      condition: { field: 'operation', value: 'rabbitmq_create_exchange' },
    },
    {
      id: 'internal',
      title: 'Internal',
      type: 'switch',
      description: 'Internal exchanges can only be bound from another exchange, not published to',
      mode: 'advanced',
      condition: { field: 'operation', value: 'rabbitmq_create_exchange' },
    },
    {
      id: 'queue',
      title: 'Queue',
      type: 'short-input',
      placeholder: 'orders.processing',
      condition: {
        field: 'operation',
        value: [...QUEUE_OPERATIONS, 'rabbitmq_create_binding'],
      },
      required: {
        field: 'operation',
        value: [...QUEUE_OPERATIONS, 'rabbitmq_create_binding'],
      },
    },
    {
      id: 'destination',
      title: 'Destination',
      type: 'short-input',
      placeholder: 'orders.processing',
      description: 'Queue or exchange the binding routes to',
      condition: { field: 'operation', value: 'rabbitmq_delete_binding' },
      required: { field: 'operation', value: 'rabbitmq_delete_binding' },
    },
    {
      id: 'destinationType',
      title: 'Destination Type',
      type: 'dropdown',
      options: [
        { label: 'Queue', id: 'queue' },
        { label: 'Exchange', id: 'exchange' },
      ],
      value: () => 'queue',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['rabbitmq_create_binding', 'rabbitmq_delete_binding'],
      },
    },
    {
      id: 'propertiesKey',
      title: 'Binding Key',
      type: 'short-input',
      placeholder: 'orders.created',
      description:
        'Broker identifier for the binding, from List Bindings. Use ~ for a binding with an empty routing key',
      condition: { field: 'operation', value: 'rabbitmq_delete_binding' },
      required: { field: 'operation', value: 'rabbitmq_delete_binding' },
    },
    {
      id: 'routingKey',
      title: 'Routing Key',
      type: 'short-input',
      placeholder: 'orders.created',
      condition: {
        field: 'operation',
        value: ['rabbitmq_publish_message', 'rabbitmq_create_binding'],
      },
      required: { field: 'operation', value: 'rabbitmq_publish_message' },
    },
    {
      id: 'payload',
      title: 'Message',
      type: 'long-input',
      placeholder: '{ "orderId": "1234", "status": "created" }',
      condition: { field: 'operation', value: 'rabbitmq_publish_message' },
      required: { field: 'operation', value: 'rabbitmq_publish_message' },
    },
    {
      id: 'properties',
      title: 'Message Properties',
      type: 'code',
      placeholder: '{ "delivery_mode": 2, "content_type": "application/json" }',
      description: 'AMQP basic properties. delivery_mode 2 makes the message persistent',
      mode: 'advanced',
      condition: { field: 'operation', value: 'rabbitmq_publish_message' },
      wandConfig: {
        enabled: true,
        prompt: `Generate AMQP basic properties as a JSON object for a RabbitMQ publish based on the user's description.
Common properties:
- "delivery_mode": 1 for transient, 2 for persistent
- "content_type": MIME type of the payload, e.g. "application/json"
- "correlation_id", "reply_to", "message_id": request/reply correlation
- "expiration": per-message TTL in milliseconds, as a string
- "priority": integer priority for priority queues

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the message properties you need...',
        generationType: 'json-object',
      },
    },
    {
      id: 'headers',
      title: 'Message Headers',
      type: 'code',
      placeholder: '{ "source": "sim", "tenant": "acme" }',
      mode: 'advanced',
      condition: { field: 'operation', value: 'rabbitmq_publish_message' },
      wandConfig: {
        enabled: true,
        prompt: `Generate RabbitMQ message headers as a flat JSON object based on the user's description.
Headers are arbitrary key/value pairs used for routing on headers exchanges and for downstream metadata.

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the headers you want to attach...',
        generationType: 'json-object',
      },
    },
    {
      id: 'payloadEncoding',
      title: 'Payload Encoding',
      type: 'dropdown',
      options: [
        { label: 'String', id: 'string' },
        { label: 'Base64', id: 'base64' },
      ],
      value: () => 'string',
      mode: 'advanced',
      condition: { field: 'operation', value: 'rabbitmq_publish_message' },
    },

    {
      id: 'count',
      title: 'Message Count',
      type: 'short-input',
      placeholder: '1',
      description: 'Maximum number of messages to retrieve, up to 50',
      condition: { field: 'operation', value: 'rabbitmq_get_messages' },
    },
    {
      id: 'ackmode',
      title: 'Acknowledgement Mode',
      type: 'dropdown',
      options: [
        { label: 'Ack, requeue (leave messages in the queue)', id: 'ack_requeue_true' },
        { label: 'Ack, discard (remove messages from the queue)', id: 'ack_requeue_false' },
        { label: 'Reject, requeue', id: 'reject_requeue_true' },
        { label: 'Reject, discard', id: 'reject_requeue_false' },
      ],
      value: () => 'ack_requeue_true',
      mode: 'advanced',
      condition: { field: 'operation', value: 'rabbitmq_get_messages' },
    },
    {
      id: 'encoding',
      title: 'Payload Decoding',
      type: 'dropdown',
      options: [
        { label: 'Auto (text where possible)', id: 'auto' },
        { label: 'Base64', id: 'base64' },
      ],
      value: () => 'auto',
      mode: 'advanced',
      condition: { field: 'operation', value: 'rabbitmq_get_messages' },
    },
    {
      id: 'truncate',
      title: 'Truncate Payloads (bytes)',
      type: 'short-input',
      placeholder: '50000',
      mode: 'advanced',
      condition: { field: 'operation', value: 'rabbitmq_get_messages' },
    },

    {
      id: 'name',
      title: 'Name Filter',
      type: 'short-input',
      placeholder: 'orders',
      description: 'Only return entries whose name matches this value',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
    },
    {
      id: 'useRegex',
      title: 'Treat Filter as Regex',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '50',
      description: 'Results per page, up to 500',
      mode: 'advanced',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
    },

    {
      id: 'durable',
      title: 'Durable',
      type: 'switch',
      defaultValue: true,
      description: 'Durable queues and exchanges survive a broker restart',
      condition: {
        field: 'operation',
        value: ['rabbitmq_create_queue', 'rabbitmq_create_exchange'],
      },
    },
    {
      id: 'autoDelete',
      title: 'Auto Delete',
      type: 'switch',
      description:
        'Delete the queue once its last consumer disconnects, or the exchange once its last binding is removed',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['rabbitmq_create_queue', 'rabbitmq_create_exchange'],
      },
    },
    {
      id: 'arguments',
      title: 'Arguments',
      type: 'code',
      placeholder: '{ "x-queue-type": "quorum" }',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['rabbitmq_create_queue', 'rabbitmq_create_exchange', 'rabbitmq_create_binding'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate RabbitMQ arguments as a JSON object based on the user's description.
For queue declarations, common arguments are:
- "x-queue-type": "classic", "quorum", or "stream"
- "x-message-ttl": per-queue message TTL in milliseconds
- "x-max-length" / "x-max-length-bytes": queue length limits
- "x-dead-letter-exchange" / "x-dead-letter-routing-key": dead lettering
For exchange declarations, use "alternate-exchange" to capture messages that match no binding.
For binding declarations on a headers exchange, use "x-match" ("all" or "any") plus the header names and values to match.

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the arguments you need...',
        generationType: 'json-object',
      },
    },

    {
      id: 'ifUnused',
      title: 'Only If Unused',
      type: 'switch',
      description:
        'Fail instead of deleting when the queue still has consumers, or the exchange still has bindings',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['rabbitmq_delete_queue', 'rabbitmq_delete_exchange'],
      },
    },
    {
      id: 'ifEmpty',
      title: 'Only If Empty',
      type: 'switch',
      description: 'Fail instead of deleting when the queue still holds messages',
      mode: 'advanced',
      condition: { field: 'operation', value: 'rabbitmq_delete_queue' },
    },

    {
      id: 'check',
      title: 'Check',
      type: 'dropdown',
      options: [
        { label: 'Resource alarms (cluster-wide)', id: 'alarms' },
        { label: 'Resource alarms (this node)', id: 'local-alarms' },
        { label: 'Virtual hosts are running', id: 'virtual-hosts' },
        { label: 'Quorum queues would survive losing this node', id: 'node-is-quorum-critical' },
        { label: 'A port has a listener', id: 'port-listener' },
        { label: 'A protocol has a listener', id: 'protocol-listener' },
        { label: 'Certificates are not expiring', id: 'certificate-expiration' },
      ],
      value: () => 'alarms',
      condition: { field: 'operation', value: 'rabbitmq_health_check' },
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      placeholder: '5672',
      condition: {
        field: 'operation',
        value: 'rabbitmq_health_check',
        and: { field: 'check', value: 'port-listener' },
      },
      required: {
        field: 'operation',
        value: 'rabbitmq_health_check',
        and: { field: 'check', value: 'port-listener' },
      },
    },
    {
      id: 'protocol',
      title: 'Protocol',
      type: 'short-input',
      placeholder: 'amqp',
      condition: {
        field: 'operation',
        value: 'rabbitmq_health_check',
        and: { field: 'check', value: 'protocol-listener' },
      },
      required: {
        field: 'operation',
        value: 'rabbitmq_health_check',
        and: { field: 'check', value: 'protocol-listener' },
      },
    },
    {
      id: 'within',
      title: 'Expiring Within',
      type: 'short-input',
      placeholder: '1',
      condition: {
        field: 'operation',
        value: 'rabbitmq_health_check',
        and: { field: 'check', value: 'certificate-expiration' },
      },
      required: {
        field: 'operation',
        value: 'rabbitmq_health_check',
        and: { field: 'check', value: 'certificate-expiration' },
      },
    },
    {
      id: 'unit',
      title: 'Unit',
      type: 'dropdown',
      options: [
        { label: 'Days', id: 'days' },
        { label: 'Weeks', id: 'weeks' },
        { label: 'Months', id: 'months' },
        { label: 'Years', id: 'years' },
      ],
      value: () => 'months',
      condition: {
        field: 'operation',
        value: 'rabbitmq_health_check',
        and: { field: 'check', value: 'certificate-expiration' },
      },
    },

    {
      id: 'policyName',
      title: 'Policy Name',
      type: 'short-input',
      placeholder: 'orders-dead-lettering',
      condition: { field: 'operation', value: POLICY_OPERATIONS },
      required: { field: 'operation', value: POLICY_OPERATIONS },
    },
    {
      id: 'pattern',
      title: 'Name Pattern',
      type: 'short-input',
      placeholder: '^orders\\.',
      description: 'Regular expression matched against queue or exchange names',
      condition: { field: 'operation', value: 'rabbitmq_create_policy' },
      required: { field: 'operation', value: 'rabbitmq_create_policy' },
    },
    {
      id: 'definition',
      title: 'Definition',
      type: 'code',
      placeholder: '{ "dead-letter-exchange": "dlx", "message-ttl": 86400000 }',
      condition: { field: 'operation', value: 'rabbitmq_create_policy' },
      required: { field: 'operation', value: 'rabbitmq_create_policy' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a RabbitMQ policy definition as a JSON object based on the user's description.
Common definition keys:
- "dead-letter-exchange" / "dead-letter-routing-key": where rejected or expired messages go
- "message-ttl": message lifetime in milliseconds
- "expires": how long an unused queue survives, in milliseconds
- "max-length" / "max-length-bytes": queue length limits
- "overflow": "drop-head", "reject-publish", or "reject-publish-dlx"
- "delivery-limit": redeliveries allowed before dead-lettering, for quorum queues
- "queue-mode": "lazy" to keep messages on disk

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the policy settings you need...',
        generationType: 'json-object',
      },
    },
    {
      id: 'applyTo',
      title: 'Apply To',
      type: 'dropdown',
      options: [
        { label: 'Queues', id: 'queues' },
        { label: 'Classic queues', id: 'classic_queues' },
        { label: 'Quorum queues', id: 'quorum_queues' },
        { label: 'Streams', id: 'streams' },
        { label: 'Exchanges', id: 'exchanges' },
        { label: 'All', id: 'all' },
      ],
      value: () => 'queues',
      condition: { field: 'operation', value: 'rabbitmq_create_policy' },
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'short-input',
      placeholder: '0',
      description:
        'When several policies match a resource only the highest-priority one applies — they do not merge',
      mode: 'advanced',
      condition: { field: 'operation', value: 'rabbitmq_create_policy' },
    },
  ],

  tools: {
    access: [
      'rabbitmq_publish_message',
      'rabbitmq_get_messages',
      'rabbitmq_list_queues',
      'rabbitmq_get_queue',
      'rabbitmq_create_queue',
      'rabbitmq_delete_queue',
      'rabbitmq_purge_queue',
      'rabbitmq_list_exchanges',
      'rabbitmq_get_exchange',
      'rabbitmq_create_exchange',
      'rabbitmq_delete_exchange',
      'rabbitmq_list_bindings',
      'rabbitmq_list_exchange_bindings',
      'rabbitmq_create_binding',
      'rabbitmq_delete_binding',
      'rabbitmq_get_overview',
      'rabbitmq_health_check',
      'rabbitmq_list_nodes',
      'rabbitmq_list_vhosts',
      'rabbitmq_list_connections',
      'rabbitmq_list_channels',
      'rabbitmq_list_consumers',
      'rabbitmq_list_policies',
      'rabbitmq_create_policy',
      'rabbitmq_delete_policy',
    ],
    config: {
      tool: (params) => params.operation || 'rabbitmq_publish_message',
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.count) result.count = Number(params.count)
        if (params.truncate) result.truncate = Number(params.truncate)
        if (params.page) result.page = Number(params.page)
        if (params.pageSize) result.pageSize = Number(params.pageSize)
        if (params.port) result.port = Number(params.port)
        if (params.within) result.within = Number(params.within)
        if (params.priority) result.priority = Number(params.priority)
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    host: { type: 'string', description: 'RabbitMQ Management API base URL' },
    username: { type: 'string', description: 'RabbitMQ username' },
    password: { type: 'string', description: 'RabbitMQ password' },
    vhost: { type: 'string', description: 'Virtual host to operate on' },
    exchange: { type: 'string', description: 'Exchange name' },
    exchangeType: { type: 'string', description: 'Exchange routing behaviour' },
    internal: { type: 'boolean', description: 'Whether a declared exchange is internal' },
    queue: { type: 'string', description: 'Queue name' },
    destination: { type: 'string', description: 'Binding destination name' },
    destinationType: { type: 'string', description: 'Binding destination kind: queue or exchange' },
    propertiesKey: { type: 'string', description: 'Broker identifier for a binding' },
    routingKey: { type: 'string', description: 'Routing key' },
    payload: { type: 'string', description: 'Message body to publish' },
    payloadEncoding: { type: 'string', description: 'Payload encoding: string or base64' },
    properties: { type: 'string', description: 'AMQP basic properties as JSON' },
    headers: { type: 'string', description: 'Message headers as JSON' },
    count: { type: 'number', description: 'Maximum messages to retrieve' },
    ackmode: { type: 'string', description: 'How retrieved messages are acknowledged' },
    encoding: { type: 'string', description: 'How retrieved payloads are decoded' },
    truncate: { type: 'number', description: 'Truncate payloads longer than this many bytes' },
    page: { type: 'number', description: 'Page of results to return' },
    pageSize: { type: 'number', description: 'Results per page' },
    name: { type: 'string', description: 'Name filter for list operations' },
    useRegex: { type: 'boolean', description: 'Treat the name filter as a regular expression' },
    durable: { type: 'boolean', description: 'Whether a declared queue or exchange is durable' },
    autoDelete: {
      type: 'boolean',
      description: 'Whether a declared queue or exchange auto-deletes',
    },
    arguments: { type: 'string', description: 'Queue, exchange, or binding arguments as JSON' },
    ifUnused: { type: 'boolean', description: 'Only delete when unused' },
    ifEmpty: { type: 'boolean', description: 'Only delete the queue when it holds no messages' },
    check: { type: 'string', description: 'Health check to run' },
    port: { type: 'number', description: 'Port for the port-listener health check' },
    protocol: { type: 'string', description: 'Protocol for the protocol-listener health check' },
    within: { type: 'number', description: 'Certificate expiration window' },
    unit: { type: 'string', description: 'Unit for the certificate expiration window' },
    policyName: { type: 'string', description: 'Policy name' },
    pattern: { type: 'string', description: 'Regular expression the policy matches names with' },
    definition: { type: 'string', description: 'Policy definition as JSON' },
    applyTo: { type: 'string', description: 'What the policy applies to' },
    priority: { type: 'number', description: 'Policy priority' },
  },

  outputs: {
    routed: {
      type: 'boolean',
      description: 'Whether a published message reached at least one queue',
    },
    exchange: {
      type: 'any',
      description: 'Exchange name, or the exchange record for Get Exchange',
    },
    exchangeName: { type: 'string', description: 'Exchange the operation acted on' },
    routingKey: { type: 'string', description: 'Routing key involved in the operation' },
    queueName: { type: 'string', description: 'Queue the operation acted on' },
    queue: {
      type: 'json',
      description:
        'Queue record from Get Queue (name, vhost, type, state, durable, messages, consumers)',
    },
    destination: { type: 'string', description: 'Binding destination the operation acted on' },
    vhost: { type: 'string', description: 'Virtual host the operation ran against' },
    messages: {
      type: 'json',
      description:
        'Messages retrieved from a queue: [{payload, payloadBytes, truncated, exchange, routingKey, redelivered, messageCount, properties}]',
    },
    queues: {
      type: 'json',
      description:
        'Queues returned by List Queues: [{name, vhost, type, state, durable, messages, messagesReady, consumers}]',
    },
    exchanges: {
      type: 'json',
      description:
        'Exchanges returned by List Exchanges: [{name, vhost, type, durable, autoDelete, internal, arguments}]',
    },
    bindings: {
      type: 'json',
      description:
        'Bindings returned by the binding list operations: [{source, destination, destinationType, routingKey, propertiesKey, arguments}]',
    },
    vhosts: {
      type: 'json',
      description:
        'Virtual hosts returned by List Virtual Hosts: [{name, description, tags, tracing, messages}]',
    },
    connections: {
      type: 'json',
      description:
        'Connections returned by List Connections: [{name, user, vhost, state, protocol, node, channels, peerHost, ssl}]',
    },
    channels: {
      type: 'json',
      description:
        'Channels returned by List Channels: [{name, number, user, vhost, state, consumerCount, prefetchCount, messagesUnacknowledged}]',
    },
    consumers: {
      type: 'json',
      description:
        'Consumers returned by List Consumers: [{consumerTag, queue, vhost, ackRequired, active, activityStatus, prefetchCount}]',
    },
    nodes: {
      type: 'json',
      description:
        'Nodes returned by List Nodes: [{name, type, running, memUsed, memAlarm, diskFree, diskFreeAlarm, fdUsed, partitions}]',
    },
    policies: {
      type: 'json',
      description:
        'Policies returned by List Policies: [{name, vhost, pattern, applyTo, priority, definition}]',
    },
    policyName: { type: 'string', description: 'Policy the operation acted on' },
    count: { type: 'number', description: 'Number of records returned' },
    totalCount: { type: 'number', description: 'Total records available before filtering' },
    page: { type: 'number', description: 'Page number returned' },
    pageCount: { type: 'number', description: 'Total number of pages' },
    created: { type: 'boolean', description: 'Whether the resource was created' },
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    purged: { type: 'boolean', description: 'Whether the queue was purged' },
    propertiesKey: { type: 'string', description: 'Broker identifier of a binding' },
    check: { type: 'string', description: 'Health check that was run' },
    healthy: { type: 'boolean', description: 'Whether the health check passed' },
    status: { type: 'string', description: 'Raw health check status reported by the broker' },
    reason: { type: 'string', description: 'Why a health check failed' },
    details: { type: 'json', description: 'Full health check body' },
    rabbitmqVersion: { type: 'string', description: 'Broker version' },
    productName: { type: 'string', description: 'Broker product name' },
    productVersion: { type: 'string', description: 'Broker product version' },
    erlangVersion: { type: 'string', description: 'Erlang runtime version' },
    clusterName: { type: 'string', description: 'Cluster name' },
    node: { type: 'string', description: 'Node that served the request' },
    objectTotals: {
      type: 'json',
      description: 'Broker object counts (connections, channels, exchanges, queues, consumers)',
    },
    queueTotals: {
      type: 'json',
      description:
        'Aggregate queue depth across the broker (messages, messages_ready, messages_unacknowledged)',
    },
    messageStats: { type: 'json', description: 'Broker-wide message counters and rates' },
  },
}

export const RabbitmqBlockMeta = {
  tags: ['messaging', 'automation'],
  url: 'https://www.rabbitmq.com',
  templates: [
    {
      icon: RabbitmqIcon,
      title: 'RabbitMQ dead-letter triage',
      prompt:
        'Build a scheduled workflow that reads messages off the RabbitMQ dead-letter queue every 15 minutes, groups them by failure reason, writes the groups to a table, and posts a summary to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RabbitmqIcon,
      title: 'RabbitMQ queue depth alerting',
      prompt:
        'Create a scheduled workflow that lists RabbitMQ queues every five minutes, flags any queue whose depth exceeds its threshold or that has zero consumers, and opens a PagerDuty incident.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: RabbitmqIcon,
      title: 'Publish enriched events to RabbitMQ',
      prompt:
        'Build a workflow that receives an inbound webhook, enriches the payload with an agent, and publishes the result to a RabbitMQ topic exchange with a routing key derived from the event type.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'engineering'],
    },
    {
      icon: RabbitmqIcon,
      title: 'RabbitMQ to Slack incident relay',
      prompt:
        'Create a scheduled workflow that drains a RabbitMQ alerts queue, summarizes each message with an agent, and posts the summary to the on-call Slack channel with a severity label.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RabbitmqIcon,
      title: 'RabbitMQ order pipeline bootstrap',
      prompt:
        'Build a workflow that declares the RabbitMQ queues and exchange bindings an order pipeline needs, verifies each binding, and records the resulting topology in a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: RabbitmqIcon,
      title: 'RabbitMQ broker health digest',
      prompt:
        'Create a scheduled daily workflow that reads the RabbitMQ broker overview and queue list, compares depth and consumer counts against yesterday, and emails the platform team a health digest.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: RabbitmqIcon,
      title: 'RabbitMQ replay after an outage',
      prompt:
        'Build a workflow that reads messages from a RabbitMQ parking queue, has an agent decide which are safe to replay, republishes those to the live exchange, and logs every skipped message with its reason.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: RabbitmqIcon,
      title: 'RabbitMQ capacity review',
      prompt:
        'Create a scheduled weekly workflow that lists every RabbitMQ queue and exchange, identifies unused queues and queues with no bindings, and posts a cleanup proposal to a Linear issue.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'engineering'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: RabbitmqIcon,
      title: 'RabbitMQ cluster alarm watch',
      prompt:
        'Create a scheduled workflow that runs the RabbitMQ health checks every five minutes, lists cluster nodes for memory and disk alarms and network partitions, and pages on-call when an alarm fires.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: RabbitmqIcon,
      title: 'RabbitMQ stalled consumer detector',
      prompt:
        'Build a scheduled workflow that cross-references RabbitMQ queue depth with consumers and channels, flags queues whose consumers are inactive or whose unacknowledged counts are stuck at the prefetch limit, and posts the findings to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RabbitmqIcon,
      title: 'RabbitMQ dead-letter policy rollout',
      prompt:
        'Create a workflow that audits RabbitMQ policies across virtual hosts, finds queue families with no dead-letter exchange configured, and applies a standard dead-lettering policy after posting the plan for approval.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'publish-rabbitmq-message',
      description: 'Publish a message to a RabbitMQ exchange and confirm it was routed.',
      content:
        '# Publish RabbitMQ Message\n\nSend a message into a RabbitMQ topology.\n\n## Steps\n1. Confirm the management URL, credentials, and virtual host.\n2. Choose the Publish Message operation. Set the exchange and routing key — to target a queue directly, leave the exchange empty and set the routing key to the queue name.\n3. Put the body in the message field. For JSON, set content_type to application/json in the message properties, and set delivery_mode to 2 so the message survives a broker restart.\n4. Add headers when downstream consumers or a headers exchange route on them.\n\n## Output\nReport whether the message was routed. A routed value of false means no binding matched the routing key and the broker dropped the message — check the exchange bindings before retrying.',
    },
    {
      name: 'drain-rabbitmq-queue',
      description: 'Read messages off a RabbitMQ queue for inspection or reprocessing.',
      content:
        '# Drain RabbitMQ Queue\n\nRetrieve messages from a queue so they can be inspected or reprocessed.\n\n## Steps\n1. Confirm the management URL, credentials, virtual host, and queue name.\n2. Choose the Get Messages operation and set the count. Leave the acknowledgement mode at "Ack, requeue" to inspect messages without consuming them; switch to "Ack, discard" only when the messages should be removed.\n3. Raise the truncate limit if payloads are being cut short.\n\n## Output\nReturn the retrieved messages with their routing key, headers, and body, plus how many remain in the queue. Note explicitly whether the messages were left in place or removed.',
    },
    {
      name: 'audit-rabbitmq-queues',
      description: 'Review RabbitMQ queue depth, consumers, and broker health.',
      content:
        '# Audit RabbitMQ Queues\n\nAssess the state of a RabbitMQ broker.\n\n## Steps\n1. Confirm the management URL and credentials.\n2. Run Get Overview for broker version, node, and aggregate queue totals.\n3. Run List Queues for the virtual host. Use the name filter to narrow to a service prefix.\n4. Flag queues where messages are growing, consumers is zero, or state is not running. Queue statistics are null until the broker has collected them, which is normal for a freshly declared queue.\n\n## Output\nReport the broker version and totals, then the problem queues with their depth and consumer count and what each symptom implies — a backlog with no consumers means nothing is processing, a backlog with consumers means processing is too slow.',
    },
    {
      name: 'triage-rabbitmq-alarms',
      description: 'Check RabbitMQ broker health and explain what a fired alarm means.',
      content:
        '# Triage RabbitMQ Alarms\n\nDetermine whether the broker is healthy and what to do if it is not.\n\n## Steps\n1. Confirm the management URL and credentials.\n2. Run Health Check with the alarms check for a cluster-wide answer. A failing check is a normal result — read the healthy flag and reason rather than treating it as an error.\n3. Run List Nodes and inspect memory and disk alarms, the free-versus-limit figures, file-descriptor usage, and partitions. A non-empty partitions list means the cluster is split-brained and needs manual recovery.\n4. For a cluster, also run the quorum-critical check to confirm quorum queues would survive losing the node, and the virtual-hosts check to confirm every vhost is running.\n\n## Output\nState whether the broker is healthy. When a resource alarm has fired, say plainly that publishers are currently blocked broker-wide until the resource is reclaimed, name the node and the resource, and give the free-versus-limit numbers. Recommend consuming the backlog or raising the watermark rather than restarting the node.',
    },
    {
      name: 'find-stalled-rabbitmq-consumers',
      description: 'Work out why a RabbitMQ queue has a backlog that is not draining.',
      content:
        '# Find Stalled RabbitMQ Consumers\n\nDistinguish "nothing is consuming" from "consuming too slowly" from "consumers are stuck".\n\n## Steps\n1. Confirm the management URL, credentials, and virtual host.\n2. Run Get Queue on the affected queue and note messages, messagesReady, and messagesUnacknowledged. Null values mean the broker has not collected statistics yet, not that the queue is empty.\n3. Run List Consumers. No consumers on a queue with a backlog means nothing is processing it — the application is down or never subscribed.\n4. If consumers exist, check their active flag and activityStatus, then run List Channels and compare messagesUnacknowledged against prefetchCount. A channel pinned at its prefetch limit is a consumer that received messages and never acknowledged them.\n5. Run List Connections to confirm the client is still connected and its state is running rather than blocked or flow — blocked means a resource alarm is throttling it.\n\n## Output\nName which of the three cases applies and the evidence for it. For no consumers, say the application is not subscribed. For unacknowledged messages stuck at the prefetch limit, say consumers are hung mid-processing and those messages will be redelivered when the connection drops. For flow or blocked connection state, point at the resource alarm instead.',
    },
    {
      name: 'configure-rabbitmq-dead-lettering',
      description: 'Apply dead-lettering to a family of RabbitMQ queues with a policy.',
      content:
        '# Configure RabbitMQ Dead-Lettering\n\nRoute rejected and expired messages somewhere you can inspect them.\n\n## Steps\n1. Confirm the management URL, credentials, and virtual host.\n2. Create the dead-letter exchange and the queue that will hold the failures, then bind them.\n3. Use Create Policy with a pattern matching the queues to protect and a definition setting dead-letter-exchange, plus message-ttl, max-length, or delivery-limit as needed. A policy is the right tool here because it applies to matching queues that already exist — queue arguments only take effect at declaration time, so setting them on a live queue means deleting and redeclaring it.\n4. Run List Policies and confirm the priority. Only the single highest-priority matching policy applies to a resource; policies do not merge, so a higher-priority policy elsewhere will silently override this one.\n5. Verify with Get Queue that the queue reports the expected policy.\n\n## Output\nReport the policy name, pattern, definition, and priority, and which queues it now governs. Warn about any existing policy at equal or higher priority whose pattern also matches, since that one wins.',
    },
    {
      name: 'diagnose-unrouted-messages',
      description: 'Work out why a published RabbitMQ message was not routed to any queue.',
      content:
        '# Diagnose Unrouted Messages\n\nFind why a publish reported `routed: false`.\n\n## Steps\n1. Confirm the management URL, credentials, and virtual host — a message published to the wrong vhost cannot match any binding.\n2. Run List Exchanges and confirm the target exchange exists and note its type. The type decides how matching works: direct requires the routing key to equal the binding key exactly, topic matches wildcard patterns, fanout ignores the routing key, and headers ignores it entirely in favour of binding arguments.\n3. Run List Bindings on the queue that should have received the message and compare each binding routing key against the key that was published. Watch for the common causes: a typo, a topic pattern that uses `*` (exactly one word) where `#` (zero or more words) was needed, or a queue bound to a different exchange.\n4. If no binding matches, use Create Binding to add the missing one, then republish and confirm `routed` is true.\n\n## Output\nState the exchange type, the routing key that was published, and every binding that could have matched. Name the specific mismatch, then the exact binding needed to fix it. An unrouted message is gone — the broker drops it unless the exchange has an alternate exchange configured, so re-publishing after the fix is required.',
    },
    {
      name: 'purge-queue-safely',
      description: 'Clear a RabbitMQ queue after confirming what would be lost.',
      content:
        '# Purge Queue Safely\n\nDiscard a queue backlog without throwing away messages that still matter.\n\n## Steps\n1. Confirm the management URL, credentials, virtual host, and queue name.\n2. Run Get Queue first and report the current depth. If message counts come back null the broker has not collected statistics yet — wait and re-read rather than assuming the queue is empty.\n3. Sample the backlog with Get Messages at the default requeue acknowledgement mode so nothing is consumed, and summarize what the messages are.\n4. Only after the user confirms, run Purge Queue. It discards every ready message and cannot be undone. To remove the queue itself instead, use Delete Queue with the only-if-empty guard so the call fails rather than destroying unread messages.\n\n## Output\nReport the depth before purging, a summary of what the sampled messages contained, and the depth afterwards. If the queue is a dead-letter queue, say so explicitly and recommend replaying or archiving the messages before discarding them.',
    },
    {
      name: 'set-up-rabbitmq-topology',
      description: 'Declare RabbitMQ queues and bind them to an exchange.',
      content:
        '# Set Up RabbitMQ Topology\n\nCreate the queues and bindings a pipeline needs.\n\n## Steps\n1. Confirm the management URL, credentials, and virtual host.\n2. Use Create Queue for each queue. Keep durable on so queues survive a restart. Set arguments for a quorum queue, a message TTL, a length limit, or dead lettering.\n3. Use Create Binding to attach each queue to its exchange with the routing key it should receive. Topic exchanges accept wildcards such as orders.* for one segment and orders.# for many.\n4. Verify with List Bindings on each queue.\n\n## Output\nList the queues declared and the bindings created with their routing keys. Note that every queue also has an implicit default-exchange binding on its own name, which appears with an empty source.',
    },
  ],
} as const satisfies BlockMeta
