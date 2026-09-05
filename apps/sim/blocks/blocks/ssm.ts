import { SSMIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { SsmSendCommandResponse } from '@/tools/ssm/types'

/** Operations whose SSM API caps `MaxResults` at 50. */
const STANDARD_PAGE_OPERATIONS = [
  'list_commands',
  'list_command_invocations',
  'describe_parameters',
  'list_compliance_items',
  'list_compliance_summaries',
  'describe_automation_executions',
  'list_documents',
]

/** Operations that accept a `filters` array of Parameter Store string filters. */
const PARAMETER_FILTER_OPERATIONS = ['get_parameters_by_path', 'describe_parameters']

const PAGINATED_OPERATIONS = [
  ...STANDARD_PAGE_OPERATIONS,
  'get_parameters_by_path',
  'describe_instance_information',
  'describe_instance_patches',
  'describe_instance_patch_states',
]

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === 'true' || value === true) return true
  if (value === 'false' || value === false) return false
  return undefined
}

function toParsedJson(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return value
  return JSON.parse(value)
}

export const SSMBlock: BlockConfig<SsmSendCommandResponse> = {
  type: 'ssm',
  name: 'AWS Systems Manager',
  description: 'Run commands, manage parameters, and audit managed nodes',
  longDescription:
    'Integrate AWS Systems Manager into your workflow. Run commands on managed nodes, read and write Parameter Store values, inspect node inventory and patch compliance, and drive Automation runbooks.',
  docsLink: 'https://docs.sim.ai/integrations/ssm',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#E7157B',
  icon: SSMIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'AWS Systems Manager',
    sentences: {
      byOperation: {
        send_command: [
          { text: 'Run document', field: 'documentName', core: true },
          { text: 'on', field: 'instanceIds' },
        ],
        list_commands: [
          'List commands',
          { text: ', for command', field: 'commandId' },
          { text: ', on node', field: 'instanceId' },
        ],
        list_command_invocations: [
          'List command invocations',
          { text: ', for command', field: 'commandId' },
          { text: ', on node', field: 'instanceId' },
        ],
        get_command_invocation: [
          { text: 'Read output of command', field: 'commandId', core: true },
          { text: 'on node', field: 'instanceId', core: true },
        ],
        cancel_command: [{ text: 'Cancel command', field: 'commandId', core: true }],
        get_parameter: [{ text: 'Read parameter', field: 'parameterName', core: true }],
        get_parameters: [{ text: 'Read parameters', field: 'parameterNames', core: true }],
        get_parameters_by_path: [
          { text: 'Read parameters under', field: 'parameterPath', core: true },
        ],
        put_parameter: [
          { text: 'Write parameter', field: 'parameterName', core: true },
          { text: ', as type', field: 'parameterType' },
        ],
        delete_parameter: [{ text: 'Delete parameter', field: 'parameterName', core: true }],
        describe_parameters: ['List parameter metadata', { text: ', up to', field: 'maxResults' }],
        describe_instance_information: [
          'List managed nodes',
          { text: ', up to', field: 'instanceInfoMaxResults' },
        ],
        describe_instance_patches: [
          { text: 'List patches on node', field: 'instanceId', core: true },
        ],
        describe_instance_patch_states: [
          { text: 'Summarize patch state of', field: 'instanceIds', core: true },
        ],
        list_compliance_items: ['List compliance items', { text: ', for', field: 'resourceIds' }],
        list_compliance_summaries: [
          'Summarize compliance',
          { text: ', up to', field: 'maxResults' },
        ],
        start_automation_execution: [
          { text: 'Start runbook', field: 'documentName', core: true },
          { text: ', over', field: 'targets' },
        ],
        describe_automation_executions: [
          'List automation executions',
          { text: ', up to', field: 'maxResults' },
        ],
        get_automation_execution: [
          { text: 'Read automation execution', field: 'automationExecutionId', core: true },
        ],
        stop_automation_execution: [
          { text: 'Stop automation execution', field: 'automationExecutionId', core: true },
          { text: ', with', field: 'stopType' },
        ],
        list_documents: ['List documents', { text: ', up to', field: 'maxResults' }],
        get_document: [
          { text: 'Read document', field: 'documentName', core: true },
          { text: ', as', field: 'documentFormat' },
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
        { label: 'Send Command', id: 'send_command' },
        { label: 'List Commands', id: 'list_commands' },
        { label: 'List Command Invocations', id: 'list_command_invocations' },
        { label: 'Get Command Invocation', id: 'get_command_invocation' },
        { label: 'Cancel Command', id: 'cancel_command' },
        { label: 'Get Parameter', id: 'get_parameter' },
        { label: 'Get Parameters', id: 'get_parameters' },
        { label: 'Get Parameters By Path', id: 'get_parameters_by_path' },
        { label: 'Put Parameter', id: 'put_parameter' },
        { label: 'Delete Parameter', id: 'delete_parameter' },
        { label: 'Describe Parameters', id: 'describe_parameters' },
        { label: 'Describe Instance Information', id: 'describe_instance_information' },
        { label: 'Describe Instance Patches', id: 'describe_instance_patches' },
        { label: 'Describe Instance Patch States', id: 'describe_instance_patch_states' },
        { label: 'List Compliance Items', id: 'list_compliance_items' },
        { label: 'List Compliance Summaries', id: 'list_compliance_summaries' },
        { label: 'Start Automation Execution', id: 'start_automation_execution' },
        { label: 'Describe Automation Executions', id: 'describe_automation_executions' },
        { label: 'Get Automation Execution', id: 'get_automation_execution' },
        { label: 'Stop Automation Execution', id: 'stop_automation_execution' },
        { label: 'List Documents', id: 'list_documents' },
        { label: 'Get Document', id: 'get_document' },
      ],
      value: () => 'send_command',
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
      id: 'documentName',
      title: 'Document Name',
      type: 'short-input',
      placeholder: 'AWS-RunShellScript',
      condition: {
        field: 'operation',
        value: ['send_command', 'start_automation_execution', 'get_document'],
      },
      required: {
        field: 'operation',
        value: ['send_command', 'start_automation_execution', 'get_document'],
      },
    },
    {
      id: 'instanceIds',
      title: 'Instance IDs',
      type: 'code',
      placeholder: '["i-0123456789abcdef0"]',
      condition: {
        field: 'operation',
        value: ['send_command', 'cancel_command', 'describe_instance_patch_states'],
      },
      required: { field: 'operation', value: 'describe_instance_patch_states' },
    },
    {
      id: 'targets',
      title: 'Targets',
      type: 'code',
      placeholder: '[{"Key":"tag:Environment","Values":["prod"]}]',
      condition: { field: 'operation', value: ['send_command', 'start_automation_execution'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'parameters',
      title: 'Document Parameters',
      type: 'code',
      placeholder: '{"commands":["df -h"]}',
      condition: { field: 'operation', value: ['send_command', 'start_automation_execution'] },
      required: false,
      wandConfig: {
        enabled: true,
        prompt:
          'Generate SSM document parameters as a JSON object mapping each parameter name to an array of string values. Return ONLY the JSON.',
        generationType: 'json-object',
      },
    },
    {
      id: 'documentVersion',
      title: 'Document Version',
      type: 'short-input',
      placeholder: '$LATEST, $DEFAULT, or a version number',
      condition: {
        field: 'operation',
        value: ['send_command', 'start_automation_execution', 'get_document'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'short-input',
      placeholder: 'Restart the web tier',
      condition: { field: 'operation', value: 'send_command' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'executionTimeoutSeconds',
      title: 'Acknowledgement Timeout (Seconds)',
      type: 'short-input',
      placeholder: '3600 (30-2592000)',
      condition: { field: 'operation', value: 'send_command' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'maxConcurrency',
      title: 'Max Concurrency',
      type: 'short-input',
      placeholder: '50% or 10',
      condition: { field: 'operation', value: ['send_command', 'start_automation_execution'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'maxErrors',
      title: 'Max Errors',
      type: 'short-input',
      placeholder: '0 or 10%',
      condition: { field: 'operation', value: ['send_command', 'start_automation_execution'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'outputS3BucketName',
      title: 'Output S3 Bucket',
      type: 'short-input',
      placeholder: 'my-ssm-output-bucket',
      condition: { field: 'operation', value: 'send_command' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'outputS3KeyPrefix',
      title: 'Output S3 Key Prefix',
      type: 'short-input',
      placeholder: 'run-command/',
      condition: { field: 'operation', value: 'send_command' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'serviceRoleArn',
      title: 'Notification Service Role ARN',
      type: 'short-input',
      placeholder: 'arn:aws:iam::123456789012:role/ssm-notifications',
      condition: { field: 'operation', value: 'send_command' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'commandId',
      title: 'Command ID',
      type: 'short-input',
      placeholder: '11111111-2222-3333-4444-555555555555',
      condition: {
        field: 'operation',
        value: [
          'list_commands',
          'list_command_invocations',
          'get_command_invocation',
          'cancel_command',
        ],
      },
      required: { field: 'operation', value: ['get_command_invocation', 'cancel_command'] },
    },
    {
      id: 'instanceId',
      title: 'Instance ID',
      type: 'short-input',
      placeholder: 'i-0123456789abcdef0',
      condition: {
        field: 'operation',
        value: [
          'list_commands',
          'list_command_invocations',
          'get_command_invocation',
          'describe_instance_patches',
        ],
      },
      required: {
        field: 'operation',
        value: ['get_command_invocation', 'describe_instance_patches'],
      },
    },
    {
      id: 'commandFilters',
      title: 'Command Filters',
      type: 'code',
      placeholder: '[{"key":"Status","value":"Failed"}]',
      condition: { field: 'operation', value: ['list_commands', 'list_command_invocations'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'details',
      title: 'Include Plugin Detail',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'list_command_invocations' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'pluginName',
      title: 'Plugin Name',
      type: 'short-input',
      placeholder: 'aws:runShellScript',
      condition: { field: 'operation', value: 'get_command_invocation' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'parameterName',
      title: 'Parameter Name',
      type: 'short-input',
      placeholder: '/prod/app/database-url',
      condition: {
        field: 'operation',
        value: ['get_parameter', 'put_parameter', 'delete_parameter'],
      },
      required: {
        field: 'operation',
        value: ['get_parameter', 'put_parameter', 'delete_parameter'],
      },
    },
    {
      id: 'parameterNames',
      title: 'Parameter Names',
      type: 'code',
      placeholder: '["/prod/app/database-url","/prod/app/api-host"]',
      condition: { field: 'operation', value: 'get_parameters' },
      required: { field: 'operation', value: 'get_parameters' },
    },
    {
      id: 'parameterPath',
      title: 'Parameter Path',
      type: 'short-input',
      placeholder: '/prod/app',
      condition: { field: 'operation', value: 'get_parameters_by_path' },
      required: { field: 'operation', value: 'get_parameters_by_path' },
    },
    {
      id: 'recursive',
      title: 'Recursive',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'get_parameters_by_path' },
      required: false,
    },
    {
      id: 'withDecryption',
      title: 'Decrypt SecureString Values',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: {
        field: 'operation',
        value: ['get_parameter', 'get_parameters', 'get_parameters_by_path'],
      },
      required: false,
    },
    {
      id: 'parameterValue',
      title: 'Parameter Value',
      type: 'long-input',
      password: true,
      placeholder: 'The value to store',
      condition: { field: 'operation', value: 'put_parameter' },
      required: { field: 'operation', value: 'put_parameter' },
    },
    {
      id: 'parameterType',
      title: 'Parameter Type',
      type: 'dropdown',
      options: [
        { label: 'String', id: 'String' },
        { label: 'StringList', id: 'StringList' },
        { label: 'SecureString', id: 'SecureString' },
      ],
      value: () => 'String',
      condition: { field: 'operation', value: 'put_parameter' },
      required: false,
    },
    {
      id: 'overwrite',
      title: 'Overwrite Existing',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'put_parameter' },
      required: false,
    },
    {
      id: 'parameterDescription',
      title: 'Parameter Description',
      type: 'short-input',
      placeholder: 'Production database connection string',
      condition: { field: 'operation', value: 'put_parameter' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'kmsKeyId',
      title: 'KMS Key ID',
      type: 'short-input',
      placeholder: 'alias/aws/ssm or a key ARN',
      condition: { field: 'operation', value: 'put_parameter' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'allowedPattern',
      title: 'Allowed Pattern',
      type: 'short-input',
      placeholder: '^\\d+$',
      condition: { field: 'operation', value: 'put_parameter' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'parameterTier',
      title: 'Parameter Tier',
      type: 'dropdown',
      options: [
        { label: 'Standard', id: 'Standard' },
        { label: 'Advanced', id: 'Advanced' },
        { label: 'Intelligent-Tiering', id: 'Intelligent-Tiering' },
      ],
      condition: { field: 'operation', value: 'put_parameter' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'parameterDataType',
      title: 'Parameter Data Type',
      type: 'short-input',
      placeholder: 'text, aws:ec2:image, or aws:ssm:integration',
      condition: { field: 'operation', value: 'put_parameter' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'parameterPolicies',
      title: 'Parameter Policies',
      type: 'code',
      placeholder: '[{"Type":"Expiration","Version":"1.0","Attributes":{"Timestamp":"..."}}]',
      condition: { field: 'operation', value: 'put_parameter' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'parameterFilters',
      title: 'Parameter Filters',
      type: 'code',
      placeholder: '[{"Key":"Type","Option":"Equals","Values":["SecureString"]}]',
      condition: { field: 'operation', value: PARAMETER_FILTER_OPERATIONS },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'shared',
      title: 'Shared Parameters',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'describe_parameters' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'instanceInfoFilters',
      title: 'Node Filters',
      type: 'code',
      placeholder: '[{"Key":"PingStatus","Values":["Online"]}]',
      condition: { field: 'operation', value: 'describe_instance_information' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'patchFilters',
      title: 'Patch Filters',
      type: 'code',
      placeholder: '[{"Key":"State","Values":["Missing"]}]',
      condition: { field: 'operation', value: 'describe_instance_patches' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'resourceIds',
      title: 'Resource IDs',
      type: 'code',
      placeholder: '["i-0123456789abcdef0"]',
      condition: { field: 'operation', value: 'list_compliance_items' },
      required: false,
    },
    {
      id: 'resourceTypes',
      title: 'Resource Types',
      type: 'code',
      placeholder: '["ManagedInstance"]',
      condition: { field: 'operation', value: 'list_compliance_items' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'complianceFilters',
      title: 'Compliance Filters',
      type: 'code',
      placeholder: '[{"Key":"Status","Values":["NON_COMPLIANT"],"Type":"EQUAL"}]',
      condition: {
        field: 'operation',
        value: ['list_compliance_items', 'list_compliance_summaries'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'mode',
      title: 'Execution Mode',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: 'Auto' },
        { label: 'Interactive', id: 'Interactive' },
      ],
      value: () => 'Auto',
      condition: { field: 'operation', value: 'start_automation_execution' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'targetParameterName',
      title: 'Target Parameter Name',
      type: 'short-input',
      placeholder: 'InstanceId',
      condition: { field: 'operation', value: 'start_automation_execution' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'clientToken',
      title: 'Client Token',
      type: 'short-input',
      placeholder: 'Idempotency token, exactly 36 characters',
      condition: { field: 'operation', value: 'start_automation_execution' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'automationFilters',
      title: 'Automation Filters',
      type: 'code',
      placeholder: '[{"Key":"ExecutionStatus","Values":["Failed"]}]',
      condition: { field: 'operation', value: 'describe_automation_executions' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'automationExecutionId',
      title: 'Automation Execution ID',
      type: 'short-input',
      placeholder: '11111111-2222-3333-4444-555555555555',
      condition: {
        field: 'operation',
        value: ['get_automation_execution', 'stop_automation_execution'],
      },
      required: {
        field: 'operation',
        value: ['get_automation_execution', 'stop_automation_execution'],
      },
    },
    {
      id: 'stopType',
      title: 'Stop Type',
      type: 'dropdown',
      options: [
        { label: 'Cancel', id: 'Cancel' },
        { label: 'Complete', id: 'Complete' },
      ],
      value: () => 'Cancel',
      condition: { field: 'operation', value: 'stop_automation_execution' },
      required: false,
    },
    {
      id: 'documentFilters',
      title: 'Document Filters',
      type: 'code',
      placeholder: '[{"Key":"DocumentType","Values":["Automation"]}]',
      condition: { field: 'operation', value: 'list_documents' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'versionName',
      title: 'Version Name',
      type: 'short-input',
      placeholder: 'Release-2024-06',
      condition: { field: 'operation', value: 'get_document' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'documentFormat',
      title: 'Document Format',
      type: 'dropdown',
      options: [
        { label: 'JSON', id: 'JSON' },
        { label: 'YAML', id: 'YAML' },
        { label: 'Text', id: 'TEXT' },
      ],
      condition: { field: 'operation', value: 'get_document' },
      required: false,
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '50 (1-50)',
      condition: { field: 'operation', value: STANDARD_PAGE_OPERATIONS },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'pathMaxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '10 (1-10)',
      condition: { field: 'operation', value: 'get_parameters_by_path' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'instanceInfoMaxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '50 (5-50)',
      condition: { field: 'operation', value: 'describe_instance_information' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'patchMaxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '100 (10-100)',
      condition: {
        field: 'operation',
        value: ['describe_instance_patches', 'describe_instance_patch_states'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'nextToken',
      title: 'Next Token',
      type: 'short-input',
      placeholder: 'Pagination token',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
      required: false,
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'ssm_send_command',
      'ssm_list_commands',
      'ssm_list_command_invocations',
      'ssm_get_command_invocation',
      'ssm_cancel_command',
      'ssm_get_parameter',
      'ssm_get_parameters',
      'ssm_get_parameters_by_path',
      'ssm_put_parameter',
      'ssm_delete_parameter',
      'ssm_describe_parameters',
      'ssm_describe_instance_information',
      'ssm_describe_instance_patches',
      'ssm_describe_instance_patch_states',
      'ssm_list_compliance_items',
      'ssm_list_compliance_summaries',
      'ssm_start_automation_execution',
      'ssm_describe_automation_executions',
      'ssm_get_automation_execution',
      'ssm_stop_automation_execution',
      'ssm_list_documents',
      'ssm_get_document',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send_command':
          case 'list_commands':
          case 'list_command_invocations':
          case 'get_command_invocation':
          case 'cancel_command':
          case 'get_parameter':
          case 'get_parameters':
          case 'get_parameters_by_path':
          case 'put_parameter':
          case 'delete_parameter':
          case 'describe_parameters':
          case 'describe_instance_information':
          case 'describe_instance_patches':
          case 'describe_instance_patch_states':
          case 'list_compliance_items':
          case 'list_compliance_summaries':
          case 'start_automation_execution':
          case 'describe_automation_executions':
          case 'get_automation_execution':
          case 'stop_automation_execution':
          case 'list_documents':
          case 'get_document':
            return `ssm_${params.operation}`
          default:
            throw new Error(`Invalid Systems Manager operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = {
          region: params.region,
          accessKeyId: params.accessKeyId,
          secretAccessKey: params.secretAccessKey,
        }

        const setJson = (key: string, value: unknown) => {
          const parsed = toParsedJson(value)
          if (parsed !== undefined) result[key] = parsed
        }
        const setNumber = (key: string, value: unknown) => {
          const parsed = toOptionalNumber(value)
          if (parsed !== undefined) result[key] = parsed
        }
        const setBoolean = (key: string, value: unknown) => {
          const parsed = toOptionalBoolean(value)
          if (parsed !== undefined) result[key] = parsed
        }
        const setString = (key: string, value: unknown) => {
          if (value === undefined || value === null || value === '') return
          result[key] = String(value)
        }

        switch (params.operation) {
          case 'send_command':
            result.documentName = params.documentName
            setJson('instanceIds', params.instanceIds)
            setJson('targets', params.targets)
            setJson('parameters', params.parameters)
            setString('documentVersion', params.documentVersion)
            setString('comment', params.comment)
            setNumber('executionTimeoutSeconds', params.executionTimeoutSeconds)
            setString('maxConcurrency', params.maxConcurrency)
            setString('maxErrors', params.maxErrors)
            setString('outputS3BucketName', params.outputS3BucketName)
            setString('outputS3KeyPrefix', params.outputS3KeyPrefix)
            setString('serviceRoleArn', params.serviceRoleArn)
            break
          case 'list_commands':
            setString('commandId', params.commandId)
            setString('instanceId', params.instanceId)
            setJson('filters', params.commandFilters)
            setNumber('maxResults', params.maxResults)
            setString('nextToken', params.nextToken)
            break
          case 'list_command_invocations':
            setString('commandId', params.commandId)
            setString('instanceId', params.instanceId)
            setJson('filters', params.commandFilters)
            setBoolean('details', params.details)
            setNumber('maxResults', params.maxResults)
            setString('nextToken', params.nextToken)
            break
          case 'get_command_invocation':
            result.commandId = params.commandId
            result.instanceId = params.instanceId
            setString('pluginName', params.pluginName)
            break
          case 'cancel_command':
            result.commandId = params.commandId
            setJson('instanceIds', params.instanceIds)
            break
          case 'get_parameter':
            result.name = params.parameterName
            setBoolean('withDecryption', params.withDecryption)
            break
          case 'get_parameters':
            setJson('names', params.parameterNames)
            setBoolean('withDecryption', params.withDecryption)
            break
          case 'get_parameters_by_path':
            result.path = params.parameterPath
            setBoolean('recursive', params.recursive)
            setBoolean('withDecryption', params.withDecryption)
            setJson('parameterFilters', params.parameterFilters)
            setNumber('maxResults', params.pathMaxResults)
            setString('nextToken', params.nextToken)
            break
          case 'put_parameter':
            result.name = params.parameterName
            result.value = params.parameterValue
            setString('type', params.parameterType)
            setString('description', params.parameterDescription)
            setString('keyId', params.kmsKeyId)
            setBoolean('overwrite', params.overwrite)
            setString('allowedPattern', params.allowedPattern)
            setString('tier', params.parameterTier)
            setString('dataType', params.parameterDataType)
            setString('policies', params.parameterPolicies)
            break
          case 'delete_parameter':
            result.name = params.parameterName
            break
          case 'describe_parameters':
            setJson('parameterFilters', params.parameterFilters)
            setBoolean('shared', params.shared)
            setNumber('maxResults', params.maxResults)
            setString('nextToken', params.nextToken)
            break
          case 'describe_instance_information':
            setJson('filters', params.instanceInfoFilters)
            setNumber('maxResults', params.instanceInfoMaxResults)
            setString('nextToken', params.nextToken)
            break
          case 'describe_instance_patches':
            result.instanceId = params.instanceId
            setJson('filters', params.patchFilters)
            setNumber('maxResults', params.patchMaxResults)
            setString('nextToken', params.nextToken)
            break
          case 'describe_instance_patch_states':
            setJson('instanceIds', params.instanceIds)
            setNumber('maxResults', params.patchMaxResults)
            setString('nextToken', params.nextToken)
            break
          case 'list_compliance_items':
            setJson('resourceIds', params.resourceIds)
            setJson('resourceTypes', params.resourceTypes)
            setJson('filters', params.complianceFilters)
            setNumber('maxResults', params.maxResults)
            setString('nextToken', params.nextToken)
            break
          case 'list_compliance_summaries':
            setJson('filters', params.complianceFilters)
            setNumber('maxResults', params.maxResults)
            setString('nextToken', params.nextToken)
            break
          case 'start_automation_execution':
            result.documentName = params.documentName
            setString('documentVersion', params.documentVersion)
            setJson('parameters', params.parameters)
            setString('mode', params.mode)
            setString('targetParameterName', params.targetParameterName)
            setJson('targets', params.targets)
            setString('maxConcurrency', params.maxConcurrency)
            setString('maxErrors', params.maxErrors)
            setString('clientToken', params.clientToken)
            break
          case 'describe_automation_executions':
            setJson('filters', params.automationFilters)
            setNumber('maxResults', params.maxResults)
            setString('nextToken', params.nextToken)
            break
          case 'get_automation_execution':
            result.automationExecutionId = params.automationExecutionId
            break
          case 'stop_automation_execution':
            result.automationExecutionId = params.automationExecutionId
            setString('stopType', params.stopType)
            break
          case 'list_documents':
            setJson('filters', params.documentFilters)
            setNumber('maxResults', params.maxResults)
            setString('nextToken', params.nextToken)
            break
          case 'get_document':
            result.name = params.documentName
            setString('documentVersion', params.documentVersion)
            setString('versionName', params.versionName)
            setString('documentFormat', params.documentFormat)
            break
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Systems Manager operation to perform' },
    region: { type: 'string', description: 'AWS region' },
    accessKeyId: { type: 'string', description: 'AWS access key ID' },
    secretAccessKey: { type: 'string', description: 'AWS secret access key' },
    documentName: { type: 'string', description: 'SSM document or runbook name' },
    documentVersion: { type: 'string', description: 'Document version to use' },
    instanceIds: { type: 'json', description: 'Managed node IDs, as an array of strings' },
    targets: { type: 'json', description: 'Targets, as an array of {Key, Values} objects' },
    parameters: {
      type: 'json',
      description: 'Document parameters, as an object of name to string array',
    },
    comment: { type: 'string', description: 'Comment describing the command' },
    executionTimeoutSeconds: {
      type: 'number',
      description: 'Seconds a node has to acknowledge the command',
    },
    maxConcurrency: { type: 'string', description: 'Concurrency, as a number or percentage' },
    maxErrors: { type: 'string', description: 'Error threshold, as a number or percentage' },
    outputS3BucketName: { type: 'string', description: 'S3 bucket for command output' },
    outputS3KeyPrefix: { type: 'string', description: 'S3 key prefix for command output' },
    serviceRoleArn: { type: 'string', description: 'IAM service role ARN for notifications' },
    commandId: { type: 'string', description: 'Run Command execution ID' },
    instanceId: { type: 'string', description: 'Managed node ID' },
    commandFilters: {
      type: 'json',
      description: 'Run Command filters, as an array of {key, value} objects',
    },
    details: { type: 'string', description: 'Whether to include per-plugin invocation detail' },
    pluginName: { type: 'string', description: 'Document plugin to read output for' },
    parameterName: { type: 'string', description: 'Parameter Store parameter name' },
    parameterNames: { type: 'json', description: 'Parameter names, as an array of strings' },
    parameterPath: { type: 'string', description: 'Parameter Store hierarchy path' },
    recursive: { type: 'string', description: 'Whether to include nested paths' },
    withDecryption: { type: 'string', description: 'Whether to decrypt SecureString values' },
    parameterValue: { type: 'string', description: 'Value to store in the parameter' },
    parameterType: { type: 'string', description: 'String, StringList, or SecureString' },
    overwrite: { type: 'string', description: 'Whether to overwrite an existing parameter' },
    parameterDescription: { type: 'string', description: 'Description of the parameter' },
    kmsKeyId: { type: 'string', description: 'KMS key used to encrypt a SecureString parameter' },
    allowedPattern: { type: 'string', description: 'Regular expression the value must match' },
    parameterTier: { type: 'string', description: 'Standard, Advanced, or Intelligent-Tiering' },
    parameterDataType: { type: 'string', description: 'Data type of the parameter' },
    parameterPolicies: { type: 'string', description: 'Parameter policies as a JSON array string' },
    parameterFilters: {
      type: 'json',
      description: 'Parameter filters, as an array of {Key, Option, Values} objects',
    },
    shared: { type: 'string', description: 'Whether to list parameters shared with this account' },
    instanceInfoFilters: {
      type: 'json',
      description: 'Managed node filters, as an array of {Key, Values} objects',
    },
    patchFilters: {
      type: 'json',
      description: 'Patch filters, as an array of {Key, Values} objects',
    },
    resourceIds: { type: 'json', description: 'Compliance resource IDs, as an array of strings' },
    resourceTypes: {
      type: 'json',
      description: 'Compliance resource types, as an array of strings',
    },
    complianceFilters: {
      type: 'json',
      description: 'Compliance filters, as an array of {Key, Values, Type} objects',
    },
    mode: { type: 'string', description: 'Automation execution mode' },
    targetParameterName: {
      type: 'string',
      description: 'Runbook parameter that receives each resolved target',
    },
    clientToken: { type: 'string', description: 'Idempotency token for the automation execution' },
    automationFilters: {
      type: 'json',
      description: 'Automation filters, as an array of {Key, Values} objects',
    },
    automationExecutionId: { type: 'string', description: 'Automation execution ID' },
    stopType: { type: 'string', description: 'How to stop the automation execution' },
    documentFilters: {
      type: 'json',
      description: 'Document filters, as an array of {Key, Values} objects',
    },
    versionName: { type: 'string', description: 'User-defined document version name' },
    documentFormat: { type: 'string', description: 'Format to return document content in' },
    maxResults: { type: 'number', description: 'Maximum number of results to return' },
    pathMaxResults: {
      type: 'number',
      description: 'Maximum number of parameters to return for a path read',
    },
    instanceInfoMaxResults: {
      type: 'number',
      description: 'Maximum number of managed nodes to return',
    },
    patchMaxResults: {
      type: 'number',
      description: 'Maximum number of patch records to return',
    },
    nextToken: { type: 'string', description: 'Pagination token' },
  },
  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    commandId: { type: 'string', description: 'Run Command execution ID' },
    commands: {
      type: 'json',
      description:
        'Commands, each with commandId, documentName, status, statusDetails, requestedDateTime, instanceIds, targets, targetCount, completedCount, and errorCount',
    },
    commandInvocations: {
      type: 'json',
      description:
        'Per-node invocations, each with commandId, instanceId, instanceName, status, statusDetails, requestedDateTime, standardOutputUrl, standardErrorUrl, and commandPlugins',
    },
    documentName: { type: 'string', description: 'Name of the document that was used' },
    documentVersion: { type: 'string', description: 'Document version that was used' },
    comment: { type: 'string', description: 'Comment supplied with the command' },
    status: { type: 'string', description: 'Status of the command, invocation, or document' },
    statusDetails: { type: 'string', description: 'Detailed status text' },
    statusInformation: { type: 'string', description: 'Detail about a document status' },
    requestedDateTime: { type: 'string', description: 'When the command was requested' },
    expiresAfter: { type: 'string', description: 'When the command stops being dispatched' },
    instanceIds: { type: 'array', description: 'Managed node IDs the command targets' },
    instanceId: { type: 'string', description: 'Managed node the invocation ran on' },
    targets: {
      type: 'json',
      description: 'Targets the command was sent to, as an array of {key, values}',
    },
    maxConcurrency: { type: 'string', description: 'Concurrency the execution ran with' },
    maxErrors: { type: 'string', description: 'Error threshold the execution ran with' },
    targetCount: { type: 'number', description: 'Number of targets the command was sent to' },
    completedCount: { type: 'number', description: 'Number of targets that have completed' },
    errorCount: { type: 'number', description: 'Number of targets whose execution failed' },
    deliveryTimedOutCount: {
      type: 'number',
      description: 'Number of targets the command could not reach in time',
    },
    executionTimeoutSeconds: {
      type: 'number',
      description: 'Acknowledgement timeout the command ran with',
    },
    outputS3BucketName: { type: 'string', description: 'S3 bucket command output is written to' },
    outputS3KeyPrefix: { type: 'string', description: 'S3 key prefix for command output' },
    outputS3Region: { type: 'string', description: 'S3 region reported for command output' },
    serviceRole: { type: 'string', description: 'IAM service role used for notifications' },
    pluginName: { type: 'string', description: 'Document plugin the output belongs to' },
    responseCode: { type: 'number', description: 'Exit code of the command on the node' },
    executionStartDateTime: { type: 'string', description: 'When the command started on the node' },
    executionElapsedTime: { type: 'string', description: 'How long the command ran' },
    executionEndDateTime: { type: 'string', description: 'When the command finished on the node' },
    standardOutputContent: { type: 'string', description: 'First 24000 characters of stdout' },
    standardOutputUrl: { type: 'string', description: 'S3 URL of the full stdout' },
    standardErrorContent: { type: 'string', description: 'First 8000 characters of stderr' },
    standardErrorUrl: { type: 'string', description: 'S3 URL of the full stderr' },
    name: { type: 'string', description: 'Name of the parameter or document' },
    type: { type: 'string', description: 'Parameter type' },
    value: { type: 'string', description: 'Parameter value' },
    version: { type: 'number', description: 'Parameter version' },
    selector: { type: 'string', description: 'Version or label selector used to read a parameter' },
    sourceResult: { type: 'string', description: 'Raw result from the parameter source' },
    lastModifiedDate: { type: 'string', description: 'When the parameter was last changed' },
    arn: { type: 'string', description: 'ARN of the parameter' },
    dataType: { type: 'string', description: 'Data type of the parameter' },
    tier: { type: 'string', description: 'Tier the parameter is stored in' },
    parameters: {
      type: 'json',
      description:
        'Parameters read, or the parameter values an automation execution was started with',
    },
    invalidParameters: {
      type: 'array',
      description: 'Parameter names that could not be read',
    },
    instances: {
      type: 'json',
      description:
        'Managed nodes, each with instanceId, pingStatus, lastPingDateTime, agentVersion, platformType, platformName, platformVersion, computerName, ipAddress, iamRole, and associationStatus',
    },
    patches: {
      type: 'json',
      description:
        'Patches, each with title, kbId, classification, severity, state, installedTime, and cveIds',
    },
    instancePatchStates: {
      type: 'json',
      description:
        'Patch states, each with instanceId, patchGroup, baselineId, operation, installedCount, missingCount, failedCount, criticalNonCompliantCount, and securityNonCompliantCount',
    },
    complianceItems: {
      type: 'json',
      description:
        'Compliance items, each with complianceType, resourceType, resourceId, id, title, status, severity, executionTime, and details',
    },
    complianceSummaryItems: {
      type: 'json',
      description:
        'Compliance summaries, each with complianceType, compliantCount, compliantSeveritySummary, nonCompliantCount, and nonCompliantSeveritySummary',
    },
    automationExecutionId: { type: 'string', description: 'Automation execution ID' },
    automationExecutions: {
      type: 'json',
      description:
        'Automation executions, each with automationExecutionId, documentName, automationExecutionStatus, executionStartTime, executionEndTime, executedBy, currentStepName, and failureMessage',
    },
    automationExecutionStatus: {
      type: 'string',
      description: 'Status of the automation execution',
    },
    executionStartTime: { type: 'string', description: 'When the automation execution started' },
    executionEndTime: { type: 'string', description: 'When the automation execution finished' },
    executedBy: { type: 'string', description: 'IAM identity that started the execution' },
    mode: { type: 'string', description: 'Automation execution mode' },
    parentAutomationExecutionId: { type: 'string', description: 'Parent execution ID' },
    currentStepName: { type: 'string', description: 'Step the execution is currently running' },
    currentAction: { type: 'string', description: 'Action the execution is currently running' },
    failureMessage: { type: 'string', description: 'Reason the execution failed' },
    targetParameterName: {
      type: 'string',
      description: 'Runbook parameter that received each resolved target',
    },
    target: { type: 'string', description: 'Resource the execution targeted' },
    outputs: { type: 'json', description: 'Outputs the automation execution produced' },
    stepExecutions: {
      type: 'json',
      description:
        'Automation steps, each with stepName, action, stepStatus, executionStartTime, executionEndTime, failureMessage, and nextStep',
    },
    stepExecutionsTruncated: {
      type: 'boolean',
      description: 'Whether the returned step list was truncated',
    },
    documents: {
      type: 'json',
      description:
        'Documents, each with name, displayName, owner, documentType, documentFormat, documentVersion, platformTypes, targetType, createdDate, and tags',
    },
    displayName: { type: 'string', description: 'Friendly name of the document' },
    createdDate: { type: 'string', description: 'When the document was created' },
    versionName: { type: 'string', description: 'User-defined document version name' },
    content: { type: 'string', description: 'Content of the document' },
    documentType: { type: 'string', description: 'Type of the document' },
    documentFormat: { type: 'string', description: 'Format the document content is returned in' },
    reviewStatus: { type: 'string', description: 'Review status of the document' },
    nextToken: { type: 'string', description: 'Pagination token for the next page of results' },
    count: { type: 'number', description: 'Number of records returned' },
  },
}

export const SSMBlockMeta = {
  tags: ['cloud', 'automation'],
  url: 'https://aws.amazon.com/systems-manager',
  templates: [
    {
      icon: SSMIcon,
      title: 'Systems Manager patch reporter',
      prompt:
        'Build a scheduled workflow that reads AWS Systems Manager patch compliance for every managed node, flags nodes with missing critical or security patches, and posts a ranked remediation list to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SSMIcon,
      title: 'Systems Manager agent health watch',
      prompt:
        'Create a scheduled workflow that lists AWS Systems Manager managed nodes, identifies nodes whose agent has lost connection or is running an outdated version, and opens a Jira ticket for each one.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['jira'],
    },
    {
      icon: SSMIcon,
      title: 'Systems Manager runbook responder',
      prompt:
        'Build a workflow that receives an incident alert, starts the matching AWS Systems Manager Automation runbook, polls the execution until it finishes, and reports the step results back to the incident channel.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'incident-management'],
      alsoIntegrations: ['slack'],
      featured: true,
    },
    {
      icon: SSMIcon,
      title: 'Systems Manager config promoter',
      prompt:
        'Create a workflow that reads application configuration from one AWS Systems Manager Parameter Store path, requests approval in Slack, writes the approved values to the production path, and records the change in a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SSMIcon,
      title: 'Systems Manager fleet command runner',
      prompt:
        'Build a workflow that runs a diagnostic shell script on every AWS Systems Manager managed node carrying a chosen tag, collects the per-node output, and summarizes the failures for the on-call engineer.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation'],
    },
    {
      icon: SSMIcon,
      title: 'Systems Manager compliance digest',
      prompt:
        'Create a scheduled workflow that pulls AWS Systems Manager compliance summaries, compares them with last week’s counts stored in a table, and emails leadership a short trend report.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'reporting'],
    },
    {
      icon: SSMIcon,
      title: 'Systems Manager parameter auditor',
      prompt:
        'Build a scheduled workflow that lists AWS Systems Manager Parameter Store metadata, flags SecureString parameters that have not changed within the rotation window and plaintext parameters that look like credentials, and files the findings for security review.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
    },
    {
      icon: SSMIcon,
      title: 'Systems Manager runbook catalog',
      prompt:
        'Create a workflow that lists AWS Systems Manager Automation runbooks, reads the content of each one, and writes a plain-English catalog of what every runbook does and which parameters it needs.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'run-fleet-command',
      description:
        'Run an SSM document such as AWS-RunShellScript across managed nodes and collect the per-node result. Use for fleet-wide diagnostics, log collection, or a scripted remediation.',
      content:
        '# Run Fleet Command\n\nExecute a command on managed nodes and report what happened on each one.\n\n## Steps\n1. Choose the SSM document to run (for example AWS-RunShellScript or AWS-RunPowerShellScript) and the parameters it needs.\n2. Pick the targets: explicit instance IDs, or tag targets such as tag:Environment = prod. Set concurrency and an error threshold so a bad script cannot roll through the whole fleet.\n3. Send the command and keep the returned command ID.\n4. List the invocations for that command ID to see per-node status, then read the invocation on each node of interest for its stdout and stderr.\n5. Summarize successes, failures, and any node that never acknowledged the command.\n\n## Output\nThe command ID, a per-node status table, and the captured output for every failed node.',
    },
    {
      name: 'triage-command-failure',
      description:
        'Investigate why a Run Command execution failed on specific managed nodes. Use when a deployment or maintenance command reports errors.',
      content:
        '# Triage Command Failure\n\nFind out which nodes failed a command and why.\n\n## Steps\n1. List recent commands, filtering by status to find the failed execution.\n2. List that command’s invocations to identify the nodes that failed or timed out.\n3. Read the invocation on each failing node, including per-plugin detail, to get the exit code and captured stderr.\n4. Separate genuine script errors from delivery problems, where the node never acknowledged the command.\n5. If the command is still running and clearly wrong, cancel it.\n\n## Output\nThe failing nodes, their exit codes, the error text from each, and whether the cause was the script or node connectivity.',
    },
    {
      name: 'read-app-configuration',
      description:
        'Read application configuration from a Parameter Store hierarchy path so a workflow can act on live settings. Use to load environment configuration without hardcoding it.',
      content:
        '# Read App Configuration\n\nLoad configuration for an environment from Parameter Store.\n\n## Steps\n1. Identify the hierarchy path that holds the environment’s settings, such as /prod/app.\n2. Read the parameters under that path recursively when the settings are nested.\n3. Only request decryption of SecureString values when the workflow genuinely needs the plaintext; leave it off for a settings inventory.\n4. Map each parameter name to the setting it represents.\n\n## Output\nThe configuration keys and their values. Never echo a decrypted SecureString value into a summary, a log, or a chat message.',
    },
    {
      name: 'promote-parameter-value',
      description:
        'Write or update a Parameter Store value as part of a controlled configuration change. Use to promote a setting between environments or apply an approved change.',
      content:
        '# Promote Parameter Value\n\nApply a configuration change through Parameter Store.\n\n## Steps\n1. Read the current value and metadata of the target parameter so the change can be reversed.\n2. Confirm the parameter type: use SecureString for anything secret, and name the KMS key when the account default is not wanted.\n3. Write the new value with overwrite enabled for an existing parameter, or set the type explicitly when creating a new one.\n4. Read back the parameter metadata to confirm the new version number.\n\n## Output\nThe parameter name, the new version number, and the tier it was stored in. Never print the value itself.',
    },
    {
      name: 'audit-node-inventory',
      description:
        'Report which managed nodes are registered with Systems Manager, their agent version, and whether they are reachable. Use for fleet hygiene and onboarding checks.',
      content:
        '# Audit Node Inventory\n\nReport the state of the managed node fleet.\n\n## Steps\n1. List managed nodes, filtering by ping status or platform type when the audit is scoped.\n2. Group nodes by ping status to find ones that have lost connection.\n3. Flag nodes that are not on the latest agent version, and nodes with no recent successful association run.\n4. Note nodes registered as managed instances rather than EC2 instances, since they onboard differently.\n\n## Output\nA fleet summary: total nodes, unreachable nodes, outdated agents, and the platform mix.',
    },
    {
      name: 'report-patch-compliance',
      description:
        'Summarize patch compliance across managed nodes and drill into missing patches on a specific node. Use for monthly patching reviews and vulnerability follow-up.',
      content:
        '# Report Patch Compliance\n\nShow where the fleet stands on patching.\n\n## Steps\n1. Read patch states for the nodes in scope to get installed, missing, failed, and non-compliant counts per node.\n2. Rank the nodes by critical and security non-compliant counts.\n3. For the worst nodes, list the individual patches and filter to the ones in a Missing or Failed state to get titles, KB IDs, severities, and CVE IDs.\n4. Note nodes whose last patch operation never completed.\n\n## Output\nA ranked compliance table plus, for the top offenders, the specific missing patches and their severities.',
    },
    {
      name: 'run-automation-runbook',
      description:
        'Start an SSM Automation runbook, follow it to completion, and report the step results. Use for scripted remediation such as restarting an instance or rotating an AMI.',
      content:
        '# Run Automation Runbook\n\nDrive an Automation runbook and report what it did.\n\n## Steps\n1. Find the runbook by listing documents filtered to the Automation type, and read its content to confirm the parameters it expects.\n2. Start the execution with those parameters. For a fleet-wide run, set the target parameter name and a rate-control target, plus concurrency and error limits.\n3. Poll the execution until its status leaves the in-progress states.\n4. Read the step executions to see which step failed and why, if it did not succeed.\n5. Stop the execution if it needs to be aborted; cancelling stops it immediately, completing lets the current step finish.\n\n## Output\nThe execution ID, the final status, the runbook outputs, and the failing step with its failure message when applicable.',
    },
    {
      name: 'review-compliance-findings',
      description:
        'Pull Systems Manager compliance findings for a managed node and explain what is non-compliant. Use when a compliance dashboard flags a resource and someone needs the detail.',
      content:
        '# Review Compliance Findings\n\nExplain a node’s compliance status in detail.\n\n## Steps\n1. Read the compliance summaries to see which compliance types are non-compliant and at what severity.\n2. For the affected type, list the compliance items for the specific managed node, filtering to non-compliant status.\n3. Read each item’s title, severity, and details to explain what the finding actually is.\n4. Separate association findings from patch findings, since they are remediated differently.\n\n## Output\nA per-node list of non-compliant findings with severity and a short explanation of each, grouped by compliance type.',
    },
  ],
} as const satisfies BlockMeta
