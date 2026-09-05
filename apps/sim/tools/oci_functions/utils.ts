import type { ToolConfig } from '@/tools/types'

export const ociFunctionsAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Reusable OCI API-key service-account credential ID',
  },
  region: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'OCI region identifier; omit to use the credential region',
  },
} satisfies ToolConfig['params']
export const ociFunctionsListParams = {
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Page size, 1–50 (default 10)',
  },
  page: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Continuation token from nextPage; returns one page only',
  },
  displayName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Exact display-name filter',
  },
  id: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Exact resource OCID filter',
  },
  lifecycleState: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Resource lifecycle state, such as ACTIVE; functions also support INACTIVE',
  },
  sortBy: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Sort by timeCreated, id, or displayName',
  },
  sortOrder: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'ASC or DESC',
  },
} satisfies ToolConfig['params']
export const ociFunctionsIfMatchParam = {
  ifMatch: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'ETag from a resource read; reject the mutation if the resource changed',
  },
} satisfies ToolConfig['params']
export const OCI_FUNCTIONS_APPLICATION_CONFIGURATION_DESCRIPTION =
  'JSON settings: config (string map; at most 100 entries/4096 UTF-8 bytes), networkSecurityGroupIds (at most 5), syslogUrl, traceConfig {domainId,isEnabled}, logging {lineFormat: JSON|PLAIN_TEXT}, freeformTags, definedTags, imagePolicyConfig {isPolicyEnabled,keyDetails:[{kmsKeyId}]}, securityAttributes {namespace:{key:{value,mode: enforce}}}. Supplied maps/objects replace existing values; omit to preserve. Use config:{} to clear configuration.'
export const OCI_FUNCTIONS_FUNCTION_CONFIGURATION_DESCRIPTION =
  'JSON settings: config (string map; effective application plus function configuration must fit 4096 UTF-8 bytes), imageDigest, timeoutInSeconds (1–300), detachedModeTimeoutInSeconds (5–3600), provisionedConcurrencyConfig {strategy: NONE} or {strategy: CONSTANT,count}, successDestination/failureDestination {destinationType: NONE|STREAM|QUEUE|NOTIFICATION, streamId|queueId|topicId, optional channelId for QUEUE}, traceConfig {isEnabled}, freeformTags, definedTags. Supplied maps/objects replace existing values; omit to preserve. Use config:{} to clear function overrides.'
