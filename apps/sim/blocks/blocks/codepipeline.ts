import { CodePipelineBlockDisplay } from '@/blocks/blocks/codepipeline.display'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
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
  ...CodePipelineBlockDisplay,
  authMode: AuthMode.ApiKey,
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
