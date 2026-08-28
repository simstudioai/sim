import {
  type ApprovalStatus,
  type CodePipelineClient,
  DisableStageTransitionCommand,
  EnableStageTransitionCommand,
  GetPipelineCommand,
  GetPipelineExecutionCommand,
  GetPipelineStateCommand,
  ListActionExecutionsCommand,
  ListPipelineExecutionsCommand,
  ListPipelinesCommand,
  PutApprovalResultCommand,
  RetryStageExecutionCommand,
  type StageRetryMode,
  type StageTransitionType,
  StartPipelineExecutionCommand,
  StopPipelineExecutionCommand,
} from '@aws-sdk/client-codepipeline'
import type { AwsCodepipelineDisableStageTransitionBody } from '@/lib/api/contracts/tools/aws/codepipeline-disable-stage-transition'
import type { AwsCodepipelineEnableStageTransitionBody } from '@/lib/api/contracts/tools/aws/codepipeline-enable-stage-transition'
import type { AwsCodepipelineGetPipelineBody } from '@/lib/api/contracts/tools/aws/codepipeline-get-pipeline'
import type { AwsCodepipelineGetPipelineExecutionBody } from '@/lib/api/contracts/tools/aws/codepipeline-get-pipeline-execution'
import type { AwsCodepipelineGetPipelineStateBody } from '@/lib/api/contracts/tools/aws/codepipeline-get-pipeline-state'
import type { AwsCodepipelineListActionExecutionsBody } from '@/lib/api/contracts/tools/aws/codepipeline-list-action-executions'
import type { AwsCodepipelineListPipelineExecutionsBody } from '@/lib/api/contracts/tools/aws/codepipeline-list-pipeline-executions'
import type { AwsCodepipelineListPipelinesBody } from '@/lib/api/contracts/tools/aws/codepipeline-list-pipelines'
import type { AwsCodepipelinePutApprovalResultBody } from '@/lib/api/contracts/tools/aws/codepipeline-put-approval-result'
import type { AwsCodepipelineRetryStageExecutionBody } from '@/lib/api/contracts/tools/aws/codepipeline-retry-stage-execution'
import type { AwsCodepipelineStartExecutionBody } from '@/lib/api/contracts/tools/aws/codepipeline-start-execution'
import type { AwsCodepipelineStopExecutionBody } from '@/lib/api/contracts/tools/aws/codepipeline-stop-execution'
import {
  type CodePipelineConnectionConfig,
  createCodePipelineClient,
} from '@/lib/internal/codepipeline/client'

async function withCodePipelineClient<T>(
  input: CodePipelineConnectionConfig,
  execute: (client: CodePipelineClient) => Promise<T>
): Promise<T> {
  const client = createCodePipelineClient(input)
  try {
    return await execute(client)
  } finally {
    client.destroy()
  }
}

