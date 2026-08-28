import { getErrorMessage } from '@sim/utils/errors'
import { LambdaIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type {
  LambdaAddPermissionResponse,
  LambdaCreateAliasResponse,
  LambdaCreateEventSourceMappingResponse,
  LambdaCreateFunctionResponse,
  LambdaCreateFunctionUrlConfigResponse,
  LambdaDeleteAliasResponse,
  LambdaDeleteEventSourceMappingResponse,
  LambdaDeleteFunctionConcurrencyResponse,
  LambdaDeleteFunctionEventInvokeConfigResponse,
  LambdaDeleteFunctionResponse,
  LambdaDeleteFunctionUrlConfigResponse,
  LambdaDeleteProvisionedConcurrencyConfigResponse,
  LambdaGetAccountSettingsResponse,
  LambdaGetAliasResponse,
  LambdaGetEventSourceMappingResponse,
  LambdaGetFunctionConcurrencyResponse,
  LambdaGetFunctionConfigurationResponse,
  LambdaGetFunctionEventInvokeConfigResponse,
  LambdaGetFunctionRecursionConfigResponse,
  LambdaGetFunctionResponse,
  LambdaGetFunctionUrlConfigResponse,
  LambdaGetLayerVersionResponse,
  LambdaGetPolicyResponse,
  LambdaGetProvisionedConcurrencyConfigResponse,
  LambdaGetRuntimeManagementConfigResponse,
  LambdaInvokeResponse,
  LambdaListAliasesResponse,
  LambdaListEventSourceMappingsResponse,
  LambdaListFunctionEventInvokeConfigsResponse,
  LambdaListFunctionsResponse,
  LambdaListFunctionUrlConfigsResponse,
  LambdaListLayersResponse,
  LambdaListLayerVersionsResponse,
  LambdaListProvisionedConcurrencyConfigsResponse,
  LambdaListTagsResponse,
  LambdaListVersionsByFunctionResponse,
  LambdaPublishVersionResponse,
  LambdaPutFunctionConcurrencyResponse,
  LambdaPutFunctionEventInvokeConfigResponse,
  LambdaPutFunctionRecursionConfigResponse,
  LambdaPutProvisionedConcurrencyConfigResponse,
  LambdaPutRuntimeManagementConfigResponse,
  LambdaRemovePermissionResponse,
  LambdaTagResourceResponse,
  LambdaUntagResourceResponse,
  LambdaUpdateAliasResponse,
  LambdaUpdateEventSourceMappingResponse,
  LambdaUpdateFunctionCodeResponse,
  LambdaUpdateFunctionConfigurationResponse,
  LambdaUpdateFunctionUrlConfigResponse,
} from '@/tools/lambda/types'

type ParamKind = 'string' | 'number' | 'boolean' | 'json' | 'array' | 'jsonArray'

/**
 * How each subBlock value must be coerced before it reaches the tool. SubBlock state is
 * text, so numbers, booleans, JSON objects, and lists all arrive as strings.
 */
const PARAM_KINDS = {
  functionName: 'string',
  payload: 'json',
  invocationType: 'string',
  logType: 'string',
  clientContext: 'string',
  qualifier: 'string',
  functionVersion: 'string',
  masterRegion: 'string',
  marker: 'string',
  maxItems: 'number',
  role: 'string',
  runtime: 'string',
  handler: 'string',
  packageType: 'string',
  s3Bucket: 'string',
  s3Key: 'string',
  s3ObjectVersion: 'string',
  imageUri: 'string',
  sourceKmsKeyArn: 'string',
  description: 'string',
  timeout: 'number',
  memorySize: 'number',
  ephemeralStorageSize: 'number',
  publish: 'boolean',
  environment: 'json',
  tags: 'json',
  architectures: 'array',
  layers: 'array',
  vpcSubnetIds: 'array',
  vpcSecurityGroupIds: 'array',
  tracingMode: 'string',
  deadLetterTargetArn: 'string',
  kmsKeyArn: 'string',
  snapStartApplyOn: 'string',
  logFormat: 'string',
  logGroup: 'string',
  dryRun: 'boolean',
  revisionId: 'string',
  codeSha256: 'string',
  aliasName: 'string',
  aliasFunctionVersion: 'string',
  additionalVersionWeights: 'json',
  statementId: 'string',
  action: 'string',
  principal: 'string',
  sourceArn: 'string',
  sourceAccount: 'string',
  principalOrgId: 'string',
  eventSourceToken: 'string',
  functionUrlAuthType: 'string',
  eventSourceArn: 'string',
  enabled: 'boolean',
  batchSize: 'number',
  maximumBatchingWindowInSeconds: 'number',
  startingPosition: 'string',
  startingPositionTimestamp: 'string',
  parallelizationFactor: 'number',
  maximumRecordAgeInSeconds: 'number',
  maximumRetryAttempts: 'number',
  bisectBatchOnFunctionError: 'boolean',
  tumblingWindowInSeconds: 'number',
  maximumConcurrency: 'number',
  topics: 'array',
  queues: 'array',
  functionResponseTypes: 'array',
  filterPatterns: 'jsonArray',
  onSuccessDestination: 'string',
  onFailureDestination: 'string',
  sourceAccessConfigurations: 'json',
  documentDbDatabaseName: 'string',
  documentDbCollectionName: 'string',
  documentDbFullDocument: 'string',
  amazonManagedKafkaConsumerGroupId: 'string',
  selfManagedKafkaConsumerGroupId: 'string',
  selfManagedKafkaBootstrapServers: 'array',
  uuid: 'string',
  reservedConcurrentExecutions: 'number',
  provisionedConcurrentExecutions: 'number',
  authType: 'string',
  invokeMode: 'string',
  corsAllowCredentials: 'boolean',
  corsAllowOrigins: 'array',
  corsAllowMethods: 'array',
  corsAllowHeaders: 'array',
  corsExposeHeaders: 'array',
  corsMaxAge: 'number',
  maximumEventAgeInSeconds: 'number',
  compatibleRuntime: 'string',
  compatibleArchitecture: 'string',
  layerName: 'string',
  versionNumber: 'number',
  resourceArn: 'string',
  tagKeys: 'array',
  recursiveLoop: 'string',
  updateRuntimeOn: 'string',
  runtimeVersionArn: 'string',
} as const satisfies Record<string, ParamKind>

type ParamName = keyof typeof PARAM_KINDS

const ALL_PARAM_NAMES = Object.keys(PARAM_KINDS) as ParamName[]

/**
 * The subBlock ids each operation sends. Every other declared param is explicitly set to
 * `undefined` so a stale value from a previously selected operation cannot survive the
 * executor's `{ ...inputs, ...transformedParams }` merge.
 */
const OPERATION_PARAMS: Record<string, readonly ParamName[]> = {
  invoke: ['functionName', 'payload', 'invocationType', 'logType', 'clientContext', 'qualifier'],
  list_functions: ['functionVersion', 'masterRegion', 'marker', 'maxItems'],
  get_function: ['functionName', 'qualifier'],
  get_function_configuration: ['functionName', 'qualifier'],
  create_function: [
    'functionName',
    'role',
    'runtime',
    'handler',
    'packageType',
    's3Bucket',
    's3Key',
    's3ObjectVersion',
    'imageUri',
    'sourceKmsKeyArn',
    'description',
    'timeout',
    'memorySize',
    'ephemeralStorageSize',
    'publish',
    'environment',
    'tags',
    'architectures',
    'layers',
    'vpcSubnetIds',
    'vpcSecurityGroupIds',
    'tracingMode',
    'deadLetterTargetArn',
    'kmsKeyArn',
    'snapStartApplyOn',
    'logFormat',
    'logGroup',
  ],
  update_function_code: [
    'functionName',
    's3Bucket',
    's3Key',
    's3ObjectVersion',
    'imageUri',
    'sourceKmsKeyArn',
    'architectures',
    'publish',
    'dryRun',
    'revisionId',
  ],
  update_function_configuration: [
    'functionName',
    'role',
    'runtime',
    'handler',
    'description',
    'timeout',
    'memorySize',
    'ephemeralStorageSize',
    'environment',
    'layers',
    'vpcSubnetIds',
    'vpcSecurityGroupIds',
    'tracingMode',
    'deadLetterTargetArn',
    'kmsKeyArn',
    'snapStartApplyOn',
    'logFormat',
    'logGroup',
    'revisionId',
  ],
  delete_function: ['functionName', 'qualifier'],
  publish_version: ['functionName', 'codeSha256', 'description', 'revisionId'],
  list_versions_by_function: ['functionName', 'marker', 'maxItems'],
  create_alias: [
    'functionName',
    'aliasName',
    'aliasFunctionVersion',
    'description',
    'additionalVersionWeights',
  ],
  get_alias: ['functionName', 'aliasName'],
  update_alias: [
    'functionName',
    'aliasName',
    'aliasFunctionVersion',
    'description',
    'additionalVersionWeights',
    'revisionId',
  ],
  delete_alias: ['functionName', 'aliasName'],
  list_aliases: ['functionName', 'aliasFunctionVersion', 'marker', 'maxItems'],
  add_permission: [
    'functionName',
    'statementId',
    'action',
    'principal',
    'sourceArn',
    'sourceAccount',
    'principalOrgId',
    'eventSourceToken',
    'functionUrlAuthType',
    'qualifier',
    'revisionId',
  ],
  remove_permission: ['functionName', 'statementId', 'qualifier', 'revisionId'],
  get_policy: ['functionName', 'qualifier'],
  create_event_source_mapping: [
    'functionName',
    'eventSourceArn',
    'enabled',
    'batchSize',
    'maximumBatchingWindowInSeconds',
    'startingPosition',
    'startingPositionTimestamp',
    'parallelizationFactor',
    'maximumRecordAgeInSeconds',
    'maximumRetryAttempts',
    'bisectBatchOnFunctionError',
    'tumblingWindowInSeconds',
    'maximumConcurrency',
    'topics',
    'queues',
    'functionResponseTypes',
    'filterPatterns',
    'onSuccessDestination',
    'onFailureDestination',
    'kmsKeyArn',
    'tags',
    'sourceAccessConfigurations',
    'documentDbDatabaseName',
    'documentDbCollectionName',
    'documentDbFullDocument',
    'amazonManagedKafkaConsumerGroupId',
    'selfManagedKafkaConsumerGroupId',
    'selfManagedKafkaBootstrapServers',
  ],
  get_event_source_mapping: ['uuid'],
  update_event_source_mapping: [
    'uuid',
    'functionName',
    'enabled',
    'batchSize',
    'maximumBatchingWindowInSeconds',
    'parallelizationFactor',
    'maximumRecordAgeInSeconds',
    'maximumRetryAttempts',
    'bisectBatchOnFunctionError',
    'tumblingWindowInSeconds',
    'maximumConcurrency',
    'functionResponseTypes',
    'filterPatterns',
    'onSuccessDestination',
    'onFailureDestination',
    'kmsKeyArn',
    'sourceAccessConfigurations',
    'documentDbDatabaseName',
    'documentDbCollectionName',
    'documentDbFullDocument',
    'amazonManagedKafkaConsumerGroupId',
    'selfManagedKafkaConsumerGroupId',
  ],
  delete_event_source_mapping: ['uuid'],
  list_event_source_mappings: ['functionName', 'eventSourceArn', 'marker', 'maxItems'],
  get_function_concurrency: ['functionName'],
  put_function_concurrency: ['functionName', 'reservedConcurrentExecutions'],
  delete_function_concurrency: ['functionName'],
  get_provisioned_concurrency_config: ['functionName', 'qualifier'],
  put_provisioned_concurrency_config: [
    'functionName',
    'qualifier',
    'provisionedConcurrentExecutions',
  ],
  delete_provisioned_concurrency_config: ['functionName', 'qualifier'],
  list_provisioned_concurrency_configs: ['functionName', 'marker', 'maxItems'],
  create_function_url_config: [
    'functionName',
    'authType',
    'qualifier',
    'invokeMode',
    'corsAllowCredentials',
    'corsAllowOrigins',
    'corsAllowMethods',
    'corsAllowHeaders',
    'corsExposeHeaders',
    'corsMaxAge',
  ],
  get_function_url_config: ['functionName', 'qualifier'],
  update_function_url_config: [
    'functionName',
    'authType',
    'qualifier',
    'invokeMode',
    'corsAllowCredentials',
    'corsAllowOrigins',
    'corsAllowMethods',
    'corsAllowHeaders',
    'corsExposeHeaders',
    'corsMaxAge',
  ],
  delete_function_url_config: ['functionName', 'qualifier'],
  list_function_url_configs: ['functionName', 'marker', 'maxItems'],
  get_function_event_invoke_config: ['functionName', 'qualifier'],
  put_function_event_invoke_config: [
    'functionName',
    'qualifier',
    'maximumRetryAttempts',
    'maximumEventAgeInSeconds',
    'onSuccessDestination',
    'onFailureDestination',
  ],
  delete_function_event_invoke_config: ['functionName', 'qualifier'],
  list_function_event_invoke_configs: ['functionName', 'marker', 'maxItems'],
  list_layers: ['compatibleRuntime', 'compatibleArchitecture', 'marker', 'maxItems'],
  list_layer_versions: [
    'layerName',
    'compatibleRuntime',
    'compatibleArchitecture',
    'marker',
    'maxItems',
  ],
  get_layer_version: ['layerName', 'versionNumber'],
  list_tags: ['resourceArn'],
  tag_resource: ['resourceArn', 'tags'],
  untag_resource: ['resourceArn', 'tagKeys'],
  get_account_settings: [],
  get_function_recursion_config: ['functionName'],
  put_function_recursion_config: ['functionName', 'recursiveLoop'],
  get_runtime_management_config: ['functionName', 'qualifier'],
  put_runtime_management_config: [
    'functionName',
    'updateRuntimeOn',
    'runtimeVersionArn',
    'qualifier',
  ],
}

/** Literal a user types into a list field to clear it on an update, distinct from leaving it blank. */
const EMPTY_COLLECTION = '[]'

function coerceParam(name: ParamName, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  const kind: ParamKind = PARAM_KINDS[name]

  switch (kind) {
    case 'number': {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value
      if (value === 'true') return true
      if (value === 'false') return false
      return undefined
    }
    case 'array': {
      if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
      // An explicit empty-array literal clears the collection on an update. A blank field is
      // "leave unchanged" and must stay undefined, or every update would wipe the setting.
      if (String(value).trim() === EMPTY_COLLECTION) return []
      const items = String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      return items.length > 0 ? items : undefined
    }
    case 'jsonArray': {
      const parsed = Array.isArray(value) ? value : parseJson(value, name)
      if (!Array.isArray(parsed)) {
        throw new Error(`${name} must be a JSON array`)
      }
      return parsed.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
    }
    case 'json':
      return typeof value === 'object' ? value : parseJson(value, name)
    default:
      return String(value)
  }
}

function parseJson(value: unknown, name: string): unknown {
  try {
    return JSON.parse(String(value))
  } catch (error) {
    throw new Error(`Invalid JSON in ${name}: ${getErrorMessage(error)}`)
  }
}

export const LambdaBlock: BlockConfig<
  | LambdaInvokeResponse
  | LambdaListFunctionsResponse
  | LambdaGetFunctionResponse
  | LambdaGetFunctionConfigurationResponse
  | LambdaCreateFunctionResponse
  | LambdaUpdateFunctionCodeResponse
  | LambdaUpdateFunctionConfigurationResponse
  | LambdaDeleteFunctionResponse
  | LambdaPublishVersionResponse
  | LambdaListVersionsByFunctionResponse
  | LambdaCreateAliasResponse
  | LambdaGetAliasResponse
  | LambdaUpdateAliasResponse
  | LambdaDeleteAliasResponse
  | LambdaListAliasesResponse
  | LambdaAddPermissionResponse
  | LambdaRemovePermissionResponse
  | LambdaGetPolicyResponse
  | LambdaCreateEventSourceMappingResponse
  | LambdaGetEventSourceMappingResponse
  | LambdaUpdateEventSourceMappingResponse
  | LambdaDeleteEventSourceMappingResponse
  | LambdaListEventSourceMappingsResponse
  | LambdaGetFunctionConcurrencyResponse
  | LambdaPutFunctionConcurrencyResponse
  | LambdaDeleteFunctionConcurrencyResponse
  | LambdaGetProvisionedConcurrencyConfigResponse
  | LambdaPutProvisionedConcurrencyConfigResponse
  | LambdaDeleteProvisionedConcurrencyConfigResponse
  | LambdaListProvisionedConcurrencyConfigsResponse
  | LambdaCreateFunctionUrlConfigResponse
  | LambdaGetFunctionUrlConfigResponse
  | LambdaUpdateFunctionUrlConfigResponse
  | LambdaDeleteFunctionUrlConfigResponse
  | LambdaListFunctionUrlConfigsResponse
  | LambdaGetFunctionEventInvokeConfigResponse
  | LambdaPutFunctionEventInvokeConfigResponse
  | LambdaDeleteFunctionEventInvokeConfigResponse
  | LambdaListFunctionEventInvokeConfigsResponse
  | LambdaListLayersResponse
  | LambdaListLayerVersionsResponse
  | LambdaGetLayerVersionResponse
  | LambdaListTagsResponse
  | LambdaTagResourceResponse
  | LambdaUntagResourceResponse
  | LambdaGetAccountSettingsResponse
  | LambdaGetFunctionRecursionConfigResponse
  | LambdaPutFunctionRecursionConfigResponse
  | LambdaGetRuntimeManagementConfigResponse
  | LambdaPutRuntimeManagementConfigResponse
> = {
  type: 'lambda',
  name: 'Lambda',
  description: 'Invoke, deploy, and manage AWS Lambda functions',
  longDescription:
    'Integrate AWS Lambda into workflows. Invoke functions and read their response payload, create and update functions from Amazon S3 packages or container images, publish versions and aliases, wire up event source mappings, manage concurrency, function URLs, layers, permissions, and tags. Requires an AWS access key and secret access key.',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  docsLink: 'https://docs.sim.ai/integrations/lambda',
  bgColor: 'linear-gradient(45deg, #C8511B 0%, #FF9900 100%)',
  iconColor: '#FF9900',
  icon: LambdaIcon,
  canvasPresentation: {
    defaultTitle: 'Lambda',
    sentences: {
      byOperation: {
        invoke: [
          { text: 'Invoke function', field: 'functionName', core: true },
          { text: 'at', field: 'qualifier' },
        ],
        list_functions: ['List Lambda functions'],
        get_function: [{ text: 'Read function', field: 'functionName', core: true }],
        get_function_configuration: [
          { text: 'Read the configuration of', field: 'functionName', core: true },
        ],
        create_function: [
          { text: 'Create function', field: 'functionName', core: true },
          { text: 'on runtime', field: 'runtime' },
        ],
        update_function_code: [{ text: 'Deploy new code to', field: 'functionName', core: true }],
        update_function_configuration: [
          { text: 'Update the configuration of', field: 'functionName', core: true },
        ],
        delete_function: [{ text: 'Delete function', field: 'functionName', core: true }],
        publish_version: [{ text: 'Publish a version of', field: 'functionName', core: true }],
        list_versions_by_function: [
          { text: 'List versions of', field: 'functionName', core: true },
        ],
        create_alias: [
          { text: 'Create alias', field: 'aliasName', core: true },
          { text: 'on', field: 'functionName' },
        ],
        get_alias: [
          { text: 'Read alias', field: 'aliasName', core: true },
          { text: 'on', field: 'functionName' },
        ],
        update_alias: [
          { text: 'Update alias', field: 'aliasName', core: true },
          { text: 'to version', field: 'aliasFunctionVersion' },
        ],
        delete_alias: [
          { text: 'Delete alias', field: 'aliasName', core: true },
          { text: 'from', field: 'functionName' },
        ],
        list_aliases: [{ text: 'List aliases of', field: 'functionName', core: true }],
        add_permission: [
          { text: 'Grant', field: 'principal', core: true },
          { text: 'permission to invoke', field: 'functionName' },
        ],
        remove_permission: [
          { text: 'Remove permission', field: 'statementId', core: true },
          { text: 'from', field: 'functionName' },
        ],
        get_policy: [{ text: 'Read the policy of', field: 'functionName', core: true }],
        create_event_source_mapping: [
          { text: 'Map event source', field: 'eventSourceArn', core: true },
          { text: 'to', field: 'functionName' },
        ],
        get_event_source_mapping: [
          { text: 'Read event source mapping', field: 'uuid', core: true },
        ],
        update_event_source_mapping: [
          { text: 'Update event source mapping', field: 'uuid', core: true },
        ],
        delete_event_source_mapping: [
          { text: 'Delete event source mapping', field: 'uuid', core: true },
        ],
        list_event_source_mappings: [
          { text: 'List event source mappings for', field: 'functionName', core: true },
        ],
        get_function_concurrency: [
          { text: 'Read the reserved concurrency of', field: 'functionName', core: true },
        ],
        put_function_concurrency: [
          { text: 'Reserve concurrency on', field: 'functionName', core: true },
          { text: 'of', field: 'reservedConcurrentExecutions' },
        ],
        delete_function_concurrency: [
          { text: 'Remove reserved concurrency from', field: 'functionName', core: true },
        ],
        get_provisioned_concurrency_config: [
          { text: 'Read provisioned concurrency of', field: 'functionName', core: true },
          { text: 'at', field: 'qualifier' },
        ],
        put_provisioned_concurrency_config: [
          { text: 'Provision concurrency on', field: 'functionName', core: true },
          { text: 'at', field: 'qualifier' },
        ],
        delete_provisioned_concurrency_config: [
          { text: 'Remove provisioned concurrency from', field: 'functionName', core: true },
        ],
        list_provisioned_concurrency_configs: [
          { text: 'List provisioned concurrency on', field: 'functionName', core: true },
        ],
        create_function_url_config: [
          { text: 'Create a function URL for', field: 'functionName', core: true },
        ],
        get_function_url_config: [
          { text: 'Read the function URL of', field: 'functionName', core: true },
        ],
        update_function_url_config: [
          { text: 'Update the function URL of', field: 'functionName', core: true },
        ],
        delete_function_url_config: [
          { text: 'Delete the function URL of', field: 'functionName', core: true },
        ],
        list_function_url_configs: [
          { text: 'List function URLs of', field: 'functionName', core: true },
        ],
        get_function_event_invoke_config: [
          { text: 'Read async invoke settings of', field: 'functionName', core: true },
        ],
        put_function_event_invoke_config: [
          { text: 'Set async invoke settings on', field: 'functionName', core: true },
        ],
        delete_function_event_invoke_config: [
          { text: 'Remove async invoke settings from', field: 'functionName', core: true },
        ],
        list_function_event_invoke_configs: [
          { text: 'List async invoke settings of', field: 'functionName', core: true },
        ],
        list_layers: ['List Lambda layers'],
        list_layer_versions: [{ text: 'List versions of layer', field: 'layerName', core: true }],
        get_layer_version: [
          { text: 'Read layer', field: 'layerName', core: true },
          { text: 'version', field: 'versionNumber' },
        ],
        list_tags: [{ text: 'List tags on', field: 'resourceArn', core: true }],
        tag_resource: [{ text: 'Tag', field: 'resourceArn', core: true }],
        untag_resource: [
          { text: 'Remove tags', field: 'tagKeys', core: true },
          { text: 'from', field: 'resourceArn' },
        ],
        get_account_settings: ['Read Lambda account limits and usage'],
        get_function_recursion_config: [
          { text: 'Read recursion settings of', field: 'functionName', core: true },
        ],
        put_function_recursion_config: [
          { text: 'Set recursion detection on', field: 'functionName', core: true },
          { text: 'to', field: 'recursiveLoop' },
        ],
        get_runtime_management_config: [
          { text: 'Read runtime update policy of', field: 'functionName', core: true },
        ],
        put_runtime_management_config: [
          { text: 'Set runtime updates on', field: 'functionName', core: true },
          { text: 'to', field: 'updateRuntimeOn' },
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
        { label: 'Invoke Function', id: 'invoke' },
        { label: 'List Functions', id: 'list_functions' },
        { label: 'Get Function', id: 'get_function' },
        { label: 'Get Function Configuration', id: 'get_function_configuration' },
        { label: 'Create Function', id: 'create_function' },
        { label: 'Update Function Code', id: 'update_function_code' },
        { label: 'Update Function Configuration', id: 'update_function_configuration' },
        { label: 'Delete Function', id: 'delete_function' },
        { label: 'Publish Version', id: 'publish_version' },
        { label: 'List Function Versions', id: 'list_versions_by_function' },
        { label: 'Create Alias', id: 'create_alias' },
        { label: 'Get Alias', id: 'get_alias' },
        { label: 'Update Alias', id: 'update_alias' },
        { label: 'Delete Alias', id: 'delete_alias' },
        { label: 'List Aliases', id: 'list_aliases' },
        { label: 'Add Permission', id: 'add_permission' },
        { label: 'Remove Permission', id: 'remove_permission' },
        { label: 'Get Policy', id: 'get_policy' },
        { label: 'Create Event Source Mapping', id: 'create_event_source_mapping' },
        { label: 'Get Event Source Mapping', id: 'get_event_source_mapping' },
        { label: 'Update Event Source Mapping', id: 'update_event_source_mapping' },
        { label: 'Delete Event Source Mapping', id: 'delete_event_source_mapping' },
        { label: 'List Event Source Mappings', id: 'list_event_source_mappings' },
        { label: 'Get Function Concurrency', id: 'get_function_concurrency' },
        { label: 'Set Function Concurrency', id: 'put_function_concurrency' },
        { label: 'Delete Function Concurrency', id: 'delete_function_concurrency' },
        { label: 'Get Provisioned Concurrency', id: 'get_provisioned_concurrency_config' },
        { label: 'Set Provisioned Concurrency', id: 'put_provisioned_concurrency_config' },
        { label: 'Delete Provisioned Concurrency', id: 'delete_provisioned_concurrency_config' },
        { label: 'List Provisioned Concurrency', id: 'list_provisioned_concurrency_configs' },
        { label: 'Create Function URL', id: 'create_function_url_config' },
        { label: 'Get Function URL', id: 'get_function_url_config' },
        { label: 'Update Function URL', id: 'update_function_url_config' },
        { label: 'Delete Function URL', id: 'delete_function_url_config' },
        { label: 'List Function URLs', id: 'list_function_url_configs' },
        { label: 'Get Async Invoke Config', id: 'get_function_event_invoke_config' },
        { label: 'Set Async Invoke Config', id: 'put_function_event_invoke_config' },
        { label: 'Delete Async Invoke Config', id: 'delete_function_event_invoke_config' },
        { label: 'List Async Invoke Configs', id: 'list_function_event_invoke_configs' },
        { label: 'List Layers', id: 'list_layers' },
        { label: 'List Layer Versions', id: 'list_layer_versions' },
        { label: 'Get Layer Version', id: 'get_layer_version' },
        { label: 'List Tags', id: 'list_tags' },
        { label: 'Tag Resource', id: 'tag_resource' },
        { label: 'Untag Resource', id: 'untag_resource' },
        { label: 'Get Account Settings', id: 'get_account_settings' },
        { label: 'Get Recursion Config', id: 'get_function_recursion_config' },
        { label: 'Set Recursion Config', id: 'put_function_recursion_config' },
        { label: 'Get Runtime Management Config', id: 'get_runtime_management_config' },
        { label: 'Set Runtime Management Config', id: 'put_runtime_management_config' },
      ],
      value: () => 'invoke',
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
      id: 'functionName',
      title: 'Function Name',
      type: 'short-input',
      placeholder: 'my-function or arn:aws:lambda:us-east-1:123456789012:function:my-function',
      condition: {
        field: 'operation',
        value: [
          'invoke',
          'get_function',
          'get_function_configuration',
          'create_function',
          'update_function_code',
          'update_function_configuration',
          'delete_function',
          'publish_version',
          'list_versions_by_function',
          'create_alias',
          'get_alias',
          'update_alias',
          'delete_alias',
          'list_aliases',
          'add_permission',
          'remove_permission',
          'get_policy',
          'create_event_source_mapping',
          'update_event_source_mapping',
          'list_event_source_mappings',
          'get_function_concurrency',
          'put_function_concurrency',
          'delete_function_concurrency',
          'get_provisioned_concurrency_config',
          'put_provisioned_concurrency_config',
          'delete_provisioned_concurrency_config',
          'list_provisioned_concurrency_configs',
          'create_function_url_config',
          'get_function_url_config',
          'update_function_url_config',
          'delete_function_url_config',
          'list_function_url_configs',
          'get_function_event_invoke_config',
          'put_function_event_invoke_config',
          'delete_function_event_invoke_config',
          'list_function_event_invoke_configs',
          'get_function_recursion_config',
          'put_function_recursion_config',
          'get_runtime_management_config',
          'put_runtime_management_config',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'invoke',
          'get_function',
          'get_function_configuration',
          'create_function',
          'update_function_code',
          'update_function_configuration',
          'delete_function',
          'publish_version',
          'list_versions_by_function',
          'create_alias',
          'get_alias',
          'update_alias',
          'delete_alias',
          'list_aliases',
          'add_permission',
          'remove_permission',
          'get_policy',
          'create_event_source_mapping',
          'get_function_concurrency',
          'put_function_concurrency',
          'delete_function_concurrency',
          'get_provisioned_concurrency_config',
          'put_provisioned_concurrency_config',
          'delete_provisioned_concurrency_config',
          'list_provisioned_concurrency_configs',
          'create_function_url_config',
          'get_function_url_config',
          'update_function_url_config',
          'delete_function_url_config',
          'list_function_url_configs',
          'get_function_event_invoke_config',
          'put_function_event_invoke_config',
          'delete_function_event_invoke_config',
          'list_function_event_invoke_configs',
          'get_function_recursion_config',
          'put_function_recursion_config',
          'get_runtime_management_config',
          'put_runtime_management_config',
        ],
      },
    },
    {
      id: 'payload',
      title: 'Payload',
      type: 'code',
      placeholder: '{\n  "key": "value"\n}',
      condition: { field: 'operation', value: 'invoke' },
      wandConfig: {
        enabled: true,
        prompt:
          "Generate a JSON event payload for an AWS Lambda function based on the user's description.\n\nReturn ONLY valid JSON - no explanations, no markdown code blocks.",
      },
    },
    {
      id: 'invocationType',
      title: 'Invocation Type',
      type: 'dropdown',
      options: [
        { label: 'Request/Response (wait for result)', id: 'RequestResponse' },
        { label: 'Event (fire and forget)', id: 'Event' },
        { label: 'Dry Run (validate only)', id: 'DryRun' },
      ],
      condition: { field: 'operation', value: 'invoke' },
    },
    {
      id: 'logType',
      title: 'Log Type',
      type: 'dropdown',
      options: [
        { label: 'None', id: 'None' },
        { label: 'Tail (return last 4 KB of logs)', id: 'Tail' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'invoke' },
    },
    {
      id: 'clientContext',
      title: 'Client Context',
      type: 'short-input',
      placeholder: 'Base64-encoded JSON',
      mode: 'advanced',
      condition: { field: 'operation', value: 'invoke' },
    },
    {
      id: 'qualifier',
      title: 'Qualifier',
      type: 'short-input',
      placeholder: 'Version number or alias name',
      condition: {
        field: 'operation',
        value: [
          'invoke',
          'get_function',
          'get_function_configuration',
          'delete_function',
          'add_permission',
          'remove_permission',
          'get_policy',
          'get_provisioned_concurrency_config',
          'put_provisioned_concurrency_config',
          'delete_provisioned_concurrency_config',
          'create_function_url_config',
          'get_function_url_config',
          'update_function_url_config',
          'delete_function_url_config',
          'get_function_event_invoke_config',
          'put_function_event_invoke_config',
          'delete_function_event_invoke_config',
          'get_runtime_management_config',
          'put_runtime_management_config',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_provisioned_concurrency_config',
          'put_provisioned_concurrency_config',
          'delete_provisioned_concurrency_config',
        ],
      },
    },
    {
      id: 'functionVersion',
      title: 'Include All Versions',
      type: 'dropdown',
      options: [{ label: 'ALL', id: 'ALL' }],
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_functions' },
    },
    {
      id: 'masterRegion',
      title: 'Master Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_functions' },
    },
    {
      id: 'marker',
      title: 'Marker',
      type: 'short-input',
      placeholder: 'Pagination token from a previous response',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'list_functions',
          'list_versions_by_function',
          'list_aliases',
          'list_event_source_mappings',
          'list_provisioned_concurrency_configs',
          'list_function_url_configs',
          'list_function_event_invoke_configs',
          'list_layers',
          'list_layer_versions',
        ],
      },
    },
    {
      id: 'maxItems',
      title: 'Max Items',
      type: 'short-input',
      placeholder: '50',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'list_functions',
          'list_versions_by_function',
          'list_aliases',
          'list_event_source_mappings',
          'list_provisioned_concurrency_configs',
          'list_function_url_configs',
          'list_function_event_invoke_configs',
          'list_layers',
          'list_layer_versions',
        ],
      },
    },
    {
      id: 'role',
      title: 'Execution Role ARN',
      type: 'short-input',
      placeholder: 'arn:aws:iam::123456789012:role/lambda-execution-role',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
      required: { field: 'operation', value: 'create_function' },
    },
    {
      id: 'runtime',
      title: 'Runtime',
      type: 'short-input',
      placeholder: 'nodejs22.x, python3.13, java21, ...',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
    },
    {
      id: 'handler',
      title: 'Handler',
      type: 'short-input',
      placeholder: 'index.handler',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
    },
    {
      id: 'packageType',
      title: 'Package Type',
      type: 'dropdown',
      options: [
        { label: 'Zip (.zip archive)', id: 'Zip' },
        { label: 'Image (container image)', id: 'Image' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_function' },
    },
    {
      id: 's3Bucket',
      title: 'S3 Bucket',
      type: 'short-input',
      placeholder: 'my-deployment-bucket',
      condition: { field: 'operation', value: ['create_function', 'update_function_code'] },
    },
    {
      id: 's3Key',
      title: 'S3 Key',
      type: 'short-input',
      placeholder: 'functions/my-function.zip',
      condition: { field: 'operation', value: ['create_function', 'update_function_code'] },
    },
    {
      id: 's3ObjectVersion',
      title: 'S3 Object Version',
      type: 'short-input',
      placeholder: 'Version ID of the S3 object',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_function', 'update_function_code'] },
    },
    {
      id: 'imageUri',
      title: 'Image URI',
      type: 'short-input',
      placeholder: '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-image:latest',
      condition: { field: 'operation', value: ['create_function', 'update_function_code'] },
    },
    {
      id: 'sourceKmsKeyArn',
      title: 'Source KMS Key ARN',
      type: 'short-input',
      placeholder: 'arn:aws:kms:us-east-1:123456789012:key/abc-123',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_function', 'update_function_code'] },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'What this resource does',
      condition: {
        field: 'operation',
        value: [
          'create_function',
          'update_function_configuration',
          'publish_version',
          'create_alias',
          'update_alias',
        ],
      },
    },
    {
      id: 'timeout',
      title: 'Timeout (seconds)',
      type: 'short-input',
      placeholder: '3',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
    },
    {
      id: 'memorySize',
      title: 'Memory (MB)',
      type: 'short-input',
      placeholder: '128',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
    },
    {
      id: 'ephemeralStorageSize',
      title: 'Ephemeral Storage (MB)',
      type: 'short-input',
      placeholder: '512',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
    },
    {
      id: 'publish',
      title: 'Publish Version',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_function', 'update_function_code'] },
    },
    {
      id: 'environment',
      title: 'Environment Variables (JSON)',
      type: 'code',
      placeholder: '{\n  "STAGE": "production"\n}',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          "Generate a flat JSON object of AWS Lambda environment variables from the user's description. Every key and value must be a string.\n\nReturn ONLY valid JSON - no explanations, no markdown code blocks.",
      },
    },
    {
      id: 'tags',
      title: 'Tags (JSON)',
      type: 'code',
      placeholder: '{\n  "env": "prod"\n}',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function', 'create_event_source_mapping', 'tag_resource'],
      },
      required: { field: 'operation', value: 'tag_resource' },
      wandConfig: {
        enabled: true,
        prompt:
          "Generate a flat JSON object of AWS resource tags from the user's description. Every key and value must be a string.\n\nReturn ONLY valid JSON - no explanations, no markdown code blocks.",
      },
    },
    {
      id: 'architectures',
      title: 'Architectures',
      type: 'short-input',
      placeholder: 'x86_64 or arm64',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_function', 'update_function_code'] },
    },
    {
      id: 'layers',
      title: 'Layer ARNs',
      type: 'short-input',
      placeholder: 'arn:aws:lambda:us-east-1:123456789012:layer:my-layer:1, or [] to clear',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
    },
    {
      id: 'vpcSubnetIds',
      title: 'VPC Subnet IDs',
      type: 'short-input',
      placeholder: 'subnet-abc123,subnet-def456, or [] to clear',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
    },
    {
      id: 'vpcSecurityGroupIds',
      title: 'VPC Security Group IDs',
      type: 'short-input',
      placeholder: 'sg-abc123,sg-def456, or [] to clear',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
    },
    {
      id: 'tracingMode',
      title: 'X-Ray Tracing',
      type: 'dropdown',
      options: [
        { label: 'Pass Through', id: 'PassThrough' },
        { label: 'Active', id: 'Active' },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
    },
    {
      id: 'deadLetterTargetArn',
      title: 'Dead Letter Queue ARN',
      type: 'short-input',
      placeholder: 'arn:aws:sqs:us-east-1:123456789012:my-dlq',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
    },
    {
      id: 'kmsKeyArn',
      title: 'KMS Key ARN',
      type: 'short-input',
      placeholder: 'arn:aws:kms:us-east-1:123456789012:key/abc-123',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'create_function',
          'update_function_configuration',
          'create_event_source_mapping',
          'update_event_source_mapping',
        ],
      },
    },
    {
      id: 'snapStartApplyOn',
      title: 'SnapStart',
      type: 'dropdown',
      options: [
        { label: 'None', id: 'None' },
        { label: 'Published Versions', id: 'PublishedVersions' },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
    },
    {
      id: 'logFormat',
      title: 'Log Format',
      type: 'dropdown',
      options: [
        { label: 'Text', id: 'Text' },
        { label: 'JSON', id: 'JSON' },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
    },
    {
      id: 'logGroup',
      title: 'Log Group',
      type: 'short-input',
      placeholder: '/aws/lambda/my-function',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function', 'update_function_configuration'],
      },
    },
    {
      id: 'dryRun',
      title: 'Dry Run',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_function_code' },
    },
    {
      id: 'revisionId',
      title: 'Revision ID',
      type: 'short-input',
      placeholder: 'Only apply if the current revision matches',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'update_function_code',
          'update_function_configuration',
          'publish_version',
          'update_alias',
          'add_permission',
          'remove_permission',
        ],
      },
    },
    {
      id: 'codeSha256',
      title: 'Code SHA256',
      type: 'short-input',
      placeholder: 'Only publish if the package hash matches',
      mode: 'advanced',
      condition: { field: 'operation', value: 'publish_version' },
    },
    {
      id: 'aliasName',
      title: 'Alias Name',
      type: 'short-input',
      placeholder: 'prod',
      condition: {
        field: 'operation',
        value: ['create_alias', 'get_alias', 'update_alias', 'delete_alias'],
      },
      required: {
        field: 'operation',
        value: ['create_alias', 'get_alias', 'update_alias', 'delete_alias'],
      },
    },
    {
      id: 'aliasFunctionVersion',
      title: 'Alias Target Version',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: ['create_alias', 'update_alias', 'list_aliases'] },
      required: { field: 'operation', value: 'create_alias' },
    },
    {
      id: 'additionalVersionWeights',
      title: 'Weighted Routing (JSON)',
      type: 'code',
      placeholder: '{\n  "2": 0.1\n}',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_alias', 'update_alias'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an AWS Lambda alias weighted-routing JSON object mapping a function version string to the fraction of traffic it receives, between 0 and 1.\n\nReturn ONLY valid JSON - no explanations, no markdown code blocks.',
      },
    },
    {
      id: 'statementId',
      title: 'Statement ID',
      type: 'short-input',
      placeholder: 'allow-s3-invoke',
      condition: { field: 'operation', value: ['add_permission', 'remove_permission'] },
      required: { field: 'operation', value: ['add_permission', 'remove_permission'] },
    },
    {
      id: 'action',
      title: 'Action',
      type: 'short-input',
      placeholder: 'lambda:InvokeFunction',
      condition: { field: 'operation', value: 'add_permission' },
      required: { field: 'operation', value: 'add_permission' },
    },
    {
      id: 'principal',
      title: 'Principal',
      type: 'short-input',
      placeholder: 's3.amazonaws.com or 123456789012',
      condition: { field: 'operation', value: 'add_permission' },
      required: { field: 'operation', value: 'add_permission' },
    },
    {
      id: 'sourceArn',
      title: 'Source ARN',
      type: 'short-input',
      placeholder: 'arn:aws:s3:::my-bucket',
      mode: 'advanced',
      condition: { field: 'operation', value: 'add_permission' },
    },
    {
      id: 'sourceAccount',
      title: 'Source Account',
      type: 'short-input',
      placeholder: '123456789012',
      mode: 'advanced',
      condition: { field: 'operation', value: 'add_permission' },
    },
    {
      id: 'principalOrgId',
      title: 'Principal Org ID',
      type: 'short-input',
      placeholder: 'o-a1b2c3d4e5',
      mode: 'advanced',
      condition: { field: 'operation', value: 'add_permission' },
    },
    {
      id: 'eventSourceToken',
      title: 'Event Source Token',
      type: 'short-input',
      placeholder: 'Alexa Smart Home token',
      mode: 'advanced',
      condition: { field: 'operation', value: 'add_permission' },
    },
    {
      id: 'functionUrlAuthType',
      title: 'Function URL Auth Type',
      type: 'dropdown',
      options: [
        { label: 'NONE', id: 'NONE' },
        { label: 'AWS_IAM', id: 'AWS_IAM' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'add_permission' },
    },
    {
      id: 'eventSourceArn',
      title: 'Event Source ARN',
      type: 'short-input',
      placeholder: 'arn:aws:sqs:us-east-1:123456789012:my-queue',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'list_event_source_mappings'],
      },
    },
    {
      id: 'enabled',
      title: 'Enabled',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
    },
    {
      id: 'batchSize',
      title: 'Batch Size',
      type: 'short-input',
      placeholder: '10',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
    },
    {
      id: 'maximumBatchingWindowInSeconds',
      title: 'Batching Window (seconds)',
      type: 'short-input',
      placeholder: '0',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
    },
    {
      id: 'startingPosition',
      title: 'Starting Position',
      type: 'dropdown',
      options: [
        { label: 'Latest', id: 'LATEST' },
        { label: 'Trim Horizon (oldest)', id: 'TRIM_HORIZON' },
        { label: 'At Timestamp', id: 'AT_TIMESTAMP' },
      ],
      condition: { field: 'operation', value: 'create_event_source_mapping' },
    },
    {
      id: 'startingPositionTimestamp',
      title: 'Starting Position Timestamp',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00Z',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_event_source_mapping' },
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
      },
    },
    {
      id: 'parallelizationFactor',
      title: 'Parallelization Factor',
      type: 'short-input',
      placeholder: '1',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
    },
    {
      id: 'maximumRecordAgeInSeconds',
      title: 'Max Record Age (seconds)',
      type: 'short-input',
      placeholder: '-1 for infinite',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
    },
    {
      id: 'maximumRetryAttempts',
      title: 'Max Retry Attempts',
      type: 'short-input',
      placeholder: '2',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'create_event_source_mapping',
          'update_event_source_mapping',
          'put_function_event_invoke_config',
        ],
      },
    },
    {
      id: 'bisectBatchOnFunctionError',
      title: 'Bisect Batch On Error',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
    },
    {
      id: 'tumblingWindowInSeconds',
      title: 'Tumbling Window (seconds)',
      type: 'short-input',
      placeholder: '0',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
    },
    {
      id: 'maximumConcurrency',
      title: 'Max Concurrency',
      type: 'short-input',
      placeholder: '2-1000',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
    },
    {
      id: 'topics',
      title: 'Kafka Topics',
      type: 'short-input',
      placeholder: 'orders,events',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_event_source_mapping' },
    },
    {
      id: 'queues',
      title: 'Amazon MQ Queues',
      type: 'short-input',
      placeholder: 'my-queue',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_event_source_mapping' },
    },
    {
      id: 'functionResponseTypes',
      title: 'Function Response Types',
      type: 'short-input',
      placeholder: 'ReportBatchItemFailures, or [] to clear',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
    },
    {
      id: 'filterPatterns',
      title: 'Filter Patterns (JSON array)',
      type: 'code',
      placeholder: '[\n  "{\\"body\\":{\\"status\\":[\\"open\\"]}}"\n]',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of AWS Lambda event source mapping filter patterns. Each array element must be a STRING containing a JSON filter pattern.\n\nReturn ONLY valid JSON - no explanations, no markdown code blocks.',
      },
    },
    {
      id: 'onSuccessDestination',
      title: 'On Success Destination ARN',
      type: 'short-input',
      placeholder: 'arn:aws:sqs:us-east-1:123456789012:success-queue',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'create_event_source_mapping',
          'update_event_source_mapping',
          'put_function_event_invoke_config',
        ],
      },
    },
    {
      id: 'onFailureDestination',
      title: 'On Failure Destination ARN',
      type: 'short-input',
      placeholder: 'arn:aws:sqs:us-east-1:123456789012:failure-queue',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'create_event_source_mapping',
          'update_event_source_mapping',
          'put_function_event_invoke_config',
        ],
      },
    },
    {
      id: 'sourceAccessConfigurations',
      title: 'Source Access Configurations (JSON)',
      type: 'code',
      placeholder: '[\n  {"type": "BASIC_AUTH", "uri": "arn:aws:secretsmanager:..."}\n]',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of AWS Lambda event source access configurations. Each element must be an object with a "type" string (one of BASIC_AUTH, VPC_SUBNET, VPC_SECURITY_GROUP, SASL_SCRAM_512_AUTH, SASL_SCRAM_256_AUTH, VIRTUAL_HOST, CLIENT_CERTIFICATE_TLS_AUTH, SERVER_ROOT_CA_CERTIFICATE) and a "uri" string holding the matching ARN.\n\nReturn ONLY valid JSON - no explanations, no markdown code blocks.',
      },
    },
    {
      id: 'documentDbDatabaseName',
      title: 'DocumentDB Database',
      type: 'short-input',
      placeholder: 'my-database',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
    },
    {
      id: 'documentDbCollectionName',
      title: 'DocumentDB Collection',
      type: 'short-input',
      placeholder: 'orders',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
    },
    {
      id: 'documentDbFullDocument',
      title: 'DocumentDB Full Document',
      type: 'dropdown',
      options: [
        { label: 'Default (change delta only)', id: 'Default' },
        { label: 'Update Lookup (full document)', id: 'UpdateLookup' },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
    },
    {
      id: 'amazonManagedKafkaConsumerGroupId',
      title: 'MSK Consumer Group ID',
      type: 'short-input',
      placeholder: 'my-consumer-group',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
    },
    {
      id: 'selfManagedKafkaConsumerGroupId',
      title: 'Self-Managed Kafka Consumer Group ID',
      type: 'short-input',
      placeholder: 'my-consumer-group',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_event_source_mapping', 'update_event_source_mapping'],
      },
    },
    {
      id: 'selfManagedKafkaBootstrapServers',
      title: 'Self-Managed Kafka Bootstrap Servers',
      type: 'short-input',
      placeholder: 'broker-1:9092,broker-2:9092',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_event_source_mapping' },
    },
    {
      id: 'uuid',
      title: 'Mapping UUID',
      type: 'short-input',
      placeholder: 'Identifier of the event source mapping',
      condition: {
        field: 'operation',
        value: [
          'get_event_source_mapping',
          'update_event_source_mapping',
          'delete_event_source_mapping',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_event_source_mapping',
          'update_event_source_mapping',
          'delete_event_source_mapping',
        ],
      },
    },
    {
      id: 'reservedConcurrentExecutions',
      title: 'Reserved Concurrent Executions',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'put_function_concurrency' },
      required: { field: 'operation', value: 'put_function_concurrency' },
    },
    {
      id: 'provisionedConcurrentExecutions',
      title: 'Provisioned Concurrent Executions',
      type: 'short-input',
      placeholder: '5',
      condition: { field: 'operation', value: 'put_provisioned_concurrency_config' },
      required: { field: 'operation', value: 'put_provisioned_concurrency_config' },
    },
    {
      id: 'authType',
      title: 'Auth Type',
      type: 'dropdown',
      options: [
        { label: 'AWS_IAM (signed requests)', id: 'AWS_IAM' },
        { label: 'NONE (public)', id: 'NONE' },
      ],
      condition: {
        field: 'operation',
        value: ['create_function_url_config', 'update_function_url_config'],
      },
      required: { field: 'operation', value: 'create_function_url_config' },
    },
    {
      id: 'invokeMode',
      title: 'Invoke Mode',
      type: 'dropdown',
      options: [
        { label: 'Buffered', id: 'BUFFERED' },
        { label: 'Response Stream', id: 'RESPONSE_STREAM' },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function_url_config', 'update_function_url_config'],
      },
    },
    {
      id: 'corsAllowCredentials',
      title: 'CORS Allow Credentials',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function_url_config', 'update_function_url_config'],
      },
    },
    {
      id: 'corsAllowOrigins',
      title: 'CORS Allow Origins',
      type: 'short-input',
      placeholder: 'https://example.com or *',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function_url_config', 'update_function_url_config'],
      },
    },
    {
      id: 'corsAllowMethods',
      title: 'CORS Allow Methods',
      type: 'short-input',
      placeholder: 'GET,POST or *',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function_url_config', 'update_function_url_config'],
      },
    },
    {
      id: 'corsAllowHeaders',
      title: 'CORS Allow Headers',
      type: 'short-input',
      placeholder: 'content-type,authorization',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function_url_config', 'update_function_url_config'],
      },
    },
    {
      id: 'corsExposeHeaders',
      title: 'CORS Expose Headers',
      type: 'short-input',
      placeholder: 'x-request-id',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function_url_config', 'update_function_url_config'],
      },
    },
    {
      id: 'corsMaxAge',
      title: 'CORS Max Age (seconds)',
      type: 'short-input',
      placeholder: '86400',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_function_url_config', 'update_function_url_config'],
      },
    },
    {
      id: 'maximumEventAgeInSeconds',
      title: 'Max Event Age (seconds)',
      type: 'short-input',
      placeholder: '60-21600',
      mode: 'advanced',
      condition: { field: 'operation', value: 'put_function_event_invoke_config' },
    },
    {
      id: 'compatibleRuntime',
      title: 'Compatible Runtime',
      type: 'short-input',
      placeholder: 'python3.13',
      mode: 'advanced',
      condition: { field: 'operation', value: ['list_layers', 'list_layer_versions'] },
    },
    {
      id: 'compatibleArchitecture',
      title: 'Compatible Architecture',
      type: 'dropdown',
      options: [
        { label: 'x86_64', id: 'x86_64' },
        { label: 'arm64', id: 'arm64' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: ['list_layers', 'list_layer_versions'] },
    },
    {
      id: 'layerName',
      title: 'Layer Name',
      type: 'short-input',
      placeholder: 'my-layer or its ARN',
      condition: { field: 'operation', value: ['list_layer_versions', 'get_layer_version'] },
      required: { field: 'operation', value: ['list_layer_versions', 'get_layer_version'] },
    },
    {
      id: 'versionNumber',
      title: 'Layer Version',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'get_layer_version' },
      required: { field: 'operation', value: 'get_layer_version' },
    },
    {
      id: 'resourceArn',
      title: 'Function ARN',
      type: 'short-input',
      placeholder: 'arn:aws:lambda:us-east-1:123456789012:function:my-function',
      condition: { field: 'operation', value: ['list_tags', 'tag_resource', 'untag_resource'] },
      required: { field: 'operation', value: ['list_tags', 'tag_resource', 'untag_resource'] },
    },
    {
      id: 'tagKeys',
      title: 'Tag Keys',
      type: 'short-input',
      placeholder: 'env,team',
      condition: { field: 'operation', value: 'untag_resource' },
      required: { field: 'operation', value: 'untag_resource' },
    },
    {
      id: 'recursiveLoop',
      title: 'Recursive Loop Detection',
      type: 'dropdown',
      options: [
        { label: 'Terminate (stop after 16 recursions)', id: 'Terminate' },
        { label: 'Allow', id: 'Allow' },
      ],
      condition: { field: 'operation', value: 'put_function_recursion_config' },
      required: { field: 'operation', value: 'put_function_recursion_config' },
    },
    {
      id: 'updateRuntimeOn',
      title: 'Update Runtime On',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'Auto' },
        { label: 'Function Update', id: 'FunctionUpdate' },
        { label: 'Manual', id: 'Manual' },
      ],
      condition: { field: 'operation', value: 'put_runtime_management_config' },
      required: { field: 'operation', value: 'put_runtime_management_config' },
    },
    {
      id: 'runtimeVersionArn',
      title: 'Runtime Version ARN',
      type: 'short-input',
      placeholder: 'arn:aws:lambda:us-east-1::runtime:abc123',
      condition: { field: 'operation', value: 'put_runtime_management_config' },
      required: { field: 'updateRuntimeOn', value: 'Manual' },
    },
  ],
  tools: {
    access: [
      'lambda_invoke',
      'lambda_list_functions',
      'lambda_get_function',
      'lambda_get_function_configuration',
      'lambda_create_function',
      'lambda_update_function_code',
      'lambda_update_function_configuration',
      'lambda_delete_function',
      'lambda_publish_version',
      'lambda_list_versions_by_function',
      'lambda_create_alias',
      'lambda_get_alias',
      'lambda_update_alias',
      'lambda_delete_alias',
      'lambda_list_aliases',
      'lambda_add_permission',
      'lambda_remove_permission',
      'lambda_get_policy',
      'lambda_create_event_source_mapping',
      'lambda_get_event_source_mapping',
      'lambda_update_event_source_mapping',
      'lambda_delete_event_source_mapping',
      'lambda_list_event_source_mappings',
      'lambda_get_function_concurrency',
      'lambda_put_function_concurrency',
      'lambda_delete_function_concurrency',
      'lambda_get_provisioned_concurrency_config',
      'lambda_put_provisioned_concurrency_config',
      'lambda_delete_provisioned_concurrency_config',
      'lambda_list_provisioned_concurrency_configs',
      'lambda_create_function_url_config',
      'lambda_get_function_url_config',
      'lambda_update_function_url_config',
      'lambda_delete_function_url_config',
      'lambda_list_function_url_configs',
      'lambda_get_function_event_invoke_config',
      'lambda_put_function_event_invoke_config',
      'lambda_delete_function_event_invoke_config',
      'lambda_list_function_event_invoke_configs',
      'lambda_list_layers',
      'lambda_list_layer_versions',
      'lambda_get_layer_version',
      'lambda_list_tags',
      'lambda_tag_resource',
      'lambda_untag_resource',
      'lambda_get_account_settings',
      'lambda_get_function_recursion_config',
      'lambda_put_function_recursion_config',
      'lambda_get_runtime_management_config',
      'lambda_put_runtime_management_config',
    ],
    config: {
      tool: (params) => {
        const operation = String(params.operation ?? '')
        if (!(operation in OPERATION_PARAMS)) {
          throw new Error(`Invalid Lambda operation: ${params.operation}`)
        }
        return `lambda_${operation}`
      },
      params: (params) => {
        const operation = String(params.operation ?? '')
        const owned = OPERATION_PARAMS[operation]
        if (!owned) {
          throw new Error(`Invalid Lambda operation: ${params.operation}`)
        }

        const ownedNames = new Set<ParamName>(owned)
        const result: Record<string, unknown> = {
          awsRegion: params.awsRegion,
          awsAccessKeyId: params.awsAccessKeyId,
          awsSecretAccessKey: params.awsSecretAccessKey,
        }
        for (const name of ALL_PARAM_NAMES) {
          result[name] = ownedNames.has(name) ? coerceParam(name, params[name]) : undefined
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Lambda operation to perform' },
    awsRegion: { type: 'string', description: 'AWS region' },
    awsAccessKeyId: { type: 'string', description: 'AWS access key ID' },
    awsSecretAccessKey: { type: 'string', description: 'AWS secret access key' },
    functionName: { type: 'string', description: 'Function Name' },
    payload: { type: 'json', description: 'Payload' },
    invocationType: { type: 'string', description: 'Invocation Type' },
    logType: { type: 'string', description: 'Log Type' },
    clientContext: { type: 'string', description: 'Client Context' },
    qualifier: { type: 'string', description: 'Qualifier' },
    functionVersion: { type: 'string', description: 'Include All Versions' },
    masterRegion: { type: 'string', description: 'Master Region' },
    marker: { type: 'string', description: 'Marker' },
    maxItems: { type: 'number', description: 'Max Items' },
    role: { type: 'string', description: 'Execution Role ARN' },
    runtime: { type: 'string', description: 'Runtime' },
    handler: { type: 'string', description: 'Handler' },
    packageType: { type: 'string', description: 'Package Type' },
    s3Bucket: { type: 'string', description: 'S3 Bucket' },
    s3Key: { type: 'string', description: 'S3 Key' },
    s3ObjectVersion: { type: 'string', description: 'S3 Object Version' },
    imageUri: { type: 'string', description: 'Image URI' },
    sourceKmsKeyArn: { type: 'string', description: 'Source KMS Key ARN' },
    description: { type: 'string', description: 'Description' },
    timeout: { type: 'number', description: 'Timeout (seconds)' },
    memorySize: { type: 'number', description: 'Memory (MB)' },
    ephemeralStorageSize: { type: 'number', description: 'Ephemeral Storage (MB)' },
    publish: { type: 'boolean', description: 'Publish Version' },
    environment: { type: 'json', description: 'Environment Variables (JSON)' },
    tags: { type: 'json', description: 'Tags (JSON)' },
    architectures: { type: 'array', description: 'Architectures' },
    layers: { type: 'array', description: 'Layer ARNs' },
    vpcSubnetIds: { type: 'array', description: 'VPC Subnet IDs' },
    vpcSecurityGroupIds: { type: 'array', description: 'VPC Security Group IDs' },
    tracingMode: { type: 'string', description: 'X-Ray Tracing' },
    deadLetterTargetArn: { type: 'string', description: 'Dead Letter Queue ARN' },
    kmsKeyArn: { type: 'string', description: 'KMS Key ARN' },
    snapStartApplyOn: { type: 'string', description: 'SnapStart' },
    logFormat: { type: 'string', description: 'Log Format' },
    logGroup: { type: 'string', description: 'Log Group' },
    dryRun: { type: 'boolean', description: 'Dry Run' },
    revisionId: { type: 'string', description: 'Revision ID' },
    codeSha256: { type: 'string', description: 'Code SHA256' },
    aliasName: { type: 'string', description: 'Alias Name' },
    aliasFunctionVersion: { type: 'string', description: 'Alias Target Version' },
    additionalVersionWeights: { type: 'json', description: 'Weighted Routing (JSON)' },
    statementId: { type: 'string', description: 'Statement ID' },
    action: { type: 'string', description: 'Action' },
    principal: { type: 'string', description: 'Principal' },
    sourceArn: { type: 'string', description: 'Source ARN' },
    sourceAccount: { type: 'string', description: 'Source Account' },
    principalOrgId: { type: 'string', description: 'Principal Org ID' },
    eventSourceToken: { type: 'string', description: 'Event Source Token' },
    functionUrlAuthType: { type: 'string', description: 'Function URL Auth Type' },
    eventSourceArn: { type: 'string', description: 'Event Source ARN' },
    enabled: { type: 'boolean', description: 'Enabled' },
    batchSize: { type: 'number', description: 'Batch Size' },
    maximumBatchingWindowInSeconds: { type: 'number', description: 'Batching Window (seconds)' },
    startingPosition: { type: 'string', description: 'Starting Position' },
    startingPositionTimestamp: { type: 'string', description: 'Starting Position Timestamp' },
    parallelizationFactor: { type: 'number', description: 'Parallelization Factor' },
    maximumRecordAgeInSeconds: { type: 'number', description: 'Max Record Age (seconds)' },
    maximumRetryAttempts: { type: 'number', description: 'Max Retry Attempts' },
    bisectBatchOnFunctionError: { type: 'boolean', description: 'Bisect Batch On Error' },
    tumblingWindowInSeconds: { type: 'number', description: 'Tumbling Window (seconds)' },
    maximumConcurrency: { type: 'number', description: 'Max Concurrency' },
    topics: { type: 'array', description: 'Kafka Topics' },
    queues: { type: 'array', description: 'Amazon MQ Queues' },
    functionResponseTypes: { type: 'array', description: 'Function Response Types' },
    filterPatterns: { type: 'array', description: 'Filter Patterns (JSON array)' },
    onSuccessDestination: { type: 'string', description: 'On Success Destination ARN' },
    onFailureDestination: { type: 'string', description: 'On Failure Destination ARN' },
    sourceAccessConfigurations: {
      type: 'json',
      description: 'Source Access Configurations (JSON)',
    },
    documentDbDatabaseName: { type: 'string', description: 'DocumentDB Database' },
    documentDbCollectionName: { type: 'string', description: 'DocumentDB Collection' },
    documentDbFullDocument: { type: 'string', description: 'DocumentDB Full Document' },
    amazonManagedKafkaConsumerGroupId: { type: 'string', description: 'MSK Consumer Group ID' },
    selfManagedKafkaConsumerGroupId: {
      type: 'string',
      description: 'Self-Managed Kafka Consumer Group ID',
    },
    selfManagedKafkaBootstrapServers: {
      type: 'array',
      description: 'Self-Managed Kafka Bootstrap Servers',
    },
    uuid: { type: 'string', description: 'Mapping UUID' },
    reservedConcurrentExecutions: { type: 'number', description: 'Reserved Concurrent Executions' },
    provisionedConcurrentExecutions: {
      type: 'number',
      description: 'Provisioned Concurrent Executions',
    },
    authType: { type: 'string', description: 'Auth Type' },
    invokeMode: { type: 'string', description: 'Invoke Mode' },
    corsAllowCredentials: { type: 'boolean', description: 'CORS Allow Credentials' },
    corsAllowOrigins: { type: 'array', description: 'CORS Allow Origins' },
    corsAllowMethods: { type: 'array', description: 'CORS Allow Methods' },
    corsAllowHeaders: { type: 'array', description: 'CORS Allow Headers' },
    corsExposeHeaders: { type: 'array', description: 'CORS Expose Headers' },
    corsMaxAge: { type: 'number', description: 'CORS Max Age (seconds)' },
    maximumEventAgeInSeconds: { type: 'number', description: 'Max Event Age (seconds)' },
    compatibleRuntime: { type: 'string', description: 'Compatible Runtime' },
    compatibleArchitecture: { type: 'string', description: 'Compatible Architecture' },
    layerName: { type: 'string', description: 'Layer Name' },
    versionNumber: { type: 'number', description: 'Layer Version' },
    resourceArn: { type: 'string', description: 'Function ARN' },
    tagKeys: { type: 'array', description: 'Tag Keys' },
    recursiveLoop: { type: 'string', description: 'Recursive Loop Detection' },
    updateRuntimeOn: { type: 'string', description: 'Update Runtime On' },
    runtimeVersionArn: { type: 'string', description: 'Runtime Version ARN' },
  },
  outputs: {
    statusCode: {
      type: 'number',
      description:
        'HTTP status of the invocation (200 for RequestResponse, 202 for Event, 204 for DryRun)',
    },
    payload: {
      type: 'json',
      description: 'The response returned by the function, parsed as JSON when possible',
    },
    functionError: {
      type: 'string',
      description: 'Set to Handled or Unhandled when the function itself returned an error',
    },
    logResult: {
      type: 'string',
      description: 'Decoded execution log tail, present only when logType is Tail',
    },
    executedVersion: {
      type: 'string',
      description: 'The function version that was executed',
    },
    functions: {
      type: 'array',
      description: 'Lambda functions with their runtime, handler, memory, and state',
    },
    nextMarker: {
      type: 'string',
      description: 'Pagination token to pass as marker on the next request',
    },
    configuration: {
      type: 'json',
      description:
        "The function's configuration (ARN, runtime, handler, memory, state, layers, VPC, and logging settings)",
    },
    code: {
      type: 'json',
      description: 'Presigned download URL for the deployment package, or the container image URI',
    },
    tags: {
      type: 'json',
      description: "The function's tags",
    },
    reservedConcurrentExecutions: {
      type: 'number',
      description: 'Concurrency reserved for this function, if any',
    },
    message: { type: 'string', description: 'Operation status message' },
    versions: {
      type: 'array',
      description: 'Published versions of the function, plus the unpublished $LATEST version',
    },
    alias: {
      type: 'json',
      description: 'The alias with its ARN, target version, and routing configuration',
    },
    aliases: {
      type: 'array',
      description: 'Aliases with their ARNs, target versions, and routing configuration',
    },
    statement: {
      type: 'string',
      description: 'The permission statement that was added, as a JSON document string',
    },
    policy: {
      type: 'string',
      description: 'The resource-based policy, as a JSON document string',
    },
    revisionId: {
      type: 'string',
      description: 'Current revision ID of the policy',
    },
    eventSourceMapping: {
      type: 'json',
      description: 'The event source mapping with its UUID, state, batching, and filter settings',
    },
    eventSourceMappings: {
      type: 'array',
      description: 'Event source mappings with their UUIDs, state, and batching settings',
    },
    provisionedConcurrency: {
      type: 'json',
      description: 'Requested, available, and allocated provisioned concurrency with its status',
    },
    provisionedConcurrencyConfigs: {
      type: 'array',
      description: 'Provisioned concurrency configurations with their allocation status',
    },
    functionUrlConfig: {
      type: 'json',
      description: 'The function URL with its auth type, invoke mode, and CORS settings',
    },
    functionUrlConfigs: {
      type: 'array',
      description: 'Function URLs with their auth types, invoke modes, and CORS settings',
    },
    eventInvokeConfig: {
      type: 'json',
      description: 'Asynchronous invocation retry limits and success/failure destinations',
    },
    eventInvokeConfigs: {
      type: 'array',
      description: 'Asynchronous invocation configurations for the function versions and aliases',
    },
    layers: {
      type: 'array',
      description: 'Layers with their ARNs and latest matching version',
    },
    layerVersions: {
      type: 'array',
      description: 'Layer versions with their ARNs, compatible runtimes, and license info',
    },
    layerVersion: {
      type: 'json',
      description:
        'The layer version with its ARN, compatible runtimes, and a presigned content download URL',
    },
    accountLimit: {
      type: 'json',
      description: 'Account-level storage and concurrency limits',
    },
    accountUsage: {
      type: 'json',
      description: 'Current code storage used and number of functions deployed',
    },
    recursiveLoop: {
      type: 'string',
      description:
        'Terminate stops the function after 16 recursive invocations, Allow permits recursion',
    },
    updateRuntimeOn: {
      type: 'string',
      description: 'Auto, FunctionUpdate, or Manual runtime update policy',
    },
    runtimeVersionArn: {
      type: 'string',
      description: 'ARN of the pinned runtime version, when the policy is Manual',
    },
    functionArn: {
      type: 'string',
      description: 'ARN of the function the policy applies to',
    },
  },
}

export const LambdaBlockMeta = {
  tags: ['cloud'],
  url: 'https://aws.amazon.com/lambda',
  templates: [
    {
      icon: LambdaIcon,
      title: 'Lambda function runner',
      prompt:
        'Create a workflow that takes a JSON request as input, invokes an AWS Lambda function with it, parses the returned payload, and posts the result to Slack. If the invocation returns a function error, include the decoded execution log tail in the alert.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'engineering'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: LambdaIcon,
      title: 'Lambda function inventory',
      prompt:
        'Build a scheduled weekly workflow that lists every AWS Lambda function in the account, captures runtime, memory, timeout, last modified date, and architecture, and writes the inventory into a tracking table so the platform team can spot deprecated runtimes.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting', 'enterprise'],
    },
    {
      icon: LambdaIcon,
      title: 'Lambda deprecated runtime sweep',
      prompt:
        'Create a scheduled monthly workflow that lists all Lambda functions, flags any running a deprecated runtime, groups them by owning team using function tags, and opens a Linear ticket per team with the list of functions that need upgrading.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'enterprise'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: LambdaIcon,
      title: 'Lambda blue-green release',
      prompt:
        'Build a workflow that updates a Lambda function from a new S3 deployment package, publishes a version, shifts 10 percent of alias traffic to it with weighted routing, waits for approval in Slack, then promotes the alias to 100 percent or rolls it back.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: LambdaIcon,
      title: 'Lambda concurrency guard',
      prompt:
        'Create a scheduled workflow that reads Lambda account settings and each function reserved concurrency, detects when unreserved concurrency drops below a safe floor, and alerts the on-call channel with the functions consuming the most reserved capacity.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: LambdaIcon,
      title: 'Lambda event source auditor',
      prompt:
        'Build a scheduled workflow that lists every Lambda event source mapping, flags any whose state is not Enabled or whose last processing result reports errors, summarizes the likely cause, and posts a daily digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: LambdaIcon,
      title: 'Lambda permission reviewer',
      prompt:
        'Create a scheduled workflow that reads the resource-based policy of every Lambda function, flags statements that grant access to a wildcard principal or an account outside your organization, and writes a written findings report for the security team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise', 'reporting'],
    },
    {
      icon: LambdaIcon,
      title: 'Lambda public URL detector',
      prompt:
        'Build a scheduled workflow that lists Lambda function URL configurations across your functions, flags any whose auth type is NONE or whose CORS allows any origin, and opens a Linear ticket for each exposed endpoint.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'enterprise'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: LambdaIcon,
      title: 'Lambda async failure triage',
      prompt:
        'Create a workflow that reads the asynchronous invocation configuration of a Lambda function, pulls failed invocation records from its on-failure destination queue, invokes the function again in dry run mode to check permissions, and summarizes the failure cause in Slack.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'invoke-lambda-function',
      description:
        'Invoke an AWS Lambda function with a JSON payload and interpret its response, including function errors and log output.',
      content:
        '# Invoke a Lambda Function\n\nRun a function and read back what it returned.\n\n## Steps\n1. Confirm the function name, ARN, or alias to invoke, and the qualifier if a specific version or alias is needed.\n2. Choose the invocation type: RequestResponse to wait for the result, Event to queue it, DryRun to only check permissions.\n3. Send the JSON event payload the handler expects.\n4. Set the log type to Tail when you need the execution log to diagnose a failure.\n5. Check functionError before trusting the payload: a value of Handled or Unhandled means the function itself failed even though the API call succeeded.\n\n## Output\nThe parsed response payload, the executed version, and, when a function error occurred, the decoded log tail and the failure reason.',
    },
    {
      name: 'inventory-lambda-functions',
      description:
        'List Lambda functions with their runtime, memory, timeout, and architecture to build an inventory of deployed compute.',
      content:
        '# Inventory Lambda Functions\n\nBuild a single view of every deployed function.\n\n## Steps\n1. List all functions, paginating with the returned marker until no marker comes back.\n2. Capture name, ARN, runtime, handler, memory, timeout, architecture, and last modified date for each.\n3. Note that listing functions returns a subset of fields, so fetch a function individually when you need its state, state reason, or runtime version.\n4. Flag functions on runtimes AWS has deprecated.\n\n## Output\nA table of functions with runtime, memory, timeout, architecture, and any that need a runtime upgrade.',
    },
    {
      name: 'release-lambda-version',
      description:
        'Deploy new Lambda code, publish an immutable version, and shift alias traffic to it safely.',
      content:
        '# Release a Lambda Version\n\nShip new code without an all-at-once cutover.\n\n## Steps\n1. Update the function code from the new S3 object or container image.\n2. Wait until the function last update status is Successful before publishing.\n3. Publish a version to freeze the current code and configuration.\n4. Update the alias with weighted routing so a small share of traffic reaches the new version.\n5. After the canary looks healthy, point the alias fully at the new version. To roll back, point it at the previous one.\n\n## Output\nThe published version number, the alias routing configuration in effect, and confirmation of whether the release was promoted or rolled back.',
    },
    {
      name: 'audit-lambda-permissions',
      description:
        'Read Lambda resource-based policies and function URL settings to find functions exposed more broadly than intended.',
      content:
        '# Audit Lambda Access\n\nFind functions that anyone can invoke.\n\n## Steps\n1. For each function, read the resource-based policy.\n2. Flag statements whose principal is a wildcard, or an AWS account outside your organization, without a source ARN or source account condition.\n3. List the function URL configurations and flag any whose auth type is NONE.\n4. For URLs with CORS, flag configurations that allow any origin.\n\n## Output\nA per-function list of over-permissive policy statements and publicly reachable function URLs, with the specific statement ID or URL to remediate.',
    },
  ],
} as const satisfies BlockMeta
