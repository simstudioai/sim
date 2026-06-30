import { CloudFormationIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type {
  CloudFormationDescribeStackDriftDetectionStatusResponse,
  CloudFormationDescribeStackEventsResponse,
  CloudFormationDescribeStacksResponse,
  CloudFormationDetectStackDriftResponse,
  CloudFormationGetTemplateResponse,
  CloudFormationListStackResourcesResponse,
  CloudFormationValidateTemplateResponse,
} from '@/tools/cloudformation/types'

export const CloudFormationBlock: BlockConfig<
  | CloudFormationDescribeStacksResponse
  | CloudFormationListStackResourcesResponse
  | CloudFormationDetectStackDriftResponse
  | CloudFormationDescribeStackDriftDetectionStatusResponse
  | CloudFormationDescribeStackEventsResponse
  | CloudFormationGetTemplateResponse
  | CloudFormationValidateTemplateResponse
> = {
  type: 'cloudformation',
  name: 'CloudFormation',
  description: 'Manage and inspect AWS CloudFormation stacks, resources, and drift',
  longDescription:
    'Integrate AWS CloudFormation into workflows. Describe stacks, list resources, detect drift, view stack events, retrieve templates, and validate templates. Requires AWS access key and secret access key.',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  docsLink: 'https://docs.sim.ai/integrations/cloudformation',
  bgColor: 'linear-gradient(45deg, #B0084D 0%, #FF4F8B 100%)',
  iconColor: '#FF4F8B',
  icon: CloudFormationIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Describe Stacks', id: 'describe_stacks' },
        { label: 'List Stack Resources', id: 'list_stack_resources' },
        { label: 'Describe Stack Events', id: 'describe_stack_events' },
        { label: 'Detect Stack Drift', id: 'detect_stack_drift' },
        { label: 'Drift Detection Status', id: 'describe_stack_drift_detection_status' },
        { label: 'Get Template', id: 'get_template' },
        { label: 'Validate Template', id: 'validate_template' },
      ],
      value: () => 'describe_stacks',
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
      id: 'stackName',
      title: 'Stack Name',
      type: 'short-input',
      placeholder: 'my-stack or arn:aws:cloudformation:...',
      condition: {
        field: 'operation',
        value: [
          'describe_stacks',
          'list_stack_resources',
          'describe_stack_events',
          'detect_stack_drift',
          'get_template',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'list_stack_resources',
          'describe_stack_events',
          'detect_stack_drift',
          'get_template',
        ],
      },
    },
    {
      id: 'stackDriftDetectionId',
      title: 'Drift Detection ID',
      type: 'short-input',
      placeholder: 'ID from Detect Stack Drift output',
      condition: { field: 'operation', value: 'describe_stack_drift_detection_status' },
      required: { field: 'operation', value: 'describe_stack_drift_detection_status' },
    },
    {
      id: 'templateBody',
      title: 'Template Body',
      type: 'code',
      placeholder: '{\n  "AWSTemplateFormatVersion": "2010-09-09",\n  "Resources": { ... }\n}',
      condition: { field: 'operation', value: 'validate_template' },
      required: { field: 'operation', value: 'validate_template' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '50',
      condition: { field: 'operation', value: 'describe_stack_events' },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'cloudformation_describe_stacks',
      'cloudformation_list_stack_resources',
      'cloudformation_detect_stack_drift',
      'cloudformation_describe_stack_drift_detection_status',
      'cloudformation_describe_stack_events',
      'cloudformation_get_template',
      'cloudformation_validate_template',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'describe_stacks':
            return 'cloudformation_describe_stacks'
          case 'list_stack_resources':
            return 'cloudformation_list_stack_resources'
          case 'detect_stack_drift':
            return 'cloudformation_detect_stack_drift'
          case 'describe_stack_drift_detection_status':
            return 'cloudformation_describe_stack_drift_detection_status'
          case 'describe_stack_events':
            return 'cloudformation_describe_stack_events'
          case 'get_template':
            return 'cloudformation_get_template'
          case 'validate_template':
            return 'cloudformation_validate_template'
          default:
            throw new Error(`Invalid CloudFormation operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, limit, ...rest } = params

        const awsRegion = rest.awsRegion
        const awsAccessKeyId = rest.awsAccessKeyId
        const awsSecretAccessKey = rest.awsSecretAccessKey
        const parsedLimit = limit ? Number.parseInt(String(limit), 10) : undefined

        switch (operation) {
          case 'describe_stacks':
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              ...(rest.stackName && { stackName: rest.stackName }),
            }

          case 'list_stack_resources': {
            if (!rest.stackName) {
              throw new Error('Stack name is required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              stackName: rest.stackName,
            }
          }

          case 'detect_stack_drift': {
            if (!rest.stackName) {
              throw new Error('Stack name is required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              stackName: rest.stackName,
            }
          }

          case 'describe_stack_drift_detection_status': {
            if (!rest.stackDriftDetectionId) {
              throw new Error('Drift detection ID is required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              stackDriftDetectionId: rest.stackDriftDetectionId,
            }
          }

          case 'describe_stack_events': {
            if (!rest.stackName) {
              throw new Error('Stack name is required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              stackName: rest.stackName,
              ...(parsedLimit !== undefined && { limit: parsedLimit }),
            }
          }

          case 'get_template': {
            if (!rest.stackName) {
              throw new Error('Stack name is required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              stackName: rest.stackName,
            }
          }

          case 'validate_template': {
            if (!rest.templateBody) {
              throw new Error('Template body is required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              templateBody: rest.templateBody,
            }
          }

          default:
            throw new Error(`Invalid CloudFormation operation: ${operation}`)
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'CloudFormation operation to perform' },
    awsRegion: { type: 'string', description: 'AWS region' },
    awsAccessKeyId: { type: 'string', description: 'AWS access key ID' },
    awsSecretAccessKey: { type: 'string', description: 'AWS secret access key' },
    stackName: { type: 'string', description: 'Stack name or ID' },
    stackDriftDetectionId: { type: 'string', description: 'Drift detection ID' },
    templateBody: { type: 'string', description: 'CloudFormation template body (JSON or YAML)' },
    limit: { type: 'number', description: 'Maximum number of results' },
  },
  outputs: {
    stacks: {
      type: 'array',
      description: 'List of CloudFormation stacks with status, outputs, and tags',
    },
    resources: {
      type: 'array',
      description: 'List of stack resources with type, status, and drift info',
    },
    events: {
      type: 'array',
      description: 'Stack events with resource status and timestamps',
    },
    stackDriftDetectionId: {
      type: 'string',
      description: 'Drift detection ID for checking status',
    },
    stackId: {
      type: 'string',
      description: 'Stack ID',
    },
    stackDriftStatus: {
      type: 'string',
      description: 'Drift status (DRIFTED, IN_SYNC, NOT_CHECKED)',
    },
    detectionStatus: {
      type: 'string',
      description: 'Detection status (DETECTION_IN_PROGRESS, DETECTION_COMPLETE, DETECTION_FAILED)',
    },
    detectionStatusReason: {
      type: 'string',
      description: 'Reason if detection failed',
    },
    driftedStackResourceCount: {
      type: 'number',
      description: 'Number of drifted resources',
    },
    timestamp: {
      type: 'number',
      description: 'Detection timestamp',
    },
    templateBody: {
      type: 'string',
      description: 'Template body (JSON or YAML)',
    },
    stagesAvailable: {
      type: 'array',
      description: 'Available template stages',
    },
    description: {
      type: 'string',
      description: 'Template description',
    },
    parameters: {
      type: 'array',
      description: 'Template parameters',
    },
    capabilities: {
      type: 'array',
      description: 'Required capabilities',
    },
    capabilitiesReason: {
      type: 'string',
      description: 'Reason capabilities are required',
    },
    declaredTransforms: {
      type: 'array',
      description: 'Transforms used in the template (e.g., AWS::Serverless-2016-10-31)',
    },
  },
}

export const CloudFormationBlockMeta = {
  tags: ['cloud'],
  url: 'https://aws.amazon.com/cloudformation',
  templates: [
    {
      icon: CloudFormationIcon,
      title: 'CloudFormation drift detector',
      prompt:
        'Create a scheduled daily workflow that runs drift detection on every CloudFormation stack in my AWS account, waits for detection to complete, summarizes drifted resources, logs them to a table, and posts a Slack alert when any production stack drifts.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CloudFormationIcon,
      title: 'Stack inventory builder',
      prompt:
        'Build a scheduled weekly workflow that describes every CloudFormation stack, lists its resources, and writes a unified inventory of stacks, status, region, and resource counts into a tracking table so the platform team has a single source of truth.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise', 'reporting'],
    },
    {
      icon: CloudFormationIcon,
      title: 'Template validator gate',
      prompt:
        'Create a workflow triggered when a CloudFormation template is changed in a GitHub pull request. Pull the template, validate it via the CloudFormation API, summarize any syntax or structural errors, and post the validation result as a PR comment to block merges on broken templates.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'engineering'],
      alsoIntegrations: ['github'],
    },
    {
      icon: CloudFormationIcon,
      title: 'Stack failure investigator',
      prompt:
        'Build a scheduled workflow that polls CloudFormation stack events every few minutes, detects rollbacks and create-failed events, pulls the failure reason and recent events from the stack, summarizes the root cause, opens a Linear ticket with the diagnosis, and posts to the on-call Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'automation'],
      alsoIntegrations: ['linear', 'slack'],
    },
    {
      icon: CloudFormationIcon,
      title: 'Template archive and search',
      prompt:
        'Create a scheduled workflow that retrieves the deployed template for every CloudFormation stack, stores each template as a versioned file in your files store, and updates a knowledge base so engineers can search infrastructure definitions in natural language.',
      modules: ['scheduled', 'files', 'knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise', 'research'],
    },
    {
      icon: CloudFormationIcon,
      title: 'Resource change report',
      prompt:
        'Build a scheduled weekly workflow that pulls CloudFormation stack events, summarizes resource creates, updates, and deletes across the account, classifies risky changes, and writes a written change report file for platform leadership review.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting', 'enterprise'],
    },
    {
      icon: CloudFormationIcon,
      title: 'Pre-deploy drift gate',
      prompt:
        'Create a workflow that runs before a deploy, initiates drift detection on the target CloudFormation stack, polls until drift detection completes, and either approves the deploy or blocks it with a Slack alert explaining the drifted resources.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'detect-stack-drift',
      description:
        'Run drift detection on CloudFormation stacks and summarize resources whose live config no longer matches the template.',
      content:
        '# Detect CloudFormation Stack Drift\n\nFind resources that have been changed outside of CloudFormation.\n\n## Steps\n1. List the target stacks (or accept a specific stack name).\n2. Initiate drift detection for each stack and poll until detection completes.\n3. Pull the drift results and isolate resources with status DRIFTED or DELETED.\n4. For each drifted resource, summarize the property differences.\n\n## Output\nA per-stack drift report listing each drifted resource, its type, and the specific properties that differ from the template.',
    },
    {
      name: 'inventory-stacks',
      description:
        'List CloudFormation stacks with their status, region, and resources to build a single inventory of deployed infrastructure.',
      content:
        '# Inventory CloudFormation Stacks\n\nBuild a unified view of all deployed stacks.\n\n## Steps\n1. List every stack and capture name, status, creation/update time, and region.\n2. For each stack, describe its resources and count them by type.\n3. Highlight stacks in failed or rollback states.\n\n## Output\nA table of stacks with status, region, resource count, and any stacks needing attention.',
    },
    {
      name: 'investigate-stack-failure',
      description:
        'Pull recent CloudFormation stack events to diagnose a failed create, update, or rollback and explain the root cause.',
      content:
        '# Investigate CloudFormation Stack Failure\n\nDiagnose why a stack operation failed.\n\n## Steps\n1. Describe the target stack and confirm its current status.\n2. Pull recent stack events, ordered newest first.\n3. Find the first FAILED event and read its resource status reason.\n4. Trace any dependent resource failures that cascaded from it.\n\n## Output\nA plain-English root-cause summary naming the failing resource, the error reason, and a suggested fix.',
    },
  ],
} as const satisfies BlockMeta
