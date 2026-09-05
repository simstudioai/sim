import { NetSuiteIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'
import type { OciStreamingResponse } from '@/tools/oci_streaming/types'

export const OciStreamingBlock: BlockConfig<OciStreamingResponse> = {
  type: 'oci_streaming',
  name: 'OCI Streaming',
  description: 'Manage streams and pools, publish messages, and consume bounded batches',
  longDescription:
    'Use native OCI REST APIs with a reusable API signing-key service account. Manage streams and pools, publish one bounded batch, read one batch using expiring cursors, explicitly commit consumer groups, and inspect work requests. Message operations require GetStream permission for authenticated endpoint discovery. Offsets remain decimal strings and delivery is at least once. Group cursors default to manual commits. No Kafka client, continuous consumer, automatic polling, or private endpoint provisioning is included.',
  docsLink: 'https://docs.sim.ai/integrations/oci_streaming',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  authMode: AuthMode.ApiKey,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'OCI Streaming',
    sentences: {
      byOperation: {
        oci_streaming_change_stream_compartment: [
          { text: 'Move', field: ['streamSelector', 'streamManual'], core: true },
        ],
        oci_streaming_change_stream_pool_compartment: [
          { text: 'Move', field: ['streamPoolSelector', 'streamPoolManual'], core: true },
        ],
        oci_streaming_consumer_commit: [
          {
            text: 'Commit processed group messages on',
            field: ['streamSelector', 'streamManual'],
            core: true,
          },
        ],
        oci_streaming_consumer_heartbeat: [
          {
            text: 'Send a consumer heartbeat on',
            field: ['streamSelector', 'streamManual'],
            core: true,
          },
        ],
        oci_streaming_create_cursor: [
          {
            text: 'Create a partition cursor for',
            field: ['streamSelector', 'streamManual'],
            core: true,
          },
        ],
        oci_streaming_create_group_cursor: [
          {
            text: 'Join a consumer group on',
            field: ['streamSelector', 'streamManual'],
            core: true,
          },
        ],
        oci_streaming_create_stream: [{ text: 'Create stream named', field: 'name', core: true }],
        oci_streaming_create_stream_pool: [
          { text: 'Create stream pool named', field: 'name', core: true },
        ],
        oci_streaming_delete_stream: [
          { text: 'Delete', field: ['streamSelector', 'streamManual'], core: true },
        ],
        oci_streaming_delete_stream_pool: [
          {
            text: 'Delete all streams and',
            field: ['streamPoolSelector', 'streamPoolManual'],
            core: true,
          },
        ],
        oci_streaming_get_group: [
          {
            text: 'Inspect consumer group state on',
            field: ['streamSelector', 'streamManual'],
            core: true,
          },
        ],
        oci_streaming_get_messages: [
          {
            text: 'Read one message batch from',
            field: ['streamSelector', 'streamManual'],
            core: true,
          },
        ],
        oci_streaming_get_stream: [
          { text: 'Get configuration of', field: ['streamSelector', 'streamManual'], core: true },
        ],
        oci_streaming_get_stream_pool: [
          {
            text: 'Get configuration of',
            field: ['streamPoolSelector', 'streamPoolManual'],
            core: true,
          },
        ],
        oci_streaming_get_work_request: [
          { text: 'Get status of', field: 'workRequestId', core: true },
        ],
        oci_streaming_list_stream_pools: [
          { text: 'List stream pools in', field: 'compartmentId', core: true },
        ],
        oci_streaming_list_streams: [
          'List streams',
          { text: ', in pool', field: ['streamPoolSelector', 'streamPoolManual'] },
        ],
        oci_streaming_list_work_request_errors: [
          { text: 'List errors for', field: 'workRequestId', core: true },
        ],
        oci_streaming_list_work_request_logs: [
          { text: 'List logs for', field: 'workRequestId', core: true },
        ],
        oci_streaming_list_work_requests: [
          { text: 'List work requests in', field: 'compartmentId', core: true },
        ],
        oci_streaming_put_messages: [
          { text: 'Publish messages to', field: ['streamSelector', 'streamManual'], core: true },
        ],
        oci_streaming_update_group: [
          {
            text: 'Reset consumer group position on',
            field: ['streamSelector', 'streamManual'],
            core: true,
          },
        ],
        oci_streaming_update_stream: [
          { text: 'Update', field: ['streamSelector', 'streamManual'], core: true },
        ],
        oci_streaming_update_stream_pool: [
          { text: 'Update', field: ['streamPoolSelector', 'streamPoolManual'], core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      value: () => 'oci_streaming_list_streams',
      options: [
        { label: 'Change Stream Compartment', id: 'oci_streaming_change_stream_compartment' },
        {
          label: 'Change Stream Pool Compartment',
          id: 'oci_streaming_change_stream_pool_compartment',
        },
        { label: 'Consumer Commit', id: 'oci_streaming_consumer_commit' },
        { label: 'Consumer Heartbeat', id: 'oci_streaming_consumer_heartbeat' },
        { label: 'Create Cursor', id: 'oci_streaming_create_cursor' },
        { label: 'Create Group Cursor', id: 'oci_streaming_create_group_cursor' },
        { label: 'Create Stream', id: 'oci_streaming_create_stream' },
        { label: 'Create Stream Pool', id: 'oci_streaming_create_stream_pool' },
        { label: 'Delete Stream', id: 'oci_streaming_delete_stream' },
        { label: 'Delete Stream Pool', id: 'oci_streaming_delete_stream_pool' },
        { label: 'Get Group', id: 'oci_streaming_get_group' },
        { label: 'Get Messages', id: 'oci_streaming_get_messages' },
        { label: 'Get Stream', id: 'oci_streaming_get_stream' },
        { label: 'Get Stream Pool', id: 'oci_streaming_get_stream_pool' },
        { label: 'Get Work Request', id: 'oci_streaming_get_work_request' },
        { label: 'List Stream Pools', id: 'oci_streaming_list_stream_pools' },
        { label: 'List Streams', id: 'oci_streaming_list_streams' },
        { label: 'List Work Request Errors', id: 'oci_streaming_list_work_request_errors' },
        { label: 'List Work Request Logs', id: 'oci_streaming_list_work_request_logs' },
        { label: 'List Work Requests', id: 'oci_streaming_list_work_requests' },
        { label: 'Put Messages', id: 'oci_streaming_put_messages' },
        { label: 'Update Group', id: 'oci_streaming_update_group' },
        { label: 'Update Stream', id: 'oci_streaming_update_stream' },
        { label: 'Update Stream Pool', id: 'oci_streaming_update_stream_pool' },
      ],
    },
    {
      id: 'ociCredentialSelector',
      title: 'OCI Account',
      type: 'oauth-input',
      serviceId: 'oci-streaming',
      credentialKind: 'service-account',
      requiredScopes: getScopesForService('oci-streaming'),
      canonicalParamId: 'ociCredential',
      mode: 'basic',
      required: true,
      placeholder: 'Select OCI signing-key credential',
    },
    {
      id: 'ociCredentialManual',
      title: 'OCI Account',
      type: 'short-input',
      canonicalParamId: 'ociCredential',
      mode: 'advanced',
      required: true,
      placeholder: 'Enter credential ID',
    },
    {
      id: 'ociRegion',
      title: 'Region',
      type: 'short-input',
      placeholder: 'Credential region by default (e.g. us-ashburn-1)',
    },
    {
      id: 'compartmentId',
      title: 'Compartment',
      type: 'short-input',
      placeholder: 'Compartment OCID; list/create streams use this when no pool is selected',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_change_stream_compartment',
          'oci_streaming_change_stream_pool_compartment',
          'oci_streaming_consumer_commit',
          'oci_streaming_consumer_heartbeat',
          'oci_streaming_create_cursor',
          'oci_streaming_create_group_cursor',
          'oci_streaming_create_stream',
          'oci_streaming_create_stream_pool',
          'oci_streaming_delete_stream',
          'oci_streaming_delete_stream_pool',
          'oci_streaming_get_group',
          'oci_streaming_get_messages',
          'oci_streaming_get_stream',
          'oci_streaming_get_stream_pool',
          'oci_streaming_list_stream_pools',
          'oci_streaming_list_streams',
          'oci_streaming_list_work_requests',
          'oci_streaming_put_messages',
          'oci_streaming_update_group',
          'oci_streaming_update_stream',
          'oci_streaming_update_stream_pool',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_streaming_create_stream_pool',
          'oci_streaming_list_stream_pools',
          'oci_streaming_list_work_requests',
        ],
      },
    },
    {
      id: 'streamPoolSelector',
      title: 'Stream Pool',
      type: 'dropdown',
      canonicalParamId: 'streamPoolId',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_change_stream_compartment',
          'oci_streaming_change_stream_pool_compartment',
          'oci_streaming_consumer_commit',
          'oci_streaming_consumer_heartbeat',
          'oci_streaming_create_cursor',
          'oci_streaming_create_group_cursor',
          'oci_streaming_create_stream',
          'oci_streaming_delete_stream',
          'oci_streaming_delete_stream_pool',
          'oci_streaming_get_group',
          'oci_streaming_get_messages',
          'oci_streaming_get_stream',
          'oci_streaming_get_stream_pool',
          'oci_streaming_list_streams',
          'oci_streaming_put_messages',
          'oci_streaming_update_group',
          'oci_streaming_update_stream',
          'oci_streaming_update_stream_pool',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_streaming_change_stream_pool_compartment',
          'oci_streaming_delete_stream_pool',
          'oci_streaming_get_stream_pool',
          'oci_streaming_update_stream_pool',
        ],
      },
      placeholder: 'Select stream pool',
      selectorKey: 'oci_streaming.streamPools',
      dependsOn: { all: ['ociCredential', 'compartmentId'], any: ['ociCredential', 'ociRegion'] },
    },
    {
      id: 'streamPoolManual',
      title: 'Stream Pool',
      type: 'short-input',
      canonicalParamId: 'streamPoolId',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_change_stream_compartment',
          'oci_streaming_change_stream_pool_compartment',
          'oci_streaming_consumer_commit',
          'oci_streaming_consumer_heartbeat',
          'oci_streaming_create_cursor',
          'oci_streaming_create_group_cursor',
          'oci_streaming_create_stream',
          'oci_streaming_delete_stream',
          'oci_streaming_delete_stream_pool',
          'oci_streaming_get_group',
          'oci_streaming_get_messages',
          'oci_streaming_get_stream',
          'oci_streaming_get_stream_pool',
          'oci_streaming_list_streams',
          'oci_streaming_put_messages',
          'oci_streaming_update_group',
          'oci_streaming_update_stream',
          'oci_streaming_update_stream_pool',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_streaming_change_stream_pool_compartment',
          'oci_streaming_delete_stream_pool',
          'oci_streaming_get_stream_pool',
          'oci_streaming_update_stream_pool',
        ],
      },
      placeholder: 'Enter OCID for stream pool',
    },
    {
      id: 'streamSelector',
      title: 'Stream',
      type: 'dropdown',
      canonicalParamId: 'streamId',
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_change_stream_compartment',
          'oci_streaming_consumer_commit',
          'oci_streaming_consumer_heartbeat',
          'oci_streaming_create_cursor',
          'oci_streaming_create_group_cursor',
          'oci_streaming_delete_stream',
          'oci_streaming_get_group',
          'oci_streaming_get_messages',
          'oci_streaming_get_stream',
          'oci_streaming_put_messages',
          'oci_streaming_update_group',
          'oci_streaming_update_stream',
        ],
      },
      required: true,
      placeholder: 'Select stream',
      selectorKey: 'oci_streaming.streams',
      dependsOn: { all: ['ociCredential', 'streamPoolId'], any: ['ociCredential', 'ociRegion'] },
    },
    {
      id: 'streamManual',
      title: 'Stream',
      type: 'short-input',
      canonicalParamId: 'streamId',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_change_stream_compartment',
          'oci_streaming_consumer_commit',
          'oci_streaming_consumer_heartbeat',
          'oci_streaming_create_cursor',
          'oci_streaming_create_group_cursor',
          'oci_streaming_delete_stream',
          'oci_streaming_get_group',
          'oci_streaming_get_messages',
          'oci_streaming_get_stream',
          'oci_streaming_put_messages',
          'oci_streaming_update_group',
          'oci_streaming_update_stream',
        ],
      },
      required: true,
      placeholder: 'Enter OCID for stream',
    },
    {
      id: 'destinationCompartmentId',
      title: 'Destination Compartment',
      type: 'short-input',
      placeholder: 'Destination compartment OCID',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_change_stream_compartment',
          'oci_streaming_change_stream_pool_compartment',
        ],
      },
    },
    {
      id: 'destinationStreamPoolId',
      title: 'Destination Stream Pool',
      type: 'short-input',
      placeholder: 'Optional destination pool OCID for a stream move',
      mode: 'advanced',
      condition: { field: 'operation', value: 'oci_streaming_update_stream' },
    },
    {
      id: 'ifMatch',
      title: 'If Match',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_change_stream_compartment',
          'oci_streaming_change_stream_pool_compartment',
          'oci_streaming_delete_stream',
          'oci_streaming_delete_stream_pool',
          'oci_streaming_update_stream',
          'oci_streaming_update_stream_pool',
        ],
      },
      mode: 'advanced',
      placeholder:
        'Optional ETag for optimistic concurrency. A mismatch fails without overwriting the resource.',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_consumer_commit',
          'oci_streaming_consumer_heartbeat',
          'oci_streaming_get_messages',
        ],
      },
      required: true,
      placeholder:
        'Opaque cursor, expiring after five minutes. Use the latest read, commit, or heartbeat cursor; never decode or recreate it automatically.',
    },
    {
      id: 'partition',
      title: 'Partition',
      type: 'short-input',
      condition: { field: 'operation', value: ['oci_streaming_create_cursor'] },
      required: true,
      placeholder:
        'Partition identifier as a non-negative decimal string. Offsets are local to this partition.',
    },
    {
      id: 'type',
      title: 'Cursor Position',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_create_cursor',
          'oci_streaming_create_group_cursor',
          'oci_streaming_update_group',
        ],
      },
      required: true,
      options: (params) =>
        (params?.values.operation === 'oci_streaming_create_cursor'
          ? ['AFTER_OFFSET', 'AT_OFFSET', 'AT_TIME', 'LATEST', 'TRIM_HORIZON']
          : ['AT_TIME', 'LATEST', 'TRIM_HORIZON']
        ).map((id) => ({ label: id, id })),
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_streaming_create_cursor'],
        and: { field: 'type', value: ['AT_OFFSET', 'AFTER_OFFSET'] },
      },
      required: true,
      placeholder:
        'Non-negative signed 64-bit offset as a decimal string; never use a JavaScript number. Required for AT_OFFSET and AFTER_OFFSET.',
    },
    {
      id: 'time',
      title: 'Time',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_create_cursor',
          'oci_streaming_create_group_cursor',
          'oci_streaming_update_group',
        ],
        and: { field: 'type', value: ['AT_TIME'] },
      },
      required: true,
      placeholder: 'RFC 3339 timestamp, required only for AT_TIME.',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Return ONLY an RFC 3339 timestamp.',
      },
    },
    {
      id: 'groupName',
      title: 'Group Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_create_group_cursor',
          'oci_streaming_get_group',
          'oci_streaming_update_group',
        ],
      },
      required: true,
      placeholder:
        'Consumer group name. Creating a group cursor joins the group and may rebalance partitions.',
    },
    {
      id: 'instanceName',
      title: 'Instance Name',
      type: 'short-input',
      condition: { field: 'operation', value: ['oci_streaming_create_group_cursor'] },
      mode: 'advanced',
      placeholder:
        'Consumer instance name. Oracle generates one if omitted. Reuse deliberately for an existing instance.',
    },
    {
      id: 'timeoutInMs',
      title: 'Timeout In Ms',
      type: 'short-input',
      condition: { field: 'operation', value: ['oci_streaming_create_group_cursor'] },
      mode: 'advanced',
      placeholder:
        'Group member timeout in milliseconds, at least 5,000; Oracle defaults to 30,000.',
    },
    {
      id: 'commitOnGet',
      title: 'Commit On Get',
      type: 'switch',
      condition: { field: 'operation', value: ['oci_streaming_create_group_cursor'] },
      mode: 'advanced',
      defaultValue: false,
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_create_stream',
          'oci_streaming_create_stream_pool',
          'oci_streaming_list_stream_pools',
          'oci_streaming_list_streams',
          'oci_streaming_update_stream_pool',
        ],
      },
      required: {
        field: 'operation',
        value: ['oci_streaming_create_stream', 'oci_streaming_create_stream_pool'],
      },
      placeholder: 'Resource name; list operations match the exact name.',
    },
    {
      id: 'partitions',
      title: 'Partitions',
      type: 'short-input',
      condition: { field: 'operation', value: ['oci_streaming_create_stream'] },
      required: true,
      placeholder: 'Positive partition count. Cannot be changed after stream creation.',
    },
    {
      id: 'retentionInHours',
      title: 'Retention In Hours',
      type: 'short-input',
      condition: { field: 'operation', value: ['oci_streaming_create_stream'] },
      mode: 'advanced',
      placeholder:
        'Retention in hours, 24 to 168; Oracle defaults to 24. Cannot be changed after creation.',
    },
    {
      id: 'freeformTags',
      title: 'Freeform Tags',
      type: 'code',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_create_stream',
          'oci_streaming_create_stream_pool',
          'oci_streaming_update_stream',
          'oci_streaming_update_stream_pool',
        ],
      },
      mode: 'advanced',
      language: 'json',
      placeholder: '{}',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Freeform tag object. Update replaces tags; an empty object clears them. Return ONLY the JSON.',
      },
    },
    {
      id: 'definedTags',
      title: 'Defined Tags',
      type: 'code',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_create_stream',
          'oci_streaming_create_stream_pool',
          'oci_streaming_update_stream',
          'oci_streaming_update_stream_pool',
        ],
      },
      mode: 'advanced',
      language: 'json',
      placeholder: '{}',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Defined tags keyed by namespace and tag name, with string values. Return ONLY the JSON.',
      },
    },
    {
      id: 'customEncryptionKeyDetails',
      title: 'Custom Encryption Key Details',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['oci_streaming_create_stream_pool', 'oci_streaming_update_stream_pool'],
      },
      mode: 'advanced',
      language: 'json',
      placeholder: '{}',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Customer-managed encryption key object: {"kmsKeyId":"ocid1.key..."}. Requires the appropriate KMS permissions. Return ONLY the JSON.',
      },
    },
    {
      id: 'kafkaSettings',
      title: 'Kafka Settings',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['oci_streaming_create_stream_pool', 'oci_streaming_update_stream_pool'],
      },
      mode: 'advanced',
      language: 'json',
      placeholder: '{}',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Native REST pool configuration: autoCreateTopicsEnable, logRetentionHours (1–672), numPartitions (positive). Does not establish Kafka access. Return ONLY the JSON.',
      },
    },
    {
      id: 'retryToken',
      title: 'Retry Token',
      type: 'short-input',
      condition: { field: 'operation', value: ['oci_streaming_create_stream_pool'] },
      mode: 'advanced',
      placeholder:
        'CreateStreamPool only: explicit idempotency token, up to 255 characters. Enables at most two attempts with identical bytes and token.',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_get_messages',
          'oci_streaming_list_stream_pools',
          'oci_streaming_list_streams',
          'oci_streaming_list_work_request_errors',
          'oci_streaming_list_work_request_logs',
          'oci_streaming_list_work_requests',
        ],
      },
      mode: 'advanced',
      placeholder: 'Admin: default 10, max 50. Messages: default 100, max 1,000.',
    },
    {
      id: 'workRequestId',
      title: 'Work Request ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_get_work_request',
          'oci_streaming_list_work_request_errors',
          'oci_streaming_list_work_request_logs',
          'oci_streaming_list_work_requests',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oci_streaming_get_work_request',
          'oci_streaming_list_work_request_errors',
          'oci_streaming_list_work_request_logs',
        ],
      },
      placeholder: 'Asynchronous work request OCID.',
    },
    {
      id: 'id',
      title: 'ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['oci_streaming_list_stream_pools', 'oci_streaming_list_streams'],
      },
      mode: 'advanced',
      placeholder: 'Filter by resource OCID.',
    },
    {
      id: 'lifecycleState',
      title: 'Lifecycle State',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['oci_streaming_list_stream_pools', 'oci_streaming_list_streams'],
      },
      mode: 'advanced',
      options: [
        { label: 'CREATING', id: 'CREATING' },
        { label: 'ACTIVE', id: 'ACTIVE' },
        { label: 'DELETING', id: 'DELETING' },
        { label: 'DELETED', id: 'DELETED' },
        { label: 'FAILED', id: 'FAILED' },
        { label: 'UPDATING', id: 'UPDATING' },
      ],
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_list_stream_pools',
          'oci_streaming_list_streams',
          'oci_streaming_list_work_request_errors',
          'oci_streaming_list_work_request_logs',
          'oci_streaming_list_work_requests',
        ],
      },
      mode: 'advanced',
      placeholder:
        'Opaque nextPage from a previous administrative list. This is not a message cursor.',
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_list_stream_pools',
          'oci_streaming_list_streams',
          'oci_streaming_list_work_requests',
        ],
      },
      mode: 'advanced',
      options: (params) =>
        (params?.values.operation === 'oci_streaming_list_work_requests'
          ? ['TIMEACCEPTED']
          : ['NAME', 'TIMECREATED']
        ).map((id) => ({ label: id, id })),
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_list_stream_pools',
          'oci_streaming_list_streams',
          'oci_streaming_list_work_requests',
        ],
      },
      mode: 'advanced',
      options: [
        { label: 'ASC', id: 'ASC' },
        { label: 'DESC', id: 'DESC' },
      ],
    },
    {
      id: 'resourceId',
      title: 'Resource ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['oci_streaming_list_work_requests'] },
      mode: 'advanced',
      placeholder: 'Filter work requests by affected resource OCID.',
    },
    {
      id: 'messages',
      title: 'Messages',
      type: 'code',
      condition: { field: 'operation', value: ['oci_streaming_put_messages'] },
      required: true,
      language: 'json',
      placeholder: '[{"key":"order-42","value":"approved"}]',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Ordered array of key/value messages. Maximum 1,000 entries and 1 MiB decoded keys plus values. Keys at most 256 bytes. Values must be nonempty. Return ONLY the JSON.',
      },
    },
    {
      id: 'encoding',
      title: 'Encoding',
      type: 'dropdown',
      condition: { field: 'operation', value: ['oci_streaming_put_messages'] },
      options: [
        { label: 'utf-8', id: 'utf-8' },
        { label: 'base64', id: 'base64' },
      ],
      value: () => 'utf-8',
    },
    {
      id: 'requestId',
      title: 'Request ID',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Optional Oracle request identifier',
    },
  ],
  tools: {
    access: [
      'oci_streaming_change_stream_compartment',
      'oci_streaming_change_stream_pool_compartment',
      'oci_streaming_consumer_commit',
      'oci_streaming_consumer_heartbeat',
      'oci_streaming_create_cursor',
      'oci_streaming_create_group_cursor',
      'oci_streaming_create_stream',
      'oci_streaming_create_stream_pool',
      'oci_streaming_delete_stream',
      'oci_streaming_delete_stream_pool',
      'oci_streaming_get_group',
      'oci_streaming_get_messages',
      'oci_streaming_get_stream',
      'oci_streaming_get_stream_pool',
      'oci_streaming_get_work_request',
      'oci_streaming_list_stream_pools',
      'oci_streaming_list_streams',
      'oci_streaming_list_work_request_errors',
      'oci_streaming_list_work_request_logs',
      'oci_streaming_list_work_requests',
      'oci_streaming_put_messages',
      'oci_streaming_update_group',
      'oci_streaming_update_stream',
      'oci_streaming_update_stream_pool',
    ],
    config: {
      tool: (params) => params.operation || 'oci_streaming_list_streams',
      params: (params) => {
        const result: Record<string, unknown> = {}
        for (const key of [
          'streamId',
          'compartmentId',
          'ifMatch',
          'streamPoolId',
          'cursor',
          'partition',
          'type',
          'offset',
          'time',
          'groupName',
          'instanceName',
          'name',
          'retryToken',
          'workRequestId',
          'id',
          'lifecycleState',
          'page',
          'sortBy',
          'sortOrder',
          'resourceId',
          'encoding',
          'ociRegion',
          'requestId',
        ]) {
          result[key] = params[key] === '' ? undefined : params[key]
        }
        result.partitions = parseOptionalNumberInput(params.partitions, 'partitions')
        result.retentionInHours = parseOptionalNumberInput(
          params.retentionInHours,
          'retentionInHours'
        )
        result.limit = parseOptionalNumberInput(params.limit, 'limit')
        result.timeoutInMs = parseOptionalNumberInput(params.timeoutInMs, 'timeoutInMs')
        for (const key of [
          'freeformTags',
          'definedTags',
          'customEncryptionKeyDetails',
          'kafkaSettings',
          'messages',
        ]) {
          const value = params[key]
          result[key] =
            value === '' || value == null
              ? undefined
              : typeof value === 'string'
                ? JSON.parse(value)
                : value
        }
        if (params.commitOnGet !== undefined && params.commitOnGet !== '') {
          if (
            params.commitOnGet !== true &&
            params.commitOnGet !== false &&
            params.commitOnGet !== 'true' &&
            params.commitOnGet !== 'false'
          ) {
            throw new Error('Commit on Get must be true or false')
          }
          result.commitOnGet = params.commitOnGet === true || params.commitOnGet === 'true'
        }
        if (
          params.operation === 'oci_streaming_list_streams' ||
          params.operation === 'oci_streaming_create_stream'
        ) {
          if (result.streamPoolId) result.compartmentId = undefined
        }
        if (params.operation === 'oci_streaming_update_stream')
          result.streamPoolId = params.destinationStreamPoolId || undefined
        if (
          params.operation === 'oci_streaming_change_stream_compartment' ||
          params.operation === 'oci_streaming_change_stream_pool_compartment'
        ) {
          result.compartmentId = params.destinationCompartmentId
        }
        return result
      },
    },
  },
  inputs: {
    ociCredential: { type: 'string', description: 'Reusable OCI API signing-key credential ID.' },
    ociRegion: { type: 'string', description: 'Optional region override.' },
    requestId: { type: 'string', description: 'Optional Oracle request identifier.' },
    destinationCompartmentId: {
      type: 'string',
      description: 'Destination compartment for a move.',
    },
    destinationStreamPoolId: {
      type: 'string',
      description: 'Destination pool when moving a stream.',
    },
    streamId: {
      type: 'string',
      description:
        'Stream OCID. Message operations also require GetStream permission for authenticated endpoint discovery.',
    },
    compartmentId: {
      type: 'string',
      description:
        'Compartment OCID. For list/create stream, supply exactly one of compartmentId or streamPoolId.',
    },
    ifMatch: {
      type: 'string',
      description:
        'Optional ETag for optimistic concurrency. A mismatch fails without overwriting the resource.',
    },
    streamPoolId: {
      type: 'string',
      description: 'Stream pool OCID. For update stream, the destination pool.',
    },
    cursor: {
      type: 'string',
      description:
        'Opaque cursor, expiring after five minutes. Use the latest read, commit, or heartbeat cursor; never decode or recreate it automatically.',
    },
    partition: {
      type: 'string',
      description:
        'Partition identifier as a non-negative decimal string. Offsets are local to this partition.',
    },
    type: {
      type: 'string',
      description:
        'Cursor position: AT_TIME, LATEST, or TRIM_HORIZON; individual cursors also support AT_OFFSET and AFTER_OFFSET.',
    },
    offset: {
      type: 'string',
      description:
        'Non-negative signed 64-bit offset as a decimal string; never use a JavaScript number. Required for AT_OFFSET and AFTER_OFFSET.',
    },
    time: { type: 'string', description: 'RFC 3339 timestamp, required only for AT_TIME.' },
    groupName: {
      type: 'string',
      description:
        'Consumer group name. Creating a group cursor joins the group and may rebalance partitions.',
    },
    instanceName: {
      type: 'string',
      description:
        'Consumer instance name. Oracle generates one if omitted. Reuse deliberately for an existing instance.',
    },
    timeoutInMs: {
      type: 'number',
      description:
        'Group member timeout in milliseconds, at least 5,000; Oracle defaults to 30,000.',
    },
    commitOnGet: {
      type: 'boolean',
      description:
        'Default false. True permits subsequent reads to commit prior batches automatically; use only when that behavior is intended.',
    },
    name: { type: 'string', description: 'Resource name; list operations match the exact name.' },
    partitions: {
      type: 'number',
      description: 'Positive partition count. Cannot be changed after stream creation.',
    },
    retentionInHours: {
      type: 'number',
      description:
        'Retention in hours, 24 to 168; Oracle defaults to 24. Cannot be changed after creation.',
    },
    freeformTags: {
      type: 'json',
      description: 'Freeform tag object. Update replaces tags; an empty object clears them.',
    },
    definedTags: {
      type: 'json',
      description: 'Defined tags keyed by namespace and tag name, with string values.',
    },
    customEncryptionKeyDetails: {
      type: 'json',
      description:
        'Customer-managed encryption key object: {"kmsKeyId":"ocid1.key..."}. Requires the appropriate KMS permissions.',
    },
    kafkaSettings: {
      type: 'json',
      description:
        'Native REST pool configuration: autoCreateTopicsEnable, logRetentionHours (1–672), numPartitions (positive). Does not establish Kafka access.',
    },
    retryToken: {
      type: 'string',
      description:
        'CreateStreamPool only: explicit idempotency token, up to 255 characters. Enables at most two attempts with identical bytes and token.',
    },
    limit: {
      type: 'number',
      description:
        'One administrative page: default 10, maximum 50. Message reads: default 100, maximum 1,000.',
    },
    workRequestId: { type: 'string', description: 'Asynchronous work request OCID.' },
    id: { type: 'string', description: 'Filter by resource OCID.' },
    lifecycleState: {
      type: 'string',
      description: 'CREATING, ACTIVE, DELETING, DELETED, FAILED, or UPDATING.',
    },
    page: {
      type: 'string',
      description:
        'Opaque nextPage from a previous administrative list. This is not a message cursor.',
    },
    sortBy: {
      type: 'string',
      description: 'NAME or TIMECREATED for resources; TIMEACCEPTED for work requests.',
    },
    sortOrder: { type: 'string', description: 'ASC or DESC.' },
    resourceId: { type: 'string', description: 'Filter work requests by affected resource OCID.' },
    messages: {
      type: 'json',
      description:
        'Ordered array of key/value messages. Maximum 1,000 entries and 1 MiB decoded keys plus values. Keys at most 256 bytes. Values must be nonempty.',
    },
    encoding: {
      type: 'string',
      description: 'Encoding of every key and value: utf-8 (default) or canonical padded base64.',
    },
  },
  outputs: {
    status: {
      type: 'number',
      description: 'HTTP status; acceptance is not asynchronous completion.',
    },
    requestId: { type: 'string', description: 'Oracle request identifier.' },
    etag: { type: 'string', description: 'Resource ETag when returned.' },
    workRequestId: { type: 'string', description: 'Asynchronous work request OCID when returned.' },
    nextPage: {
      type: 'string',
      description: 'Administrative continuation token, or null on the last page.',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_list_stream_pools',
          'oci_streaming_list_work_request_errors',
          'oci_streaming_list_work_request_logs',
          'oci_streaming_list_streams',
          'oci_streaming_list_work_requests',
        ],
      },
    },
    streams: {
      type: 'json',
      description:
        'Stream summaries: id, name, pool, compartment, partitions, lifecycle, endpoint and tags.',
      condition: { field: 'operation', value: ['oci_streaming_list_streams'] },
    },
    stream: {
      type: 'json',
      description: 'Stream configuration including retention and lifecycle details.',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_get_stream',
          'oci_streaming_create_stream',
          'oci_streaming_update_stream',
        ],
      },
    },
    streamPools: {
      type: 'json',
      description: 'Pool summaries: id, name, compartment, lifecycle, tags and privacy.',
      condition: { field: 'operation', value: ['oci_streaming_list_stream_pools'] },
    },
    streamPool: {
      type: 'json',
      description:
        'Pool configuration, encryption, Kafka settings and read-only endpoint settings.',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_get_stream_pool',
          'oci_streaming_create_stream_pool',
          'oci_streaming_update_stream_pool',
        ],
      },
    },
    messages: {
      type: 'json',
      description:
        'One batch of stream, partition, base64 key/value, decimal offset and timestamp entries.',
      condition: { field: 'operation', value: ['oci_streaming_get_messages'] },
    },
    nextCursor: {
      type: 'string',
      description: 'Next opaque message cursor, including for an empty batch.',
      condition: { field: 'operation', value: ['oci_streaming_get_messages'] },
    },
    cursor: {
      type: 'string',
      description: 'New or replacement opaque cursor.',
      condition: {
        field: 'operation',
        value: [
          'oci_streaming_create_cursor',
          'oci_streaming_create_group_cursor',
          'oci_streaming_consumer_commit',
          'oci_streaming_consumer_heartbeat',
        ],
      },
    },
    entries: {
      type: 'json',
      description: 'Ordered publish results: offset/partition/timestamp or error/errorMessage.',
      condition: { field: 'operation', value: ['oci_streaming_put_messages'] },
    },
    failures: {
      type: 'number',
      description: 'Failed publish entry count.',
      condition: { field: 'operation', value: ['oci_streaming_put_messages'] },
    },
    allSucceeded: {
      type: 'boolean',
      description: 'Whether every publish entry succeeded.',
      condition: { field: 'operation', value: ['oci_streaming_put_messages'] },
    },
    group: {
      type: 'json',
      description:
        'Group streamId, groupName and partition reservations with decimal committedOffset.',
      condition: { field: 'operation', value: ['oci_streaming_get_group'] },
    },
    workRequests: {
      type: 'json',
      description: 'Work requests with status, progress, resources and timestamps.',
      condition: { field: 'operation', value: ['oci_streaming_list_work_requests'] },
    },
    workRequest: {
      type: 'json',
      description: 'Work request status, progress, resources and timestamps.',
      condition: { field: 'operation', value: ['oci_streaming_get_work_request'] },
    },
    errors: {
      type: 'json',
      description: 'Error code, message and timestamp entries.',
      condition: { field: 'operation', value: ['oci_streaming_list_work_request_errors'] },
    },
    logs: {
      type: 'json',
      description: 'Log message and timestamp entries.',
      condition: { field: 'operation', value: ['oci_streaming_list_work_request_logs'] },
    },
  },
}

