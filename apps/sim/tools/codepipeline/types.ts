import type { ToolResponse } from '@/tools/types'

interface CodePipelineConnectionConfig {
  awsRegion: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
}

export interface CodePipelineListPipelinesParams extends CodePipelineConnectionConfig {
  maxResults?: number
  nextToken?: string
}

export interface CodePipelineListPipelinesResponse extends ToolResponse {
  output: {
    pipelines: {
      name: string
      version: number | undefined
      pipelineType: string | undefined
      executionMode: string | undefined
      created: number | undefined
      updated: number | undefined
    }[]
    nextToken?: string
  }
}

export interface CodePipelineGetPipelineStateParams extends CodePipelineConnectionConfig {
  pipelineName: string
}

export interface CodePipelineActionState {
  actionName: string
  status: string | undefined
  summary: string | undefined
  lastStatusChange: number | undefined
  externalExecutionId: string | undefined
  externalExecutionUrl: string | undefined
  errorCode: string | undefined
  errorMessage: string | undefined
  percentComplete: number | undefined
  token: string | undefined
  revisionId: string | undefined
  entityUrl: string | undefined
}

export interface CodePipelineStageState {
  stageName: string
  status: string | undefined
  pipelineExecutionId: string | undefined
  inboundTransitionEnabled: boolean | undefined
  actionStates: CodePipelineActionState[]
}

export interface CodePipelineGetPipelineStateResponse extends ToolResponse {
  output: {
    pipelineName: string
    pipelineVersion: number | undefined
    created: number | undefined
    updated: number | undefined
    stageStates: CodePipelineStageState[]
  }
}

export interface CodePipelineGetPipelineExecutionParams extends CodePipelineConnectionConfig {
  pipelineName: string
  pipelineExecutionId: string
}

export interface CodePipelineGetPipelineExecutionResponse extends ToolResponse {
  output: {
    pipelineExecutionId: string
    pipelineName: string
    pipelineVersion: number | undefined
    status: string
    statusSummary: string | undefined
    executionMode: string | undefined
    executionType: string | undefined
    triggerType: string | undefined
    triggerDetail: string | undefined
    artifactRevisions: {
      name: string
      revisionId: string | undefined
      revisionSummary: string | undefined
      revisionUrl: string | undefined
      created: number | undefined
    }[]
    variables: {
      name: string
      resolvedValue: string
    }[]
  }
}

export interface CodePipelineListPipelineExecutionsParams extends CodePipelineConnectionConfig {
  pipelineName: string
  maxResults?: number
  nextToken?: string
  succeededInStage?: string
}

export interface CodePipelineListPipelineExecutionsResponse extends ToolResponse {
  output: {
    executions: {
      pipelineExecutionId: string
      status: string
      statusSummary: string | undefined
      startTime: number | undefined
      lastUpdateTime: number | undefined
      executionMode: string | undefined
      executionType: string | undefined
      stopTriggerReason: string | undefined
      triggerType: string | undefined
      triggerDetail: string | undefined
      sourceRevisions: {
        actionName: string
        revisionId: string | undefined
        revisionSummary: string | undefined
        revisionUrl: string | undefined
      }[]
    }[]
    nextToken?: string
  }
}

export interface CodePipelineStartExecutionParams extends CodePipelineConnectionConfig {
  pipelineName: string
  clientRequestToken?: string
  variables?: { name: string; value: string }[]
}

export interface CodePipelineStartExecutionResponse extends ToolResponse {
  output: {
    pipelineExecutionId: string
  }
}

export interface CodePipelineStopExecutionParams extends CodePipelineConnectionConfig {
  pipelineName: string
  pipelineExecutionId: string
  abandon?: boolean
  reason?: string
}

export interface CodePipelineStopExecutionResponse extends ToolResponse {
  output: {
    pipelineExecutionId: string
  }
}

export type CodePipelineRetryMode = 'FAILED_ACTIONS' | 'ALL_ACTIONS'

export interface CodePipelineRetryStageExecutionParams extends CodePipelineConnectionConfig {
  pipelineName: string
  stageName: string
  pipelineExecutionId: string
  retryMode: CodePipelineRetryMode
}

export interface CodePipelineRetryStageExecutionResponse extends ToolResponse {
  output: {
    pipelineExecutionId: string
  }
}

export type CodePipelineApprovalStatus = 'Approved' | 'Rejected'

export interface CodePipelinePutApprovalResultParams extends CodePipelineConnectionConfig {
  pipelineName: string
  stageName: string
  actionName: string
  token: string
  status: CodePipelineApprovalStatus
  summary: string
}

export interface CodePipelinePutApprovalResultResponse extends ToolResponse {
  output: {
    approvedAt: number | undefined
    status: string
  }
}
