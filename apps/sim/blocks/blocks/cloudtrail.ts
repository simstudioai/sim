import { CloudTrailIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type {
  CloudTrailCancelQueryResponse,
  CloudTrailDescribeQueryResponse,
  CloudTrailDescribeTrailsResponse,
  CloudTrailGetEventDataStoreResponse,
  CloudTrailGetEventSelectorsResponse,
  CloudTrailGetInsightSelectorsResponse,
  CloudTrailGetQueryResultsResponse,
  CloudTrailGetTrailResponse,
  CloudTrailGetTrailStatusResponse,
  CloudTrailListEventDataStoresResponse,
  CloudTrailListTagsResponse,
  CloudTrailListTrailsResponse,
  CloudTrailLookupEventsResponse,
  CloudTrailStartQueryResponse,
} from '@/tools/cloudtrail/types'

/** Operations that accept an opaque AWS pagination token. */
const PAGINATED_OPERATIONS = [
  'lookup_events',
  'list_trails',
  'get_query_results',
  'list_event_data_stores',
  'list_tags',
]

/** Operations addressed by a single trail name or trail ARN. */
const TRAIL_SCOPED_OPERATIONS = [
  'get_trail',
  'get_trail_status',
  'get_event_selectors',
  'get_insight_selectors',
]

function parseBoundedInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

export const CloudTrailBlock: BlockConfig<
  | CloudTrailLookupEventsResponse
  | CloudTrailDescribeTrailsResponse
  | CloudTrailGetTrailResponse
  | CloudTrailGetTrailStatusResponse
  | CloudTrailListTrailsResponse
  | CloudTrailGetEventSelectorsResponse
  | CloudTrailGetInsightSelectorsResponse
  | CloudTrailStartQueryResponse
  | CloudTrailDescribeQueryResponse
  | CloudTrailGetQueryResultsResponse
  | CloudTrailCancelQueryResponse
  | CloudTrailListEventDataStoresResponse
  | CloudTrailGetEventDataStoreResponse
  | CloudTrailListTagsResponse
> = {
  type: 'cloudtrail',
  name: 'CloudTrail',
  description: 'Audit who did what in AWS with CloudTrail event history and Lake queries',
  longDescription:
    'Integrate AWS CloudTrail into workflows. Look up the last 90 days of management and Insights events by user, event name, resource, or access key; inspect trail configuration, logging status, and event selectors; and run SQL queries against CloudTrail Lake event data stores. This block never changes trail or event data store configuration, and never starts or stops logging. Starting and cancelling a Lake query are the only actions that are not reads, and AWS bills Lake queries on the data they scan. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/cloudtrail',
  category: 'tools',
  integrationType: IntegrationType.Security,
  authMode: AuthMode.ApiKey,
  bgColor: 'linear-gradient(45deg, #B0084D 0%, #FF4F8B 100%)',
  iconColor: '#FF4F8B',
  icon: CloudTrailIcon,
  canvasPresentation: {
    defaultTitle: 'CloudTrail',
    sentences: {
      byOperation: {
        lookup_events: [
          'Look up CloudTrail events',
          { text: 'where', field: 'attributeKey' },
          { text: 'is', field: 'attributeValue', core: true },
          { text: ', since', field: 'startTime' },
          { text: ', up to', field: 'lookupMaxResults', after: 'events' },
        ],
        describe_trails: [
          'Describe trails',
          { text: ', limited to', field: 'trailNameList', core: true },
        ],
        get_trail: [{ text: 'Read the settings of trail', field: 'trailName', core: true }],
        get_trail_status: [
          { text: 'Check the logging status of trail', field: 'trailName', core: true },
        ],
        list_trails: ['List every CloudTrail trail'],
        get_event_selectors: [
          { text: 'Read the event selectors of trail', field: 'trailName', core: true },
        ],
        get_insight_selectors: [
          'Read Insights selectors',
          { text: 'for trail', field: 'trailName', core: true },
          { text: 'for event data store', field: 'eventDataStore' },
        ],
        start_query: [
          { text: 'Run the CloudTrail Lake query', field: 'queryStatement', core: true },
          { text: 'using template', field: 'queryAlias' },
        ],
        describe_query: [
          { text: 'Check the status of Lake query', field: 'queryId', core: true },
          { text: 'for template', field: 'queryAlias' },
        ],
        get_query_results: [
          { text: 'Fetch the results of Lake query', field: 'queryId', core: true },
          { text: ', up to', field: 'maxQueryResults', after: 'rows' },
        ],
        cancel_query: [{ text: 'Cancel Lake query', field: 'queryId', core: true }],
        list_event_data_stores: [
          'List CloudTrail Lake event data stores',
          { text: ', up to', field: 'eventDataStoreMaxResults' },
        ],
        get_event_data_store: [
          { text: 'Read the event data store', field: 'eventDataStore', core: true },
        ],
        list_tags: [{ text: 'List the tags on', field: 'resourceIdList', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Look Up Events', id: 'lookup_events' },
        { label: 'Describe Trails', id: 'describe_trails' },
        { label: 'Get Trail', id: 'get_trail' },
        { label: 'Get Trail Status', id: 'get_trail_status' },
        { label: 'List Trails', id: 'list_trails' },
        { label: 'Get Event Selectors', id: 'get_event_selectors' },
        { label: 'Get Insight Selectors', id: 'get_insight_selectors' },
        { label: 'Start Lake Query', id: 'start_query' },
        { label: 'Describe Lake Query', id: 'describe_query' },
        { label: 'Get Lake Query Results', id: 'get_query_results' },
        { label: 'Cancel Lake Query', id: 'cancel_query' },
        { label: 'List Event Data Stores', id: 'list_event_data_stores' },
        { label: 'Get Event Data Store', id: 'get_event_data_store' },
        { label: 'List Tags', id: 'list_tags' },
      ],
      value: () => 'lookup_events',
    },
    {
      id: 'awsRegion',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      required: true,
    },
    {
      id: 'awsAccessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      password: true,
      required: true,
    },
    {
      id: 'awsSecretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      placeholder: 'Your secret access key',
      password: true,
      required: true,
    },
    {
      id: 'attributeKey',
      title: 'Filter By',
      type: 'dropdown',
      options: [
        { label: 'User Name', id: 'Username' },
        { label: 'Event Name', id: 'EventName' },
        { label: 'Event Source', id: 'EventSource' },
        { label: 'Event ID', id: 'EventId' },
        { label: 'Resource Name', id: 'ResourceName' },
        { label: 'Resource Type', id: 'ResourceType' },
        { label: 'Access Key ID', id: 'AccessKeyId' },
        { label: 'Read Only', id: 'ReadOnly' },
      ],
      condition: { field: 'operation', value: 'lookup_events' },
    },
    {
      id: 'attributeValue',
      title: 'Filter Value',
      type: 'short-input',
      placeholder: 'e.g., ConsoleLogin, alice, arn:aws:s3:::my-bucket',
      condition: { field: 'operation', value: 'lookup_events' },
    },
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      placeholder: '2026-09-01T00:00:00Z',
      condition: { field: 'operation', value: 'lookup_events' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp with a UTC offset for the start of the requested CloudTrail lookup window. CloudTrail event history only covers the last 90 days. Return ONLY the timestamp string.',
        placeholder: 'Describe the start of the time window...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endTime',
      title: 'End Time',
      type: 'short-input',
      placeholder: '2026-09-04T00:00:00Z',
      condition: { field: 'operation', value: 'lookup_events' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp with a UTC offset for the end of the requested CloudTrail lookup window. Return ONLY the timestamp string.',
        placeholder: 'Describe the end of the time window...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'eventCategory',
      title: 'Event Category',
      type: 'dropdown',
      options: [
        { label: 'Management events', id: 'management' },
        { label: 'Insights events', id: 'insight' },
      ],
      condition: { field: 'operation', value: 'lookup_events' },
      mode: 'advanced',
      value: () => 'management',
    },
    {
      id: 'lookupMaxResults',
      title: 'Max Events',
      type: 'short-input',
      placeholder: '50 (AWS caps Look Up Events at 50 per page)',
      condition: { field: 'operation', value: 'lookup_events' },
      mode: 'advanced',
    },
    {
      id: 'trailNameList',
      title: 'Trail Names or ARNs',
      type: 'long-input',
      placeholder: 'Comma-separated names or ARNs. Leave empty for every trail in the Region',
      condition: { field: 'operation', value: 'describe_trails' },
    },
    {
      id: 'includeShadowTrails',
      title: 'Shadow Trails',
      type: 'dropdown',
      options: [
        { label: 'Include (AWS default)', id: 'true' },
        { label: 'Exclude', id: 'false' },
      ],
      condition: { field: 'operation', value: 'describe_trails' },
      mode: 'advanced',
      value: () => 'true',
    },
    {
      id: 'trailName',
      title: 'Trail Name or ARN',
      type: 'short-input',
      placeholder: 'my-org-trail, or arn:aws:cloudtrail:us-east-2:123456789012:trail/my-org-trail',
      condition: { field: 'operation', value: TRAIL_SCOPED_OPERATIONS },
      required: {
        field: 'operation',
        value: ['get_trail', 'get_trail_status', 'get_event_selectors'],
      },
    },
    {
      id: 'eventDataStore',
      title: 'Event Data Store',
      type: 'short-input',
      placeholder: 'ARN, or the ID suffix of the ARN',
      condition: {
        field: 'operation',
        value: ['get_insight_selectors', 'get_event_data_store'],
      },
      required: { field: 'operation', value: 'get_event_data_store' },
    },
    {
      id: 'queryStatement',
      title: 'Lake SQL Query',
      type: 'code',
      placeholder:
        "SELECT eventTime, eventName, userIdentity.arn FROM <event-data-store-id> WHERE eventName = 'ConsoleLogin' LIMIT 100",
      condition: { field: 'operation', value: 'start_query' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a CloudTrail Lake SQL query from the user's description.
CloudTrail Lake uses a Presto-based SQL dialect. The FROM clause names the event data store ID (not a table name).
Common columns: eventTime, eventName, eventSource, awsRegion, sourceIPAddress, userAgent, errorCode, errorMessage,
readOnly, recipientAccountId, requestParameters, responseElements, and the userIdentity struct
(userIdentity.type, userIdentity.arn, userIdentity.principalId, userIdentity.accountId,
userIdentity.sessionContext.sessionIssuer.userName).

Examples:
- SELECT eventTime, eventName, userIdentity.arn FROM <eds-id> WHERE eventTime > '2026-08-01 00:00:00' LIMIT 100
- SELECT userIdentity.arn, count(*) AS calls FROM <eds-id> WHERE errorCode IS NOT NULL GROUP BY userIdentity.arn
- SELECT eventName, sourceIPAddress FROM <eds-id> WHERE eventSource = 'iam.amazonaws.com' AND readOnly = false

Return ONLY the SQL query — no explanations, no markdown code blocks.`,
        placeholder: 'Describe the audit question you want answered...',
        generationType: 'sql-query',
      },
    },
    {
      id: 'queryAlias',
      title: 'Query Template Alias',
      type: 'short-input',
      placeholder: 'Alias of a CloudTrail Lake dashboard query template',
      condition: { field: 'operation', value: ['start_query', 'describe_query'] },
      mode: 'advanced',
    },
    {
      id: 'queryParameters',
      title: 'Query Template Parameters',
      type: 'long-input',
      placeholder: 'Comma-separated values for the query template, up to 10',
      condition: { field: 'operation', value: 'start_query' },
      mode: 'advanced',
    },
    {
      id: 'deliveryS3Uri',
      title: 'Results S3 URI',
      type: 'short-input',
      placeholder: 's3://my-cloudtrail-lake-results/',
      condition: { field: 'operation', value: 'start_query' },
      mode: 'advanced',
    },
    {
      id: 'queryId',
      title: 'Query ID',
      type: 'short-input',
      placeholder: 'e.g., a1b2c3d4-5678-90ab-cdef-example11111',
      condition: {
        field: 'operation',
        value: ['describe_query', 'get_query_results', 'cancel_query'],
      },
      required: { field: 'operation', value: ['get_query_results', 'cancel_query'] },
    },
    {
      id: 'refreshId',
      title: 'Dashboard Refresh ID',
      type: 'short-input',
      placeholder: 'Numeric refresh ID, used with a query template alias',
      condition: { field: 'operation', value: 'describe_query' },
      mode: 'advanced',
    },
    {
      id: 'maxQueryResults',
      title: 'Max Rows',
      type: 'short-input',
      placeholder: '100 (AWS caps Lake query results at 1000 per page)',
      condition: { field: 'operation', value: 'get_query_results' },
      mode: 'advanced',
    },
    {
      id: 'eventDataStoreMaxResults',
      title: 'Max Event Data Stores',
      type: 'short-input',
      placeholder: '50 (AWS caps this at 1000 per page)',
      condition: { field: 'operation', value: 'list_event_data_stores' },
      mode: 'advanced',
    },
    {
      id: 'eventDataStoreOwnerAccountId',
      title: 'Event Data Store Owner Account ID',
      type: 'short-input',
      placeholder: '123456789012',
      condition: {
        field: 'operation',
        value: ['start_query', 'describe_query', 'get_query_results', 'cancel_query'],
      },
      mode: 'advanced',
    },
    {
      id: 'resourceIdList',
      title: 'Resource ARNs',
      type: 'long-input',
      placeholder: 'Comma-separated trail, event data store, dashboard, or channel ARNs (up to 20)',
      condition: { field: 'operation', value: 'list_tags' },
      required: { field: 'operation', value: 'list_tags' },
    },
    {
      id: 'nextToken',
      title: 'Pagination Token',
      type: 'short-input',
      placeholder: 'Token from a previous request',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'cloudtrail_lookup_events',
      'cloudtrail_describe_trails',
      'cloudtrail_get_trail',
      'cloudtrail_get_trail_status',
      'cloudtrail_list_trails',
      'cloudtrail_get_event_selectors',
      'cloudtrail_get_insight_selectors',
      'cloudtrail_start_query',
      'cloudtrail_describe_query',
      'cloudtrail_get_query_results',
      'cloudtrail_cancel_query',
      'cloudtrail_list_event_data_stores',
      'cloudtrail_get_event_data_store',
      'cloudtrail_list_tags',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'lookup_events':
            return 'cloudtrail_lookup_events'
          case 'describe_trails':
            return 'cloudtrail_describe_trails'
          case 'get_trail':
            return 'cloudtrail_get_trail'
          case 'get_trail_status':
            return 'cloudtrail_get_trail_status'
          case 'list_trails':
            return 'cloudtrail_list_trails'
          case 'get_event_selectors':
            return 'cloudtrail_get_event_selectors'
          case 'get_insight_selectors':
            return 'cloudtrail_get_insight_selectors'
          case 'start_query':
            return 'cloudtrail_start_query'
          case 'describe_query':
            return 'cloudtrail_describe_query'
          case 'get_query_results':
            return 'cloudtrail_get_query_results'
          case 'cancel_query':
            return 'cloudtrail_cancel_query'
          case 'list_event_data_stores':
            return 'cloudtrail_list_event_data_stores'
          case 'get_event_data_store':
            return 'cloudtrail_get_event_data_store'
          case 'list_tags':
            return 'cloudtrail_list_tags'
          default:
            throw new Error(`Invalid CloudTrail operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, ...rest } = params

        const awsRegion = rest.awsRegion
        const awsAccessKeyId = rest.awsAccessKeyId
        const awsSecretAccessKey = rest.awsSecretAccessKey
        const credentials = { awsRegion, awsAccessKeyId, awsSecretAccessKey }

        switch (operation) {
          case 'lookup_events': {
            const maxResults = parseBoundedInt(rest.lookupMaxResults)
            if (Boolean(rest.attributeKey) !== Boolean(rest.attributeValue)) {
              throw new Error('Provide both a filter attribute and a filter value, or neither')
            }
            return {
              ...credentials,
              ...(rest.attributeKey && {
                attributeKey: rest.attributeKey,
                attributeValue: rest.attributeValue,
              }),
              ...(rest.startTime && { startTime: rest.startTime }),
              ...(rest.endTime && { endTime: rest.endTime }),
              ...(rest.eventCategory === 'insight' && { eventCategory: 'insight' }),
              ...(maxResults !== undefined && { maxResults }),
              ...(rest.nextToken && { nextToken: rest.nextToken }),
            }
          }

          case 'describe_trails':
            return {
              ...credentials,
              ...(rest.trailNameList && { trailNameList: rest.trailNameList }),
              ...(rest.includeShadowTrails !== undefined &&
                rest.includeShadowTrails !== '' && {
                  includeShadowTrails: String(rest.includeShadowTrails) !== 'false',
                }),
            }

          case 'get_trail':
          case 'get_trail_status':
            if (!rest.trailName) {
              throw new Error('Trail name or ARN is required')
            }
            return { ...credentials, name: rest.trailName }

          case 'list_trails':
            return {
              ...credentials,
              ...(rest.nextToken && { nextToken: rest.nextToken }),
            }

          case 'get_event_selectors':
            if (!rest.trailName) {
              throw new Error('Trail name or ARN is required')
            }
            return { ...credentials, trailName: rest.trailName }

          case 'get_insight_selectors':
            if (Boolean(rest.trailName) === Boolean(rest.eventDataStore)) {
              throw new Error(
                'Specify exactly one of trail name or event data store for Insights selectors'
              )
            }
            return {
              ...credentials,
              ...(rest.trailName && { trailName: rest.trailName }),
              ...(rest.eventDataStore && { eventDataStore: rest.eventDataStore }),
            }

          case 'start_query':
            if (Boolean(rest.queryStatement) === Boolean(rest.queryAlias)) {
              throw new Error('Specify exactly one of Lake SQL query or query template alias')
            }
            return {
              ...credentials,
              ...(rest.queryStatement && { queryStatement: rest.queryStatement }),
              ...(rest.queryAlias && { queryAlias: rest.queryAlias }),
              ...(rest.queryParameters && { queryParameters: rest.queryParameters }),
              ...(rest.deliveryS3Uri && { deliveryS3Uri: rest.deliveryS3Uri }),
              ...(rest.eventDataStoreOwnerAccountId && {
                eventDataStoreOwnerAccountId: rest.eventDataStoreOwnerAccountId,
              }),
            }

          case 'describe_query':
            if (Boolean(rest.queryId) === Boolean(rest.queryAlias)) {
              throw new Error('Specify exactly one of query ID or query template alias')
            }
            return {
              ...credentials,
              ...(rest.queryId && { queryId: rest.queryId }),
              ...(rest.queryAlias && { queryAlias: rest.queryAlias }),
              ...(rest.refreshId && { refreshId: rest.refreshId }),
              ...(rest.eventDataStoreOwnerAccountId && {
                eventDataStoreOwnerAccountId: rest.eventDataStoreOwnerAccountId,
              }),
            }

          case 'get_query_results': {
            if (!rest.queryId) {
              throw new Error('Query ID is required')
            }
            const maxQueryResults = parseBoundedInt(rest.maxQueryResults)
            return {
              ...credentials,
              queryId: rest.queryId,
              ...(maxQueryResults !== undefined && { maxQueryResults }),
              ...(rest.nextToken && { nextToken: rest.nextToken }),
              ...(rest.eventDataStoreOwnerAccountId && {
                eventDataStoreOwnerAccountId: rest.eventDataStoreOwnerAccountId,
              }),
            }
          }

          case 'cancel_query':
            if (!rest.queryId) {
              throw new Error('Query ID is required')
            }
            return {
              ...credentials,
              queryId: rest.queryId,
              ...(rest.eventDataStoreOwnerAccountId && {
                eventDataStoreOwnerAccountId: rest.eventDataStoreOwnerAccountId,
              }),
            }

          case 'list_event_data_stores': {
            const maxResults = parseBoundedInt(rest.eventDataStoreMaxResults)
            return {
              ...credentials,
              ...(maxResults !== undefined && { maxResults }),
              ...(rest.nextToken && { nextToken: rest.nextToken }),
            }
          }

          case 'get_event_data_store':
            if (!rest.eventDataStore) {
              throw new Error('Event data store ARN or ID is required')
            }
            return { ...credentials, eventDataStore: rest.eventDataStore }

          case 'list_tags':
            if (!rest.resourceIdList) {
              throw new Error('At least one resource ARN is required')
            }
            return {
              ...credentials,
              resourceIdList: rest.resourceIdList,
              ...(rest.nextToken && { nextToken: rest.nextToken }),
            }

          default:
            throw new Error(`Invalid CloudTrail operation: ${operation}`)
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'CloudTrail operation to perform' },
    awsRegion: { type: 'string', description: 'AWS region' },
    awsAccessKeyId: { type: 'string', description: 'AWS access key ID' },
    awsSecretAccessKey: { type: 'string', description: 'AWS secret access key' },
    attributeKey: { type: 'string', description: 'Lookup attribute to filter events on' },
    attributeValue: { type: 'string', description: 'Value the lookup attribute must equal' },
    startTime: { type: 'string', description: 'Start of the lookup window (ISO 8601)' },
    endTime: { type: 'string', description: 'End of the lookup window (ISO 8601)' },
    eventCategory: { type: 'string', description: 'Management or Insights event category' },
    lookupMaxResults: { type: 'number', description: 'Maximum events to look up (1-50)' },
    trailNameList: { type: 'string', description: 'Comma-separated trail names or ARNs' },
    includeShadowTrails: { type: 'string', description: 'Whether to include shadow trails' },
    trailName: { type: 'string', description: 'Trail name or trail ARN' },
    eventDataStore: { type: 'string', description: 'Event data store ARN or ID suffix' },
    queryStatement: { type: 'string', description: 'CloudTrail Lake SQL query' },
    queryAlias: { type: 'string', description: 'CloudTrail Lake query template alias' },
    queryParameters: {
      type: 'string',
      description: 'Comma-separated parameter values for a query template',
    },
    deliveryS3Uri: { type: 'string', description: 'S3 URI for delivered query results' },
    queryId: { type: 'string', description: 'CloudTrail Lake query ID' },
    refreshId: { type: 'string', description: 'CloudTrail Lake dashboard refresh ID' },
    maxQueryResults: { type: 'number', description: 'Maximum Lake result rows per page (1-1000)' },
    eventDataStoreMaxResults: {
      type: 'number',
      description: 'Maximum event data stores per page (1-1000)',
    },
    eventDataStoreOwnerAccountId: {
      type: 'string',
      description: 'Account ID of the event data store owner',
    },
    resourceIdList: {
      type: 'string',
      description: 'Comma-separated CloudTrail resource ARNs (up to 20)',
    },
    nextToken: { type: 'string', description: 'Pagination token' },
  },
  outputs: {
    events: {
      type: 'array',
      description:
        'Matching CloudTrail events, most recent first, each with the parsed cloudTrailEvent record',
    },
    nextToken: { type: 'string', description: 'Pagination token for the next page' },
    trails: { type: 'array', description: 'Trail configurations or trail summaries' },
    name: { type: 'string', description: 'Trail or event data store name' },
    s3BucketName: { type: 'string', description: 'S3 bucket that receives log files' },
    s3KeyPrefix: { type: 'string', description: 'S3 key prefix for delivered log files' },
    snsTopicName: { type: 'string', description: 'SNS topic notified on log delivery' },
    snsTopicArn: { type: 'string', description: 'ARN of the SNS topic notified on log delivery' },
    includeGlobalServiceEvents: {
      type: 'boolean',
      description: 'Whether the trail records global service events',
    },
    isMultiRegionTrail: {
      type: 'boolean',
      description: 'Whether the trail records events in all Regions',
    },
    homeRegion: { type: 'string', description: 'Region in which the trail was created' },
    trailArn: { type: 'string', description: 'ARN of the trail' },
    logFileValidationEnabled: {
      type: 'boolean',
      description: 'Whether log file integrity validation is enabled',
    },
    cloudWatchLogsLogGroupArn: {
      type: 'string',
      description: 'CloudWatch Logs log group receiving events',
    },
    cloudWatchLogsRoleArn: {
      type: 'string',
      description: 'Role CloudTrail assumes to write to CloudWatch Logs',
    },
    kmsKeyId: { type: 'string', description: 'KMS key used for encryption' },
    hasCustomEventSelectors: {
      type: 'boolean',
      description: 'Whether the trail has custom event selectors',
    },
    hasInsightSelectors: {
      type: 'boolean',
      description: 'Whether the trail has Insights event selectors',
    },
    isOrganizationTrail: {
      type: 'boolean',
      description: 'Whether the trail is an organization trail',
    },
    isLogging: { type: 'boolean', description: 'Whether the trail is currently logging' },
    latestDeliveryError: { type: 'string', description: 'Most recent S3 log delivery error' },
    latestDeliveryTime: { type: 'string', description: 'When log files were last delivered to S3' },
    latestNotificationError: { type: 'string', description: 'Most recent SNS notification error' },
    latestNotificationTime: {
      type: 'string',
      description: 'When the last SNS notification was sent',
    },
    latestCloudWatchLogsDeliveryError: {
      type: 'string',
      description: 'Most recent CloudWatch Logs delivery error',
    },
    latestCloudWatchLogsDeliveryTime: {
      type: 'string',
      description: 'When events were last delivered to CloudWatch Logs',
    },
    latestDigestDeliveryError: { type: 'string', description: 'Most recent digest delivery error' },
    latestDigestDeliveryTime: {
      type: 'string',
      description: 'When a digest file was last delivered',
    },
    startLoggingTime: { type: 'string', description: 'When logging was most recently started' },
    stopLoggingTime: { type: 'string', description: 'When logging was most recently stopped' },
    eventSelectors: { type: 'array', description: 'Basic event selectors configured on the trail' },
    advancedEventSelectors: {
      type: 'array',
      description: 'Advanced event selectors configured on the trail or event data store',
    },
    insightSelectors: { type: 'array', description: 'Enabled CloudTrail Insights types' },
    eventDataStoreArn: { type: 'string', description: 'ARN of the event data store' },
    insightsDestination: {
      type: 'string',
      description: 'Destination event data store that logs Insights events',
    },
    queryId: { type: 'string', description: 'CloudTrail Lake query ID' },
    queryString: { type: 'string', description: 'SQL body of the Lake query' },
    queryStatus: {
      type: 'string',
      description: 'QUEUED, RUNNING, FINISHED, FAILED, CANCELLED, or TIMED_OUT',
    },
    errorMessage: { type: 'string', description: 'Error message returned if the query failed' },
    deliveryS3Uri: { type: 'string', description: 'S3 URI the query results were delivered to' },
    deliveryStatus: { type: 'string', description: 'Delivery status of the S3 query results' },
    prompt: { type: 'string', description: 'Prompt used to generate the query, if generated' },
    eventDataStoreOwnerAccountId: {
      type: 'string',
      description: 'Account ID of the event data store owner',
    },
    eventsMatched: { type: 'number', description: 'Number of events that matched the query' },
    eventsScanned: { type: 'number', description: 'Number of events scanned by the query' },
    bytesScanned: { type: 'number', description: 'Bytes scanned by the query' },
    executionTimeInMillis: { type: 'number', description: 'Query run time in milliseconds' },
    creationTime: { type: 'string', description: 'When the query was created' },
    rows: {
      type: 'array',
      description: 'Lake query result rows, each flattened into a column-to-value object',
    },
    resultsCount: { type: 'number', description: 'Number of result rows on this page' },
    totalResultsCount: { type: 'number', description: 'Total rows the query produced' },
    eventDataStores: { type: 'array', description: 'CloudTrail Lake event data stores' },
    status: { type: 'string', description: 'Status of the event data store' },
    multiRegionEnabled: {
      type: 'boolean',
      description: 'Whether the event data store collects events from all Regions',
    },
    organizationEnabled: {
      type: 'boolean',
      description: 'Whether the event data store collects organization events',
    },
    retentionPeriod: { type: 'number', description: 'Event data store retention period in days' },
    terminationProtectionEnabled: {
      type: 'boolean',
      description: 'Whether termination protection is enabled',
    },
    createdTimestamp: { type: 'string', description: 'When the event data store was created' },
    updatedTimestamp: { type: 'string', description: 'When the event data store was last updated' },
    billingMode: { type: 'string', description: 'Event data store billing mode' },
    federationStatus: { type: 'string', description: 'Lake Formation federation status' },
    federationRoleArn: { type: 'string', description: 'Role used for Lake Formation federation' },
    partitionKeys: { type: 'array', description: 'Partition keys of the event data store' },
    resourceTags: { type: 'array', description: 'Tags on each requested CloudTrail resource' },
  },
}

export const CloudTrailBlockMeta = {
  tags: ['cloud', 'monitoring', 'identity'],
  url: 'https://aws.amazon.com/cloudtrail',
  templates: [
    {
      icon: CloudTrailIcon,
      title: 'CloudTrail root login alerter',
      prompt:
        'Create a scheduled workflow that looks up AWS CloudTrail ConsoleLogin events every 15 minutes, flags any sign-in by the root user or a login without MFA, and posts the actor, source IP, and time to a Slack security channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['security', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CloudTrailIcon,
      title: 'CloudTrail IAM change review',
      prompt:
        'Build a daily workflow that looks up AWS CloudTrail events from iam.amazonaws.com, summarizes every policy attach, role creation, and access key change with the principal who made it, and writes the review to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['security', 'compliance'],
      alsoIntegrations: ['iam'],
    },
    {
      icon: CloudTrailIcon,
      title: 'CloudTrail trail health monitor',
      prompt:
        'Create a scheduled workflow that lists every AWS CloudTrail trail, checks each trail status for logging stopped or recent delivery errors, and opens a PagerDuty incident when a trail stops recording.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: CloudTrailIcon,
      title: 'CloudTrail access key forensics',
      prompt:
        'Build a workflow that takes an AWS access key ID, looks up every CloudTrail event made with it in the last 90 days, groups the calls by service and source IP, and returns a timeline of what that credential did.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['security', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CloudTrailIcon,
      title: 'CloudTrail Lake audit agent',
      prompt:
        'Build a Slack agent that turns natural-language audit questions into CloudTrail Lake SQL, starts the query, polls until it finishes, and returns the result rows with the SQL it ran for review.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['security', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CloudTrailIcon,
      title: 'CloudTrail data-event coverage audit',
      prompt:
        'Create a weekly workflow that reads the event selectors of every AWS CloudTrail trail, reports which trails are missing management event logging or S3 data events, and writes the gaps to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['compliance', 'devops'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: CloudTrailIcon,
      title: 'CloudTrail offboarding evidence pack',
      prompt:
        'Build a workflow that, given a departing employee username, looks up all their AWS CloudTrail activity from the last 90 days, summarizes the resources they touched, and emails an evidence pack to the security team.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['security', 'compliance'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: CloudTrailIcon,
      title: 'CloudTrail Insights anomaly digest',
      prompt:
        'Create a daily workflow that looks up AWS CloudTrail Insights events, correlates each API call-rate or error-rate anomaly with the principals active at that time, and posts a digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'devops'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'investigate-aws-actor',
      description:
        'Trace everything a specific AWS user, role, or access key did in the last 90 days using CloudTrail event history. Use for incident response and offboarding reviews.',
      content:
        '# Investigate AWS Actor\n\nBuild a timeline of what one principal did in AWS.\n\n## Steps\n1. Choose the lookup attribute that matches what you were given: Username for an IAM user or role session, AccessKeyId for a credential.\n2. Look up events for that value, setting the start and end time to the window under investigation. CloudTrail event history only covers the last 90 days.\n3. Page through with the returned pagination token until no token comes back. Look up events is limited to 50 events per page and two requests per second per Region, so pace the paging.\n4. Read the parsed cloudTrailEvent record on each event for the source IP, user agent, request parameters, and any error code.\n5. Group the calls by service and by source IP, and call out any write action or permission change.\n\n## Output\nA chronological timeline of the calls, plus a short summary naming the services touched, the source IPs used, and any failed authorization attempts.',
    },
    {
      name: 'audit-trail-coverage',
      description:
        'Verify that CloudTrail trails exist, are logging, and are configured to capture the events an audit requires. Use for SOC 2 and ISO evidence gathering.',
      content:
        '# Audit Trail Coverage\n\nProve that AWS API activity is actually being recorded.\n\n## Steps\n1. List trails to enumerate every trail visible to the account, noting each home Region.\n2. Describe trails to read the full configuration, including whether each is multi-Region, an organization trail, and whether log file validation is enabled.\n3. Get trail status for each trail and flag any where logging is stopped or a recent delivery error is present.\n4. Get event selectors for each trail to confirm management events are recorded and check which data resources are covered.\n5. Note that trails outside the current Region must be addressed by ARN.\n\n## Output\nA per-trail coverage report: logging state, multi-Region and organization scope, log file validation, delivery errors, and any gap in management or data event coverage.',
    },
    {
      name: 'run-lake-query',
      description:
        'Run a SQL query against a CloudTrail Lake event data store, wait for it to finish, and return the rows. Use for aggregate audit questions that span more than 90 days.',
      content:
        '# Run Lake Query\n\nAnswer an aggregate audit question with CloudTrail Lake.\n\n## Steps\n1. List event data stores, or get one by ARN, to find the store ID to query and confirm its retention period.\n2. Compose the SQL, naming the event data store ID in the FROM clause.\n3. Start the query to obtain a query ID.\n4. Poll describe query with that query ID until the status is FINISHED, FAILED, CANCELLED, or TIMED_OUT.\n5. On FINISHED, fetch the query results with the same query ID, paging with the returned token until no token comes back.\n6. Cancel the query if it is no longer needed while still RUNNING.\n\n## Output\nThe result rows, plus the query ID, events matched, events scanned, and run time. On failure, surface the error message and the SQL that produced it.',
    },
  ],
} as const satisfies BlockMeta
