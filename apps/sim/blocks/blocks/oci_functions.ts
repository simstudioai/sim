import { OracleIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { OciFunctionsResponse } from '@/tools/oci_functions/types'

const OPERATION_PARAMS = {
  invoke: [
    'functionId',
    'invocationType',
    'dryRun',
    'intent',
    'payloadType',
    'payload',
    'file',
    'contentType',
    'outputFormat',
    'timeoutMs',
  ],
  list_applications: [
    'compartmentId',
    'limit',
    'page',
    'displayName',
    'id',
    'lifecycleState',
    'sortBy',
    'sortOrder',
  ],
  get_application: ['applicationId'],
  create_application: ['compartmentId', 'displayName', 'subnetIds', 'shape', 'configuration'],
  update_application: ['applicationId', 'configuration', 'ifMatch'],
  delete_application: ['applicationId', 'ifMatch'],
  change_application_compartment: ['applicationId', 'compartmentId', 'ifMatch'],
  list_functions: [
    'applicationId',
    'limit',
    'page',
    'displayName',
    'id',
    'lifecycleState',
    'sortBy',
    'sortOrder',
  ],
  get_function: ['functionId'],
  create_function: ['applicationId', 'displayName', 'image', 'memoryInMBs', 'configuration'],
  update_function: ['functionId', 'image', 'memoryInMBs', 'configuration', 'ifMatch'],
  delete_function: ['functionId', 'ifMatch'],
} as const

type Operation = keyof typeof OPERATION_PARAMS
function operation(value: unknown): Operation {
  if (typeof value !== 'string' || !Object.hasOwn(OPERATION_PARAMS, value)) {
    throw new Error('Invalid OCI Functions operation')
  }
  return value as Operation
}

function parseJson(value: unknown, label: string): unknown {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === '') return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error('Dry run must be true or false')
}

