import { CodePipelineIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import {
  parseOptionalBooleanInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'
import type {
  CodePipelineGetPipelineExecutionResponse,
  CodePipelineGetPipelineStateResponse,
  CodePipelineListPipelineExecutionsResponse,
  CodePipelineListPipelinesResponse,
  CodePipelinePutApprovalResultResponse,
  CodePipelineRetryStageExecutionResponse,
  CodePipelineStartExecutionResponse,
  CodePipelineStopExecutionResponse,
} from '@/tools/codepipeline/types'

export const CodePipelineBlock: BlockConfig<
  | CodePipelineListPipelinesResponse
  | CodePipelineGetPipelineStateResponse
  | CodePipelineGetPipelineExecutionResponse
  | CodePipelineListPipelineExecutionsResponse
  | CodePipelineStartExecutionResponse
  | CodePipelineStopExecutionResponse
  | CodePipelineRetryStageExecutionResponse
  | CodePipelinePutApprovalResultResponse
> = {
  type: 'codepipeline',
  name: 'CodePipeline',
  description: 'Run, monitor, and approve AWS CodePipeline pipelines',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate AWS CodePipeline into workflows. Start, stop, and monitor pipeline executions, retry failed stages, and approve or reject manual approval actions. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/codepipeline',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: 'linear-gradient(45deg, #2E27AD 0%, #527FFF 100%)',
  iconColor: '#527FFF',
  icon: CodePipelineIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Start Execution', id: 'start_execution' },
        { label: 'Get Pipeline State', id: 'get_pipeline_state' },
        { label: 'List Pipelines', id: 'list_pipelines' },
        { label: 'List Executions', id: 'list_pipeline_executions' },
        { label: 'Get Execution', id: 'get_pipeline_execution' },
        { label: 'Stop Execution', id: 'stop_execution' },
        { label: 'Retry Stage', id: 'retry_stage_execution' },
        { label: 'Approve / Reject Approval', id: 'put_approval_result' },
      ],
      value: () => 'start_execution',
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
      id: 'pipelineName',
      title: 'Pipeline Name',
      type: 'short-input',
      placeholder: 'my-pipeline',
      condition: {
        field: 'operation',
        value: [
          'start_execution',
          'get_pipeline_state',
          'list_pipeline_executions',
          'get_pipeline_execution',
          'stop_execution',
          'retry_stage_execution',
          'put_approval_result',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'start_execution',
          'get_pipeline_state',
          'list_pipeline_executions',
          'get_pipeline_execution',
          'stop_execution',
          'retry_stage_execution',
          'put_approval_result',
        ],
      },
    },
    {
      id: 'pipelineExecutionId',
      title: 'Execution ID',
      type: 'short-input',
      placeholder: 'e.g., 3137f7cb-7cf7-4abc-9f1d-d7eu3471a2b1',
      condition: {
        field: 'operation',
        value: ['get_pipeline_execution', 'stop_execution', 'retry_stage_execution'],
      },
      required: {
        field: 'operation',
        value: ['get_pipeline_execution', 'stop_execution', 'retry_stage_execution'],
      },
    },
    {
      id: 'stageName',
      title: 'Stage Name',
      type: 'short-input',
      placeholder: 'e.g., Deploy',
      condition: { field: 'operation', value: ['retry_stage_execution', 'put_approval_result'] },
      required: { field: 'operation', value: ['retry_stage_execution', 'put_approval_result'] },
    },
    {
      id: 'retryMode',
      title: 'Retry Mode',
      type: 'dropdown',
      options: [
        { label: 'Failed Actions Only', id: 'FAILED_ACTIONS' },
        { label: 'All Actions', id: 'ALL_ACTIONS' },
      ],
      value: () => 'FAILED_ACTIONS',
      condition: { field: 'operation', value: 'retry_stage_execution' },
      required: { field: 'operation', value: 'retry_stage_execution' },
    },
    {
      id: 'actionName',
      title: 'Approval Action Name',
      type: 'short-input',
      placeholder: 'e.g., ManualApproval',
      condition: { field: 'operation', value: 'put_approval_result' },
      required: { field: 'operation', value: 'put_approval_result' },
    },
    {
      id: 'approvalToken',
      title: 'Approval Token',
      type: 'short-input',
      placeholder: 'Token from Get Pipeline State',
      condition: { field: 'operation', value: 'put_approval_result' },
      required: { field: 'operation', value: 'put_approval_result' },
    },
    {
      id: 'approvalStatus',
      title: 'Decision',
      type: 'dropdown',
      options: [
        { label: 'Approve', id: 'Approved' },
        { label: 'Reject', id: 'Rejected' },
      ],
      value: () => 'Approved',
      condition: { field: 'operation', value: 'put_approval_result' },
      required: { field: 'operation', value: 'put_approval_result' },
    },
    {
      id: 'approvalSummary',
      title: 'Summary',
      type: 'short-input',
      placeholder: 'Why the change is approved or rejected',
      condition: { field: 'operation', value: 'put_approval_result' },
      required: { field: 'operation', value: 'put_approval_result' },
    },
    {
      id: 'pipelineVariables',
      title: 'Pipeline Variables',
      type: 'table',
      columns: ['name', 'value'],
      condition: { field: 'operation', value: 'start_execution' },
    },
    {
      id: 'clientRequestToken',
      title: 'Client Request Token',
      type: 'short-input',
      placeholder: 'Idempotency token (letters, digits, hyphens)',
      condition: { field: 'operation', value: 'start_execution' },
      mode: 'advanced',
    },
    {
      id: 'abandon',
      title: 'Abandon In-Progress Actions',
      type: 'switch',
      condition: { field: 'operation', value: 'stop_execution' },
      mode: 'advanced',
    },
    {
      id: 'stopReason',
      title: 'Stop Reason',
      type: 'short-input',
      placeholder: 'Why the execution is being stopped',
      condition: { field: 'operation', value: 'stop_execution' },
      mode: 'advanced',
    },
    {
      id: 'succeededInStage',
      title: 'Succeeded In Stage',
      type: 'short-input',
      placeholder: 'Only executions that succeeded in this stage',
      condition: { field: 'operation', value: 'list_pipeline_executions' },
      mode: 'advanced',
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: ['list_pipelines', 'list_pipeline_executions'] },
      mode: 'advanced',
    },
    {
      id: 'nextToken',
      title: 'Next Token',
      type: 'short-input',
      placeholder: 'Pagination token from a previous call',
      condition: { field: 'operation', value: ['list_pipelines', 'list_pipeline_executions'] },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'codepipeline_list_pipelines',
      'codepipeline_get_pipeline_state',
      'codepipeline_get_pipeline_execution',
      'codepipeline_list_pipeline_executions',
      'codepipeline_start_execution',
      'codepipeline_stop_execution',
      'codepipeline_retry_stage_execution',
      'codepipeline_put_approval_result',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'list_pipelines':
            return 'codepipeline_list_pipelines'
          case 'get_pipeline_state':
            return 'codepipeline_get_pipeline_state'
          case 'get_pipeline_execution':
            return 'codepipeline_get_pipeline_execution'
          case 'list_pipeline_executions':
            return 'codepipeline_list_pipeline_executions'
          case 'start_execution':
            return 'codepipeline_start_execution'
          case 'stop_execution':
            return 'codepipeline_stop_execution'
          case 'retry_stage_execution':
            return 'codepipeline_retry_stage_execution'
          case 'put_approval_result':
            return 'codepipeline_put_approval_result'
          default:
            throw new Error(`Invalid CodePipeline operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, maxResults, ...rest } = params

        const awsRegion = rest.awsRegion
        const awsAccessKeyId = rest.awsAccessKeyId
        const awsSecretAccessKey = rest.awsSecretAccessKey
        const parsedMaxResults = parseOptionalNumberInput(maxResults, 'Max results', {
          integer: true,
          min: 1,
        })

        switch (operation) {
          case 'list_pipelines':
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              ...(parsedMaxResults !== undefined && { maxResults: parsedMaxResults }),
              ...(rest.nextToken && { nextToken: rest.nextToken }),
            }

          case 'get_pipeline_state':
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              pipelineName: rest.pipelineName,
            }

          case 'get_pipeline_execution':
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              pipelineName: rest.pipelineName,
              pipelineExecutionId: rest.pipelineExecutionId,
            }

          case 'list_pipeline_executions':
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              pipelineName: rest.pipelineName,
              ...(parsedMaxResults !== undefined && { maxResults: parsedMaxResults }),
              ...(rest.nextToken && { nextToken: rest.nextToken }),
              ...(rest.succeededInStage && { succeededInStage: rest.succeededInStage }),
            }

          case 'start_execution': {
            const rows = parseOptionalJsonInput(rest.pipelineVariables, 'Pipeline variables')
            const variables = (() => {
              if (rows === undefined) return undefined
              if (!Array.isArray(rows)) {
                throw new Error('Pipeline variables must be an array of { name, value } objects')
              }
              const entries = rows
                .map((row) => ({
                  name: row?.cells?.name ?? row?.name,
                  value: row?.cells?.value ?? row?.value,
                }))
                .filter((entry) => entry.name && entry.value !== undefined && entry.value !== '')
                .map((entry) => ({ name: String(entry.name), value: String(entry.value) }))
              return entries.length > 0 ? entries : undefined
            })()

            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              pipelineName: rest.pipelineName,
              ...(rest.clientRequestToken && { clientRequestToken: rest.clientRequestToken }),
              ...(variables && { variables }),
            }
          }

          case 'stop_execution': {
            const abandon = parseOptionalBooleanInput(rest.abandon)
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              pipelineName: rest.pipelineName,
              pipelineExecutionId: rest.pipelineExecutionId,
              ...(abandon !== undefined && { abandon }),
              ...(rest.stopReason && { reason: rest.stopReason }),
            }
          }

          case 'retry_stage_execution':
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              pipelineName: rest.pipelineName,
              stageName: rest.stageName,
              pipelineExecutionId: rest.pipelineExecutionId,
              retryMode: rest.retryMode,
            }

          case 'put_approval_result':
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              pipelineName: rest.pipelineName,
              stageName: rest.stageName,
              actionName: rest.actionName,
              token: rest.approvalToken,
              status: rest.approvalStatus,
              summary: rest.approvalSummary,
            }

          default:
            throw new Error(`Invalid CodePipeline operation: ${operation}`)
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'CodePipeline operation to perform' },
    awsRegion: { type: 'string', description: 'AWS region' },
    awsAccessKeyId: { type: 'string', description: 'AWS access key ID' },
    awsSecretAccessKey: { type: 'string', description: 'AWS secret access key' },
    pipelineName: { type: 'string', description: 'Pipeline name' },
    pipelineExecutionId: { type: 'string', description: 'Pipeline execution ID' },
    stageName: { type: 'string', description: 'Stage name for retry or approval' },
    retryMode: {
      type: 'string',
      description: 'Retry scope: FAILED_ACTIONS or ALL_ACTIONS',
    },
    actionName: { type: 'string', description: 'Manual approval action name' },
    approvalToken: {
      type: 'string',
      description: 'Approval token from Get Pipeline State for the pending approval',
    },
    approvalStatus: { type: 'string', description: 'Approval decision: Approved or Rejected' },
    approvalSummary: { type: 'string', description: 'Summary explaining the approval decision' },
    pipelineVariables: {
      type: 'json',
      description: 'Pipeline variable overrides (name/value pairs)',
    },
    clientRequestToken: {
      type: 'string',
      description: 'Idempotency token for starting an execution',
    },
    abandon: {
      type: 'boolean',
      description: 'Abandon in-progress actions instead of letting them finish',
    },
    stopReason: { type: 'string', description: 'Reason for stopping the execution' },
    succeededInStage: {
      type: 'string',
      description: 'Only list executions that succeeded in this stage',
    },
    maxResults: { type: 'number', description: 'Maximum number of results' },
    nextToken: { type: 'string', description: 'Pagination token from a previous call' },
  },
  outputs: {
    pipelines: {
      type: 'array',
      description: 'List of pipelines with name, version, type, and timestamps',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
    },
    pipelineName: {
      type: 'string',
      description: 'Pipeline name',
    },
    pipelineVersion: {
      type: 'number',
      description: 'Pipeline version number',
    },
    created: {
      type: 'number',
      description: 'Epoch ms when the pipeline was created',
    },
    updated: {
      type: 'number',
      description: 'Epoch ms when the pipeline was last updated',
    },
    stageStates: {
      type: 'array',
      description: 'Per-stage state including action status and pending approval tokens',
    },
    pipelineExecutionId: {
      type: 'string',
      description: 'Pipeline execution ID',
    },
    status: {
      type: 'string',
      description: 'Execution status or submitted approval decision',
    },
    statusSummary: {
      type: 'string',
      description: 'Status summary for the execution',
    },
    executionMode: {
      type: 'string',
      description: 'Execution mode (QUEUED, SUPERSEDED, PARALLEL)',
    },
    executionType: {
      type: 'string',
      description: 'Execution type (STANDARD or ROLLBACK)',
    },
    triggerType: {
      type: 'string',
      description: 'What triggered the execution',
    },
    triggerDetail: {
      type: 'string',
      description: 'Detail about the trigger',
    },
    artifactRevisions: {
      type: 'array',
      description: 'Source artifact revisions for the execution',
    },
    variables: {
      type: 'array',
      description: 'Resolved pipeline variables for the execution',
    },
    executions: {
      type: 'array',
      description: 'Pipeline execution summaries, most recent first',
    },
    approvedAt: {
      type: 'number',
      description: 'Epoch ms when the approval or rejection was submitted',
    },
  },
}

export const CodePipelineBlockMeta = {
  tags: ['cloud', 'ci-cd'],
  url: 'https://aws.amazon.com/codepipeline',
  templates: [
    {
      icon: CodePipelineIcon,
      title: 'CodePipeline deploy approver',
      prompt:
        'Build a workflow that checks a CodePipeline pipeline for pending manual approvals, posts the change summary and source revisions to Slack, and approves or rejects the deployment based on the team lead reply.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CodePipelineIcon,
      title: 'CodePipeline failure triage',
      prompt:
        'Create a scheduled workflow that polls CodePipeline executions every few minutes, and when one fails, pulls the pipeline state to find the failing stage and action error, opens a Linear issue, and alerts the on-call channel in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'automation'],
      alsoIntegrations: ['linear', 'slack'],
    },
    {
      icon: CodePipelineIcon,
      title: 'CodePipeline release train',
      prompt:
        'Build a scheduled workflow that starts the release CodePipeline pipeline every weekday at 9am with the release version as a pipeline variable, then posts the execution ID and a link to Slack.',
      modules: ['scheduled', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CodePipelineIcon,
      title: 'CodePipeline deploy digest',
      prompt:
        'Create a scheduled daily workflow that lists executions across the team CodePipeline pipelines, summarizes successes, failures, and rollbacks with their source revisions, and posts a digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CodePipelineIcon,
      title: 'CodePipeline flaky-stage retrier',
      prompt:
        'Build a scheduled workflow that finds failed CodePipeline executions, retries the failed stage once with failed-actions mode, and escalates to PagerDuty if the retry fails again.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: CodePipelineIcon,
      title: 'CodePipeline rollback brake',
      prompt:
        'Create a workflow that watches CloudWatch alarms after a deployment, and when an error-rate alarm fires while a CodePipeline execution is in progress, stops the execution with a reason and notifies the release channel.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'automation'],
      alsoIntegrations: ['cloudwatch', 'slack'],
    },
    {
      icon: CodePipelineIcon,
      title: 'CodePipeline deployment audit log',
      prompt:
        'Build a scheduled workflow that records every CodePipeline execution — pipeline, status, trigger, source revisions, and timing — into a table for compliance and deployment-frequency reporting.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'approve-pending-deployment',
      description:
        'Find a pending CodePipeline manual approval, summarize the change, and approve or reject it.',
      content:
        '# Approve Pending CodePipeline Deployment\n\nHandle a manual approval gate in a pipeline.\n\n## Steps\n1. Get the pipeline state and locate the action awaiting approval (status InProgress on a manual approval action) and its approval token.\n2. Pull the execution details for the stage to summarize what is being deployed (source revisions, trigger).\n3. Submit the approval result with the token, the Approved or Rejected decision, and a summary explaining the decision.\n\n## Output\nThe decision that was submitted, the approval summary, and the pipeline/stage/action it applied to.',
    },
    {
      name: 'investigate-failed-pipeline',
      description:
        'Find the failing stage and action of a CodePipeline execution and report the error details.',
      content:
        '# Investigate Failed CodePipeline Execution\n\nDiagnose why a pipeline run failed.\n\n## Steps\n1. List recent executions for the pipeline and identify the failed one (or use the provided execution ID).\n2. Get the pipeline state and find the stage and action with a Failed status.\n3. Capture the action error code, error message, and external execution URL, plus the source revisions that were being deployed.\n\n## Output\nThe failing stage and action, the error details, the commit/revision involved, and a link to the external execution.',
    },
    {
      name: 'trigger-pipeline-release',
      description:
        'Start a CodePipeline execution, optionally with variable overrides, and report the execution ID.',
      content:
        '# Trigger CodePipeline Release\n\nKick off a pipeline run.\n\n## Steps\n1. Confirm the pipeline name (list pipelines if unsure).\n2. Start the execution, passing any pipeline variable overrides (e.g. version or environment) and an idempotency token if retries are possible.\n3. Optionally poll the pipeline state to confirm the execution entered the first stage.\n\n## Output\nThe pipeline execution ID that was started and the variables it ran with.',
    },
    {
      name: 'retry-failed-stage',
      description:
        'Retry the failed actions of a CodePipeline stage and confirm the stage re-entered execution.',
      content:
        '# Retry Failed CodePipeline Stage\n\nRe-run a failed stage without restarting the whole pipeline.\n\n## Steps\n1. Get the pipeline state and identify the failed stage and the execution ID stuck in it.\n2. Retry the stage with FAILED_ACTIONS mode (or ALL_ACTIONS if the whole stage should re-run).\n3. Check the pipeline state again to confirm the stage is InProgress.\n\n## Output\nThe stage that was retried, the retry mode used, and the current stage status.',
    },
  ],
} as const satisfies BlockMeta