export async function executeCodepipelineDisableStageTransition(
  input: AwsCodepipelineDisableStageTransitionBody,
  signal?: AbortSignal
) {
  return withCodePipelineClient(input, async (client) => {
    await client.send(
      new DisableStageTransitionCommand({
        pipelineName: input.pipelineName,
        stageName: input.stageName,
        transitionType: input.transitionType as StageTransitionType,
        reason: input.reason,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        pipelineName: input.pipelineName,
        stageName: input.stageName,
        transitionType: input.transitionType,
      },
    }
  })
}

export async function executeCodepipelineEnableStageTransition(
  input: AwsCodepipelineEnableStageTransitionBody,
  signal?: AbortSignal
) {
  return withCodePipelineClient(input, async (client) => {
    await client.send(
      new EnableStageTransitionCommand({
        pipelineName: input.pipelineName,
        stageName: input.stageName,
        transitionType: input.transitionType as StageTransitionType,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: {
        pipelineName: input.pipelineName,
        stageName: input.stageName,
        transitionType: input.transitionType,
      },
    }
  })
}

export async function executeCodepipelineGetPipelineExecution(
  input: AwsCodepipelineGetPipelineExecutionBody,
  signal?: AbortSignal
) {
  return withCodePipelineClient(input, async (client) => {
    const response = await client.send(
      new GetPipelineExecutionCommand({
        pipelineName: input.pipelineName,
        pipelineExecutionId: input.pipelineExecutionId,
      }),
      { abortSignal: signal }
    )
    const execution = response.pipelineExecution
    if (!execution) throw new Error('Pipeline execution not found in response')

    return {
      success: true,
      output: {
        pipelineExecutionId: execution.pipelineExecutionId ?? input.pipelineExecutionId,
        pipelineName: execution.pipelineName ?? input.pipelineName,
        pipelineVersion: execution.pipelineVersion,
        status: execution.status ?? 'Unknown',
        statusSummary: execution.statusSummary,
        executionMode: execution.executionMode,
        executionType: execution.executionType,
        triggerType: execution.trigger?.triggerType,
        triggerDetail: execution.trigger?.triggerDetail,
        artifactRevisions: (execution.artifactRevisions ?? []).map((revision) => ({
          name: revision.name ?? '',
          revisionId: revision.revisionId,
          revisionSummary: revision.revisionSummary,
          revisionUrl: revision.revisionUrl,
          created: revision.created?.getTime(),
        })),
        variables: (execution.variables ?? []).map((variable) => ({
          name: variable.name ?? '',
          resolvedValue: variable.resolvedValue ?? '',
        })),
      },
    }
  })
}

export async function executeCodepipelineGetPipelineState(
  input: AwsCodepipelineGetPipelineStateBody,
  signal?: AbortSignal
) {
  return withCodePipelineClient(input, async (client) => {
    const response = await client.send(new GetPipelineStateCommand({ name: input.pipelineName }), {
      abortSignal: signal,
    })
    const stageStates = (response.stageStates ?? []).map((stage) => ({
      stageName: stage.stageName ?? '',
      status: stage.latestExecution?.status,
      pipelineExecutionId: stage.latestExecution?.pipelineExecutionId,
      inboundTransitionEnabled: stage.inboundTransitionState?.enabled,
      actionStates: (stage.actionStates ?? []).map((action) => ({
        actionName: action.actionName ?? '',
        status: action.latestExecution?.status,
        summary: action.latestExecution?.summary,
        lastStatusChange: action.latestExecution?.lastStatusChange?.getTime(),
        externalExecutionId: action.latestExecution?.externalExecutionId,
        externalExecutionUrl: action.latestExecution?.externalExecutionUrl,
        errorCode: action.latestExecution?.errorDetails?.code,
        errorMessage: action.latestExecution?.errorDetails?.message,
        percentComplete: action.latestExecution?.percentComplete,
        token: action.latestExecution?.token,
        revisionId: action.currentRevision?.revisionId,
        entityUrl: action.entityUrl,
      })),
    }))
    return {
      success: true,
      output: {
        pipelineName: response.pipelineName ?? input.pipelineName,
        pipelineVersion: response.pipelineVersion,
        created: response.created?.getTime(),
        updated: response.updated?.getTime(),
        stageStates,
      },
    }
  })
}

export async function executeCodepipelineGetPipeline(
  input: AwsCodepipelineGetPipelineBody,
  signal?: AbortSignal
) {
  return withCodePipelineClient(input, async (client) => {
    const response = await client.send(
      new GetPipelineCommand({
        name: input.pipelineName,
        ...(input.version !== undefined ? { version: input.version } : {}),
      }),
      { abortSignal: signal }
    )
    const pipeline = response.pipeline
    if (!pipeline) throw new Error('Pipeline structure not found in response')

    const stages = (pipeline.stages ?? []).map((stage) => ({
      stageName: stage.name ?? '',
      actions: (stage.actions ?? []).map((action) => ({
        name: action.name ?? '',
        category: action.actionTypeId?.category ?? '',
        owner: action.actionTypeId?.owner ?? '',
        provider: action.actionTypeId?.provider ?? '',
        version: action.actionTypeId?.version ?? '',
        runOrder: action.runOrder,
        configuration: action.configuration ?? {},
        inputArtifacts: (action.inputArtifacts ?? []).map((artifact) => artifact.name ?? ''),
        outputArtifacts: (action.outputArtifacts ?? []).map((artifact) => artifact.name ?? ''),
      })),
    }))
    return {
      success: true,
      output: {
        pipelineName: pipeline.name ?? input.pipelineName,
        pipelineArn: response.metadata?.pipelineArn,
        roleArn: pipeline.roleArn ?? '',
        version: pipeline.version,
        pipelineType: pipeline.pipelineType,
        executionMode: pipeline.executionMode,
        artifactStoreType: pipeline.artifactStore?.type,
        artifactStoreLocation: pipeline.artifactStore?.location,
        stages,
        variables: (pipeline.variables ?? []).map((variable) => ({
          name: variable.name ?? '',
          defaultValue: variable.defaultValue,
          description: variable.description,
        })),
        created: response.metadata?.created?.getTime(),
        updated: response.metadata?.updated?.getTime(),
      },
    }
  })
}

export async function executeCodepipelineListActionExecutions(
  input: AwsCodepipelineListActionExecutionsBody,
  signal?: AbortSignal
) {
  return withCodePipelineClient(input, async (client) => {
    const response = await client.send(
      new ListActionExecutionsCommand({
        pipelineName: input.pipelineName,
        ...(input.pipelineExecutionId
          ? { filter: { pipelineExecutionId: input.pipelineExecutionId } }
          : {}),
        ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
        ...(input.nextToken ? { nextToken: input.nextToken } : {}),
      }),
      { abortSignal: signal }
    )
    const actionExecutionDetails = (response.actionExecutionDetails ?? []).map((detail) => ({
      pipelineExecutionId: detail.pipelineExecutionId,
      actionExecutionId: detail.actionExecutionId,
      pipelineVersion: detail.pipelineVersion,
      stageName: detail.stageName,
      actionName: detail.actionName,
      startTime: detail.startTime?.getTime(),
      lastUpdateTime: detail.lastUpdateTime?.getTime(),
      updatedBy: detail.updatedBy,
      status: detail.status,
      externalExecutionId: detail.output?.executionResult?.externalExecutionId,
      externalExecutionSummary: detail.output?.executionResult?.externalExecutionSummary,
      externalExecutionUrl: detail.output?.executionResult?.externalExecutionUrl,
      errorCode: detail.output?.executionResult?.errorDetails?.code,
      errorMessage: detail.output?.executionResult?.errorDetails?.message,
    }))
    return {
      success: true,
      output: {
        actionExecutionDetails,
        ...(response.nextToken ? { nextToken: response.nextToken } : {}),
      },
    }
  })
}

export async function executeCodepipelineListPipelineExecutions(
  input: AwsCodepipelineListPipelineExecutionsBody,
  signal?: AbortSignal
) {
  return withCodePipelineClient(input, async (client) => {
    const response = await client.send(
      new ListPipelineExecutionsCommand({
        pipelineName: input.pipelineName,
        ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
        ...(input.nextToken ? { nextToken: input.nextToken } : {}),
        ...(input.succeededInStage
          ? { filter: { succeededInStage: { stageName: input.succeededInStage } } }
          : {}),
      }),
      { abortSignal: signal }
    )
    const executions = (response.pipelineExecutionSummaries ?? []).map((execution) => ({
      pipelineExecutionId: execution.pipelineExecutionId ?? '',
      status: execution.status ?? 'Unknown',
      statusSummary: execution.statusSummary,
      startTime: execution.startTime?.getTime(),
      lastUpdateTime: execution.lastUpdateTime?.getTime(),
      executionMode: execution.executionMode,
      executionType: execution.executionType,
      stopTriggerReason: execution.stopTrigger?.reason,
      triggerType: execution.trigger?.triggerType,
      triggerDetail: execution.trigger?.triggerDetail,
      rollbackTargetPipelineExecutionId:
        execution.rollbackMetadata?.rollbackTargetPipelineExecutionId,
      sourceRevisions: (execution.sourceRevisions ?? []).map((revision) => ({
        actionName: revision.actionName ?? '',
        revisionId: revision.revisionId,
        revisionSummary: revision.revisionSummary,
        revisionUrl: revision.revisionUrl,
      })),
    }))
    return {
      success: true,
      output: {
        executions,
        ...(response.nextToken ? { nextToken: response.nextToken } : {}),
      },
    }
  })
}

export async function executeCodepipelineListPipelines(
  input: AwsCodepipelineListPipelinesBody,
  signal?: AbortSignal
) {
  return withCodePipelineClient(input, async (client) => {
    const response = await client.send(
      new ListPipelinesCommand({
        ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
        ...(input.nextToken ? { nextToken: input.nextToken } : {}),
      }),
      { abortSignal: signal }
    )
    const pipelines = (response.pipelines ?? []).map((pipeline) => ({
      name: pipeline.name ?? '',
      version: pipeline.version,
      pipelineType: pipeline.pipelineType,
      executionMode: pipeline.executionMode,
      created: pipeline.created?.getTime(),
      updated: pipeline.updated?.getTime(),
    }))
    return {
      success: true,
      output: {
        pipelines,
        ...(response.nextToken ? { nextToken: response.nextToken } : {}),
      },
    }
  })
}

export async function executeCodepipelinePutApprovalResult(
  input: AwsCodepipelinePutApprovalResultBody,
  signal?: AbortSignal
) {
  return withCodePipelineClient(input, async (client) => {
    const response = await client.send(
      new PutApprovalResultCommand({
        pipelineName: input.pipelineName,
        stageName: input.stageName,
        actionName: input.actionName,
        token: input.token,
        result: { status: input.status as ApprovalStatus, summary: input.summary },
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: { approvedAt: response.approvedAt?.getTime(), status: input.status },
    }
  })
}

export async function executeCodepipelineRetryStageExecution(
  input: AwsCodepipelineRetryStageExecutionBody,
  signal?: AbortSignal
) {
  return withCodePipelineClient(input, async (client) => {
    const response = await client.send(
      new RetryStageExecutionCommand({
        pipelineName: input.pipelineName,
        stageName: input.stageName,
        pipelineExecutionId: input.pipelineExecutionId,
        retryMode: input.retryMode as StageRetryMode,
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: { pipelineExecutionId: response.pipelineExecutionId ?? input.pipelineExecutionId },
    }
  })
}

export async function executeCodepipelineStartExecution(
  input: AwsCodepipelineStartExecutionBody,
  signal?: AbortSignal
) {
  return withCodePipelineClient(input, async (client) => {
    const response = await client.send(
      new StartPipelineExecutionCommand({
        name: input.pipelineName,
        ...(input.clientRequestToken ? { clientRequestToken: input.clientRequestToken } : {}),
        ...(input.variables && input.variables.length > 0 ? { variables: input.variables } : {}),
      }),
      { abortSignal: signal }
    )
    if (!response.pipelineExecutionId) throw new Error('No pipeline execution ID returned')
    return { success: true, output: { pipelineExecutionId: response.pipelineExecutionId } }
  })
}

export async function executeCodepipelineStopExecution(
  input: AwsCodepipelineStopExecutionBody,
  signal?: AbortSignal
) {
  return withCodePipelineClient(input, async (client) => {
    const response = await client.send(
      new StopPipelineExecutionCommand({
        pipelineName: input.pipelineName,
        pipelineExecutionId: input.pipelineExecutionId,
        ...(input.abandon !== undefined ? { abandon: input.abandon } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      success: true,
      output: { pipelineExecutionId: response.pipelineExecutionId ?? input.pipelineExecutionId },
    }
  })
}