export const OciFunctionsBlock: BlockConfig<OciFunctionsResponse> = {
  type: 'oci_functions',
  name: 'OCI Functions',
  description: 'Invoke and manage Oracle Cloud Functions',
  longDescription:
    'Use a reusable OCI API-key service account to invoke functions synchronously or in detached mode, discover applications and functions, and manage their configuration and existing container image references. Detached acknowledgements do not contain completed results. Image builds, registry uploads, and source deployment are outside this integration.',
  docsLink: 'https://docs.sim.ai/integrations/oci_functions',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#FFFFFF',
  icon: OracleIcon,
  canvasPresentation: {
    defaultTitle: 'OCI Functions',
    sentences: {
      byOperation: {
        invoke: [{ text: 'Invoke', field: ['functionSelector', 'functionManual'], core: true }],
        list_applications: [{ text: 'List applications in', field: 'compartmentId', core: true }],
        get_application: [
          { text: 'Read', field: ['applicationSelector', 'applicationManual'], core: true },
        ],
        create_application: [
          { text: 'Create application', field: 'displayName', core: true },
          { text: 'in', field: 'compartmentId', core: true },
        ],
        update_application: [
          { text: 'Update', field: ['applicationSelector', 'applicationManual'], core: true },
        ],
        delete_application: [
          { text: 'Delete', field: ['applicationSelector', 'applicationManual'], core: true },
        ],
        change_application_compartment: [
          { text: 'Move', field: ['applicationSelector', 'applicationManual'], core: true },
          { text: 'to', field: 'compartmentId', core: true },
        ],
        list_functions: [
          {
            text: 'List functions in',
            field: ['applicationSelector', 'applicationManual'],
            core: true,
          },
        ],
        get_function: [{ text: 'Read', field: ['functionSelector', 'functionManual'], core: true }],
        create_function: [
          { text: 'Create function', field: 'displayName', core: true },
          { text: 'in', field: ['applicationSelector', 'applicationManual'], core: true },
        ],
        update_function: [
          { text: 'Update', field: ['functionSelector', 'functionManual'], core: true },
        ],
        delete_function: [
          { text: 'Delete', field: ['functionSelector', 'functionManual'], core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'OCI Account',
      type: 'oauth-input',
      serviceId: 'oci-functions',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      placeholder: 'Select OCI credential',
    },
    {
      id: 'manualCredential',
      title: 'OCI Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      required: true,
      placeholder: 'Enter credential ID',
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      required: true,
      value: () => 'list_applications',
      options: [
        { id: 'invoke', label: 'Invoke' },
        { id: 'list_applications', label: 'List Applications' },
        { id: 'get_application', label: 'Get Application' },
        { id: 'create_application', label: 'Create Application' },
        { id: 'update_application', label: 'Update Application' },
        { id: 'delete_application', label: 'Delete Application' },
        { id: 'change_application_compartment', label: 'Change Application Compartment' },
        { id: 'list_functions', label: 'List Functions' },
        { id: 'get_function', label: 'Get Function' },
        { id: 'create_function', label: 'Create Function' },
        { id: 'update_function', label: 'Update Function' },
        { id: 'delete_function', label: 'Delete Function' },
      ],
    },
    {
      id: 'ociRegion',
      title: 'Region',
      type: 'short-input',
      value: () => 'credential',
      placeholder: 'credential or us-ashburn-1',
      description: 'Use credential for its configured region, or enter an OCI region identifier.',
    },
    {
      id: 'compartmentId',
      title: 'Compartment',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['list_applications', 'create_application', 'change_application_compartment'],
      },
      required: true,
      description:
        'Compartment to list or create in, or the destination for Change Application Compartment.',
      placeholder: 'ocid1.compartment...',
    },
    {
      id: 'applicationCompartmentId',
      title: 'Application Compartment',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'get_application',
          'update_application',
          'delete_application',
          'change_application_compartment',
          'list_functions',
          'create_function',
          'invoke',
          'get_function',
          'update_function',
          'delete_function',
        ],
      },
      mode: 'basic',
      description:
        'Used only to discover applications. In advanced mode, enter the known application or function OCID directly.',
      placeholder: 'Compartment containing the application',
    },
    {
      id: 'applicationSelector',
      title: 'Application',
      type: 'project-selector',
      condition: {
        field: 'operation',
        value: [
          'get_application',
          'update_application',
          'delete_application',
          'change_application_compartment',
          'list_functions',
          'create_function',
          'invoke',
          'get_function',
          'update_function',
          'delete_function',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_application',
          'update_application',
          'delete_application',
          'change_application_compartment',
          'list_functions',
          'create_function',
        ],
      },
      mode: 'basic',
      canonicalParamId: 'applicationId',
      serviceId: 'oci-functions',
      selectorKey: 'oci-functions.applications',
      dependsOn: ['credential', 'ociRegion', 'applicationCompartmentId'],
      placeholder: 'Select application',
    },
    {
      id: 'applicationManual',
      title: 'Application',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'get_application',
          'update_application',
          'delete_application',
          'change_application_compartment',
          'list_functions',
          'create_function',
          'invoke',
          'get_function',
          'update_function',
          'delete_function',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_application',
          'update_application',
          'delete_application',
          'change_application_compartment',
          'list_functions',
          'create_function',
        ],
      },
      mode: 'advanced',
      canonicalParamId: 'applicationId',
      placeholder: 'ocid1.fnapp...',
    },
    {
      id: 'functionSelector',
      title: 'Function',
      type: 'project-selector',
      condition: {
        field: 'operation',
        value: ['invoke', 'get_function', 'update_function', 'delete_function'],
      },
      required: true,
      mode: 'basic',
      canonicalParamId: 'functionId',
      serviceId: 'oci-functions',
      selectorKey: 'oci-functions.functions',
      dependsOn: ['credential', 'ociRegion', 'applicationSelector'],
      placeholder: 'Select function',
    },
    {
      id: 'functionManual',
      title: 'Function',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['invoke', 'get_function', 'update_function', 'delete_function'],
      },
      required: true,
      mode: 'advanced',
      canonicalParamId: 'functionId',
      placeholder: 'ocid1.fnfunc...',
    },
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['list_applications', 'list_functions', 'create_application', 'create_function'],
      },
      required: { field: 'operation', value: ['create_application', 'create_function'] },
      description: 'New resource name for creation, or an exact display-name filter when listing.',
    },
    {
      id: 'subnetIds',
      title: 'Subnet OCIDs',
      type: 'code',
      condition: { field: 'operation', value: ['create_application'] },
      required: true,
      language: 'json',
      placeholder: '["ocid1.subnet..."]',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        prompt: 'Use the supplied OCI subnet OCIDs. Return ONLY the JSON array.',
      },
    },
    {
      id: 'shape',
      title: 'Architecture',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_application'] },
      mode: 'advanced',
      options: [
        { id: 'GENERIC_X86', label: 'x86' },
        { id: 'GENERIC_ARM', label: 'Arm' },
        { id: 'GENERIC_X86_ARM', label: 'x86 and Arm' },
      ],
    },
    {
      id: 'image',
      title: 'Container Image',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_function', 'update_function'] },
      required: { field: 'operation', value: ['create_function'] },
      description:
        'Reference an existing image in OCI Registry in the function region. The integration does not build or upload it.',
      placeholder: 'iad.ocir.io/namespace/repository:tag',
    },
    {
      id: 'memoryInMBs',
      title: 'Memory (MB)',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_function', 'update_function'] },
      required: { field: 'operation', value: ['create_function'] },
      placeholder: '128, 256, 512, 1024, 2048, or 3072',
    },
    {
      id: 'configuration',
      title: 'Configuration',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['create_application', 'update_application', 'create_function', 'update_function'],
      },
      required: { field: 'operation', value: ['update_application'] },
      description:
        'Documented settings object. Supplied maps replace existing values; omit fields to preserve them. Use {"config":{}} to clear configuration. Advanced settings include tags, tracing, concurrency, and destinations; see tool documentation.',
      language: 'json',
      placeholder: '{"config":{"ENV":"production"}}',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Generate documented OCI Functions settings for the selected application or function operation. Supplied maps replace existing values; omit fields that should stay unchanged. Return ONLY the JSON object.',
      },
    },
    {
      id: 'ifMatch',
      title: 'If Match (ETag)',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'update_application',
          'delete_application',
          'change_application_compartment',
          'update_function',
          'delete_function',
        ],
      },
      mode: 'advanced',
      description:
        'Require the ETag returned by Get Application or Get Function to match before changing the resource.',
    },
    {
      id: 'limit',
      title: 'Page Size',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_applications', 'list_functions'] },
      mode: 'advanced',
      placeholder: '10 (maximum 50)',
    },
    {
      id: 'page',
      title: 'Page Token',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_applications', 'list_functions'] },
      mode: 'advanced',
    },
    {
      id: 'id',
      title: 'Resource OCID Filter',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_applications', 'list_functions'] },
      mode: 'advanced',
    },
    {
      id: 'lifecycleState',
      title: 'Lifecycle State',
      type: 'short-input',
      condition: { field: 'operation', value: ['list_applications', 'list_functions'] },
      mode: 'advanced',
      placeholder: 'ACTIVE',
      description: 'Resource lifecycle state. Function lists also support INACTIVE.',
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_applications', 'list_functions'] },
      mode: 'advanced',
      options: [
        { id: 'timeCreated', label: 'timeCreated' },
        { id: 'id', label: 'id' },
        { id: 'displayName', label: 'displayName' },
      ],
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      condition: { field: 'operation', value: ['list_applications', 'list_functions'] },
      mode: 'advanced',
      options: [
        { id: 'ASC', label: 'ASC' },
        { id: 'DESC', label: 'DESC' },
      ],
    },
    {
      id: 'invocationType',
      title: 'Invocation Mode',
      type: 'dropdown',
      condition: { field: 'operation', value: ['invoke'] },
      description:
        'Detached acknowledgement means processing was accepted, not completed. Configure Oracle success/failure destinations for detached results.',
      value: () => 'sync',
      options: [
        { id: 'sync', label: 'Synchronous' },
        { id: 'detached', label: 'Detached' },
      ],
    },
    {
      id: 'payloadType',
      title: 'Payload Type',
      type: 'dropdown',
      condition: { field: 'operation', value: ['invoke'] },
      value: () => 'json',
      options: [
        { id: 'json', label: 'JSON' },
        { id: 'text', label: 'Text' },
        { id: 'file', label: 'File' },
      ],
    },
    {
      id: 'payload',
      title: 'Payload',
      type: 'long-input',
      condition: {
        field: 'operation',
        value: 'invoke',
        and: { field: 'payloadType', value: ['json', 'text'] },
      },
      placeholder: '{"message":"hello"}',
      description: 'JSON value or plain text, up to 6 MB. Leave empty for an empty body.',
    },
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      condition: {
        field: 'operation',
        value: 'invoke',
        and: { field: 'payloadType', value: 'file' },
      },
      mode: 'basic',
      multiple: false,
      maxSize: 6,
      required: true,
      placeholder: 'Upload one file (up to 6 MB)',
    },
    {
      id: 'fileReference',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      condition: {
        field: 'operation',
        value: 'invoke',
        and: { field: 'payloadType', value: 'file' },
      },
      mode: 'advanced',
      required: true,
      placeholder: 'Reference an uploaded file',
    },
    {
      id: 'dryRun',
      title: 'Dry Run',
      type: 'switch',
      condition: { field: 'operation', value: ['invoke'] },
      mode: 'advanced',
      description: 'Validate the invocation without running the function.',
    },
    {
      id: 'intent',
      title: 'Invocation Intent',
      type: 'dropdown',
      condition: { field: 'operation', value: ['invoke'] },
      mode: 'advanced',
      options: [
        { id: 'httprequest', label: 'HTTP request' },
        { id: 'cloudevent', label: 'CloudEvent' },
      ],
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'short-input',
      condition: { field: 'operation', value: ['invoke'] },
      mode: 'advanced',
      placeholder: 'Infer from payload',
    },
    {
      id: 'outputFormat',
      title: 'Output Format',
      type: 'dropdown',
      condition: { field: 'operation', value: ['invoke'] },
      mode: 'advanced',
      value: () => 'auto',
      options: [
        { id: 'auto', label: 'Automatic JSON, text, or file' },
        { id: 'file', label: 'File' },
      ],
    },
    {
      id: 'timeoutMs',
      title: 'Client Timeout (ms)',
      type: 'short-input',
      condition: { field: 'operation', value: ['invoke'] },
      mode: 'advanced',
      description:
        'Maximum client wait, 1–300000 ms. Cancellation stops waiting and does not stop a function already running in Oracle. Do not automatically retry invocations after a lost response.',
      placeholder: '300000',
    },
  ],
  tools: {
    access: [
      'oci_functions_invoke',
      'oci_functions_list_applications',
      'oci_functions_get_application',
      'oci_functions_create_application',
      'oci_functions_update_application',
      'oci_functions_delete_application',
      'oci_functions_change_application_compartment',
      'oci_functions_list_functions',
      'oci_functions_get_function',
      'oci_functions_create_function',
      'oci_functions_update_function',
      'oci_functions_delete_function',
    ],
    config: {
      tool: (params) => `oci_functions_${operation(params.operation)}`,
      params: (params) => {
        const selected = operation(params.operation)
        /** The executor merges this patch over raw inputs: explicitly unset stale semantic fields. */
        const result: Record<string, unknown> = Object.fromEntries(
          Object.values(OPERATION_PARAMS)
            .flat()
            .map((key) => [key, undefined])
        )
        result.oauthCredential = params.oauthCredential
        result.region =
          params.ociRegion === 'credential' || params.ociRegion === ''
            ? undefined
            : params.ociRegion
        for (const key of OPERATION_PARAMS[selected]) {
          result[key] = params[key] === '' && key !== 'payload' ? undefined : params[key]
        }
        if (
          'configuration' in result &&
          OPERATION_PARAMS[selected].some((key) => key === 'configuration')
        ) {
          result.configuration = parseJson(params.configuration, 'Configuration')
        }
        if (selected === 'create_application')
          result.subnetIds = parseJson(params.subnetIds, 'Subnet OCIDs')
        if (selected === 'create_function' || selected === 'update_function') {
          result.memoryInMBs = parseOptionalNumberInput(params.memoryInMBs, 'Memory', {
            integer: true,
            min: 128,
            max: 3072,
          })
        }
        if (selected === 'list_applications' || selected === 'list_functions') {
          result.limit = parseOptionalNumberInput(params.limit, 'Page size', {
            integer: true,
            min: 1,
            max: 50,
          })
        }
        if (selected === 'invoke') {
          result.payloadType = params.payloadType || 'json'
          result.invocationType = params.invocationType || 'sync'
          result.outputFormat = params.outputFormat || 'auto'
          result.dryRun = optionalBoolean(params.dryRun)
          result.timeoutMs = parseOptionalNumberInput(params.timeoutMs, 'Client timeout', {
            integer: true,
            min: 1,
            max: 300_000,
          })
          if (result.payloadType === 'file') {
            result.payload = undefined
            result.file = normalizeFileInput(params.file, { single: true })
          } else {
            result.file = undefined
            result.payload =
              result.payloadType === 'json' ? parseJson(params.payload, 'Payload') : params.payload
          }
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'OCI Functions operation' },
    oauthCredential: { type: 'string', description: 'OCI service-account credential ID' },
    ociRegion: {
      type: 'string',
      description: 'OCI region or credential for the configured region',
    },
    applicationCompartmentId: {
      type: 'string',
      description: 'Compartment used only for application discovery',
    },
    functionId: { type: 'string', description: 'functionId' },
    invocationType: { type: 'string', description: 'invocationType' },
    dryRun: { type: 'boolean', description: 'dryRun' },
    intent: { type: 'string', description: 'intent' },
    payloadType: { type: 'string', description: 'payloadType' },
    payload: { type: 'json', description: 'payload' },
    file: { type: 'json', description: 'file' },
    contentType: { type: 'string', description: 'contentType' },
    outputFormat: { type: 'string', description: 'outputFormat' },
    timeoutMs: { type: 'number', description: 'timeoutMs' },
    compartmentId: { type: 'string', description: 'compartmentId' },
    limit: { type: 'number', description: 'limit' },
    page: { type: 'string', description: 'page' },
    displayName: { type: 'string', description: 'displayName' },
    id: { type: 'string', description: 'id' },
    lifecycleState: { type: 'string', description: 'lifecycleState' },
    sortBy: { type: 'string', description: 'sortBy' },
    sortOrder: { type: 'string', description: 'sortOrder' },
    applicationId: { type: 'string', description: 'applicationId' },
    subnetIds: { type: 'array', description: 'subnetIds' },
    shape: { type: 'string', description: 'shape' },
    configuration: { type: 'json', description: 'configuration' },
    ifMatch: { type: 'string', description: 'ifMatch' },
    image: { type: 'string', description: 'image' },
    memoryInMBs: { type: 'number', description: 'memoryInMBs' },
  },
  outputs: {
    status: { type: 'number', description: 'Oracle HTTP status' },
    opcRequestId: { type: 'string', description: 'Oracle request identifier' },
    etag: { type: 'string', description: 'Resource ETag' },
    nextPage: { type: 'string', description: 'Next page token, when more results exist' },
    application: {
      type: 'json',
      description:
        'Application OCID, name, lifecycle state, config, subnets, network security groups, tags, logging, tracing, and image policy',
    },
    applications: { type: 'array', description: 'One page of application summaries' },
    function: {
      type: 'json',
      description:
        'Function OCID, name, lifecycle state, image and digest, memory, config, timeouts, concurrency, destinations, tags, and tracing',
    },
    functions: { type: 'array', description: 'One page of function summaries' },
    applicationId: { type: 'string', description: 'Affected application OCID' },
    functionId: { type: 'string', description: 'Affected function OCID' },
    compartmentId: { type: 'string', description: 'Destination compartment OCID' },
    invocationType: { type: 'string', description: 'Requested invocation mode' },
    dryRun: { type: 'boolean', description: 'Whether invocation was a dry run' },
    accepted: {
      type: 'boolean',
      description: 'HTTP 202 acknowledgement; processing is not complete',
    },
    contentType: { type: 'string', description: 'Result content type' },
    result: { type: 'json', description: 'Synchronous JSON or text result, when returned' },
    file: { type: 'file', description: 'Binary or explicitly requested result file' },
  },
}

export const OciFunctionsBlockMeta = {
  tags: ['cloud', 'automation'],
  url: 'https://www.oracle.com/cloud/cloud-native/functions/',
  templates: [
    {
      icon: OracleIcon,
      title: 'Invoke business logic',
      prompt:
        'When a webhook supplies an order, invoke an existing OCI function with the order JSON and use its synchronous result in the workflow.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['cloud'],
    },
    {
      icon: OracleIcon,
      title: 'Start detached processing',
      prompt:
        'When a scheduled batch is ready, invoke an existing OCI function in detached mode and record the acceptance status and request ID. Use its configured Oracle destination for completion results.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['cloud'],
    },
    {
      icon: OracleIcon,
      title: 'Inventory function settings',
      prompt:
        'On a scheduled review, list applications in a compartment and request function pages as needed. Summarize image versions, memory, timeouts, and configuration for the selected functions.',
      modules: ['scheduled', 'agent'],
      category: 'engineering',
      tags: ['cloud'],
    },
    {
      icon: OracleIcon,
      title: 'Update environment settings',
      prompt:
        'When an approved environment setting changes, read the application and its ETag, construct the full intended config map, and update it conditionally. Report the returned configuration.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['cloud'],
    },
    {
      icon: OracleIcon,
      title: 'Promote an existing image',
      prompt:
        'After an image is published by your existing build process, update a selected function to that image reference using its current ETag. Return the resulting image digest and lifecycle state.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['cloud'],
    },
    {
      icon: OracleIcon,
      title: 'Configure warm capacity',
      prompt:
        'Before a planned traffic window, inspect a function and update its provisioned concurrency with a supported memory-dependent count. Report the resulting configuration.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['cloud'],
    },
    {
      icon: OracleIcon,
      title: 'Enable function tracing',
      prompt:
        'During incident investigation, read application and function tracing settings, then apply the approved tracing change using an ETag. Report the updated settings for the operator.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['cloud'],
    },
  ],
  skills: [
    {
      name: 'invoke-oci-business-functions',
      description: 'Run existing OCI business logic with a bounded synchronous payload.',
      content:
        '# Invoke OCI Business Functions\n\n## Steps\n\n1. Identify the existing function OCID and OCI credential.\n2. Invoke synchronously with JSON, text, or one authorized uploaded file. Keep payloads below 6 MB.\n3. Return the result or file. If the response is lost, report uncertainty; do not automatically invoke again.\n\n## Output\n\nReturn the function OCID, Oracle request ID, and result.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Functions/Tasks/functionsdownloadingsamples_topic-Sample_functions.htm',
    },
    {
      name: 'inspect-oci-function-configuration',
      description: 'Inspect application and function settings before changing a workload.',
      content:
        '# Inspect OCI Function Configuration\n\n## Steps\n\n1. List one application page in the requested compartment.\n2. List functions for a selected application, following page tokens only as requested.\n3. Get the selected application and functions to inspect configuration, images, timeouts, and tags.\n\n## Output\n\nReport requested settings and whether another inventory page remains.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Functions/Tasks/functionscustomizing.htm',
    },
    {
      name: 'update-oci-function-images',
      description: 'Promote an already published container image into an OCI function.',
      content:
        '# Update OCI Function Images\n\n## Steps\n\n1. Get the target function and retain its ETag and existing image reference.\n2. Use Update Function with the approved existing image reference and If Match.\n3. Read the resulting metadata. Container building and registry upload must already be handled by the existing release process.\n\n## Output\n\nReport the image, digest, lifecycle state, and request ID.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Functions/Tasks/functionsupdatingfunctions.htm',
    },
    {
      name: 'start-oci-detached-jobs',
      description: 'Start long-running work without presenting acceptance as completion.',
      content:
        '# Start OCI Detached Jobs\n\n## Steps\n\n1. Get the function and inspect its detached timeout and success/failure destinations.\n2. Update the approved settings if needed, preserving omitted fields and using If Match.\n3. Invoke in detached mode once. Do not retry a lost response automatically.\n\n## Output\n\nReport acceptance and the Oracle request ID. Completion results go to configured Oracle destinations; this integration does not poll invocation results.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Functions/Tasks/functionsinvokingfunctions.htm',
    },
    {
      name: 'tune-oci-provisioned-concurrency',
      description: 'Configure provisioned capacity for predictable cold-start behavior.',
      content:
        '# Tune OCI Provisioned Concurrency\n\n## Steps\n\n1. Get the function memory, ETag, and current concurrency settings.\n2. Choose an approved CONSTANT count: a multiple of 40 at 128 MB, 20 at 256 MB, or 10 at 512 MB and above.\n3. Update Function with the provisioned concurrency configuration and If Match. Use strategy NONE to remove provisioned capacity when requested.\n\n## Output\n\nReport the returned strategy and count.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Functions/Tasks/functionsusingprovisionedconcurrency.htm',
    },
    {
      name: 'maintain-oci-environment-variables',
      description: 'Replace configuration maps without accidentally dropping existing keys.',
      content:
        '# Maintain OCI Environment Variables\n\n## Steps\n\n1. Get the application or function configuration and its ETag.\n2. Build the full desired map: supplied config replaces the existing map. Use an empty object only to intentionally clear it.\n3. Update the selected resource with config and If Match. Keep effective application plus function configuration within 4096 UTF-8 bytes.\n\n## Output\n\nReport the changed key names and update status.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Functions/Tasks/functionspassingconfigparams-about.htm',
    },
  ],
} as const satisfies BlockMeta