export const OciStreamingBlockMeta = {
  tags: ['cloud', 'messaging', 'automation'],
  url: 'https://www.oracle.com/cloud/streaming/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Publish order events',
      prompt:
        'When an order is approved, encode its ID and status, publish one bounded batch, and branch on allSucceeded while retaining every per-message result.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Sample application telemetry',
      prompt:
        'On a manual run, create a partition cursor at a timestamp, read at most 100 telemetry messages, decode their values in a Function block, and return an error-rate summary.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Process one consumer batch',
      prompt:
        'On a manual run, join a group with commitOnGet false, read one batch, process every message idempotently, then commit the read nextCursor only after the entire batch succeeds.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Inventory stream pools',
      prompt:
        'On a scheduled run, list one bounded page of pools, list a bounded page of streams for selected pools, and store lifecycle and partition counts in a table.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Inspect provisioning failures',
      prompt:
        'Given a work request ID, get its status, fetch one page of errors and logs if it failed, and return an operations report without resubmitting the mutation.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Replay retained events',
      prompt:
        'On a manual recovery run, create an individual partition cursor AFTER_OFFSET using a saved decimal offset, read one batch, and deduplicate processing by stream/partition/offset.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Inspect consumer reservations',
      prompt:
        'On a manual diagnostic run, get a consumer group and summarize partition reservations and committed decimal offsets without resetting the group.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
  ],
  skills: [
    {
      name: 'publish-application-events',
      description: 'Publish one bounded batch of application events.',
      content:
        '# Publish Application Events\n\n## Steps\n1. Encode one batch as UTF-8 or base64 within the decoded byte limit.\n2. Call Put Messages once.\n3. Inspect allSucceeded and ordered entries. Preserve successes; never replay the whole batch automatically.\n\n## Output\nReturn the bounded result, continuation cursor or work request status and any failures.',
    },
    {
      name: 'sample-stream-telemetry',
      description: 'Sample retained telemetry with an individual cursor.',
      content:
        '# Sample Stream Telemetry\n\n## Steps\n1. Choose a partition and AT_TIME or exact decimal offset.\n2. Create Cursor, then Get Messages once.\n3. Return nextCursor even for an empty batch. Never automatically recreate an expired cursor.\n\n## Output\nReturn the bounded result, continuation cursor or work request status and any failures.',
    },
    {
      name: 'consume-with-manual-commits',
      description: 'Process one group batch with explicit commits.',
      content:
        '# Consume With Manual Commits\n\n## Steps\n1. Create Group Cursor with commitOnGet false. Existing groups retain their committed position.\n2. Read one bounded batch and process every item idempotently.\n3. Commit the read nextCursor only after the whole batch succeeds.\n4. Retain replacement cursors from commit or explicitly invoked heartbeat. Do not start a background loop.\n\n## Output\nReturn the bounded result, continuation cursor or work request status and any failures.',
    },
    {
      name: 'inspect-stream-provisioning',
      description: 'Inspect asynchronous stream or pool provisioning.',
      content:
        '# Inspect Stream Provisioning\n\n## Steps\n1. Retain workRequestId from a mutation.\n2. Get Work Request once; acceptance is not completion.\n3. List errors and logs for a failure.\n4. Report permission failures without inventing work-request IAM permission names.\n\n## Output\nReturn the bounded result, continuation cursor or work request status and any failures.',
    },
    {
      name: 'replay-retained-partition-events',
      description: 'Replay retained events after an exact checkpoint.',
      content:
        '# Replay Retained Partition Events\n\n## Steps\n1. Use a partition-local decimal offset with AFTER_OFFSET.\n2. Create an individual cursor and read one batch.\n3. Keep offsets as strings and deduplicate downstream. Retention still limits history.\n\n## Output\nReturn the bounded result, continuation cursor or work request status and any failures.',
    },
    {
      name: 'inspect-consumer-reservations',
      description: 'Diagnose assignments and committed positions.',
      content:
        '# Inspect Consumer Reservations\n\n## Steps\n1. Get Group for the stream and group.\n2. Report partition reservations and committed decimal offsets.\n3. Use Update Group only for an explicitly requested reset affecting all consumers; joining alone never resets an existing group.\n\n## Output\nReturn the bounded result, continuation cursor or work request status and any failures.',
    },
  ],
} as const satisfies BlockMeta
