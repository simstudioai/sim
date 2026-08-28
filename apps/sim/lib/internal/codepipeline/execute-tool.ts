import { toError } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { awsCodepipelineDisableStageTransitionContract } from '@/lib/api/contracts/tools/aws/codepipeline-disable-stage-transition'
import { awsCodepipelineEnableStageTransitionContract } from '@/lib/api/contracts/tools/aws/codepipeline-enable-stage-transition'
import { awsCodepipelineGetPipelineContract } from '@/lib/api/contracts/tools/aws/codepipeline-get-pipeline'
import { awsCodepipelineGetPipelineExecutionContract } from '@/lib/api/contracts/tools/aws/codepipeline-get-pipeline-execution'
import { awsCodepipelineGetPipelineStateContract } from '@/lib/api/contracts/tools/aws/codepipeline-get-pipeline-state'
import { awsCodepipelineListActionExecutionsContract } from '@/lib/api/contracts/tools/aws/codepipeline-list-action-executions'
import { awsCodepipelineListPipelineExecutionsContract } from '@/lib/api/contracts/tools/aws/codepipeline-list-pipeline-executions'
import { awsCodepipelineListPipelinesContract } from '@/lib/api/contracts/tools/aws/codepipeline-list-pipelines'
import { awsCodepipelinePutApprovalResultContract } from '@/lib/api/contracts/tools/aws/codepipeline-put-approval-result'
import { awsCodepipelineRetryStageExecutionContract } from '@/lib/api/contracts/tools/aws/codepipeline-retry-stage-execution'
import { awsCodepipelineStartExecutionContract } from '@/lib/api/contracts/tools/aws/codepipeline-start-execution'
import { awsCodepipelineStopExecutionContract } from '@/lib/api/contracts/tools/aws/codepipeline-stop-execution'
import { awsErrorStatus } from '@/lib/internal/codepipeline/errors'
import {
  executeCodepipelineDisableStageTransition,
  executeCodepipelineEnableStageTransition,
  executeCodepipelineGetPipeline,
  executeCodepipelineGetPipelineExecution,
  executeCodepipelineGetPipelineState,
  executeCodepipelineListActionExecutions,
  executeCodepipelineListPipelineExecutions,
  executeCodepipelineListPipelines,
  executeCodepipelinePutApprovalResult,
  executeCodepipelineRetryStageExecution,
  executeCodepipelineStartExecution,
  executeCodepipelineStopExecution,
} from '@/lib/internal/codepipeline/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  errorMessage: string,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    return Response.json(
      { error: `${errorMessage}: ${toError(error).message}` },
      { status: awsErrorStatus(error) }
    )
  }
}

export const executeCodepipelineTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()
  switch (toolId) {
    case 'codepipeline_disable_stage_transition':
      return executeOperation(
        awsCodepipelineDisableStageTransitionContract,
        input,
        executeCodepipelineDisableStageTransition,
        'Failed to disable CodePipeline stage transition',
        signal
      )
    case 'codepipeline_enable_stage_transition':
      return executeOperation(
        awsCodepipelineEnableStageTransitionContract,
        input,
        executeCodepipelineEnableStageTransition,
        'Failed to enable CodePipeline stage transition',
        signal
      )
    case 'codepipeline_get_pipeline_execution':
      return executeOperation(
        awsCodepipelineGetPipelineExecutionContract,
        input,
        executeCodepipelineGetPipelineExecution,
        'Failed to get CodePipeline pipeline execution',
        signal
      )
    case 'codepipeline_get_pipeline_state':
      return executeOperation(
        awsCodepipelineGetPipelineStateContract,
        input,
        executeCodepipelineGetPipelineState,
        'Failed to get CodePipeline pipeline state',
        signal
      )
    case 'codepipeline_get_pipeline':
      return executeOperation(
        awsCodepipelineGetPipelineContract,
        input,
        executeCodepipelineGetPipeline,
        'Failed to get CodePipeline pipeline',
        signal
      )
    case 'codepipeline_list_action_executions':
      return executeOperation(
        awsCodepipelineListActionExecutionsContract,
        input,
        executeCodepipelineListActionExecutions,
        'Failed to list CodePipeline action executions',
        signal
      )
    case 'codepipeline_list_pipeline_executions':
      return executeOperation(
        awsCodepipelineListPipelineExecutionsContract,
        input,
        executeCodepipelineListPipelineExecutions,
        'Failed to list CodePipeline pipeline executions',
        signal
      )
    case 'codepipeline_list_pipelines':
      return executeOperation(
        awsCodepipelineListPipelinesContract,
        input,
        executeCodepipelineListPipelines,
        'Failed to list CodePipeline pipelines',
        signal
      )
    case 'codepipeline_put_approval_result':
      return executeOperation(
        awsCodepipelinePutApprovalResultContract,
        input,
        executeCodepipelinePutApprovalResult,
        'Failed to submit CodePipeline approval result',
        signal
      )
    case 'codepipeline_retry_stage_execution':
      return executeOperation(
        awsCodepipelineRetryStageExecutionContract,
        input,
        executeCodepipelineRetryStageExecution,
        'Failed to retry CodePipeline stage execution',
        signal
      )
    case 'codepipeline_start_execution':
      return executeOperation(
        awsCodepipelineStartExecutionContract,
        input,
        executeCodepipelineStartExecution,
        'Failed to start CodePipeline pipeline execution',
        signal
      )
    case 'codepipeline_stop_execution':
      return executeOperation(
        awsCodepipelineStopExecutionContract,
        input,
        executeCodepipelineStopExecution,
        'Failed to stop CodePipeline pipeline execution',
        signal
      )
    default:
      return Response.json({ error: `Unsupported CodePipeline tool: ${toolId}` }, { status: 500 })
  }
}
