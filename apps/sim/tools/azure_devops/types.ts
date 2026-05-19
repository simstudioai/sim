import type { ToolResponse } from '@/tools/types'

export interface AzureDevOpsBaseParams {
  /** Azure DevOps organization name */
  organization: string
  /** Azure DevOps project name */
  project: string
  /** Personal Access Token */
  accessToken: string
}

// ── List Pipelines ──────────────────────────────────────────────────────────

export interface ListPipelinesParams extends AzureDevOpsBaseParams {
  orderBy?: string
  top?: number
  continuationToken?: string
}

export interface AzureDevOpsPipeline {
  id: number
  name: string
  folder: string
  revision: number
  url: string
}

export interface ListPipelinesResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      count: number
      pipelines: AzureDevOpsPipeline[]
    }
  }
}

// ── Get Pipeline ────────────────────────────────────────────────────────────

export interface GetPipelineParams extends AzureDevOpsBaseParams {
  pipelineId: number
  pipelineVersion?: number
}

export interface AzureDevOpsPipelineConfiguration {
  type: string
  path?: string
  repository?: {
    id: string
    type: string
  }
}

export interface AzureDevOpsPipelineDetail extends AzureDevOpsPipeline {
  configuration: AzureDevOpsPipelineConfiguration
  links: {
    self: string
    web: string
  }
}

export interface GetPipelineResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      pipeline: AzureDevOpsPipelineDetail
    }
  }
}

// ── List Pipeline Runs ──────────────────────────────────────────────────────

export interface ListPipelineRunsParams extends AzureDevOpsBaseParams {
  pipelineId: number
}

export interface AzureDevOpsPipelineRun {
  id: number
  name: string
  state: string
  result?: string
  createdDate: string
  finishedDate?: string
  url: string
  webUrl: string
}

export interface ListPipelineRunsResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      count: number
      runs: AzureDevOpsPipelineRun[]
    }
  }
}

// ── Get Pipeline Run ────────────────────────────────────────────────────────

export interface GetPipelineRunParams extends AzureDevOpsBaseParams {
  pipelineId: number
  runId: number
}

export interface AzureDevOpsPipelineRunDetail extends AzureDevOpsPipelineRun {
  pipeline: {
    id: number
    name: string
    folder: string
    revision: number
    url: string
  }
}

export interface GetPipelineRunResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      run: AzureDevOpsPipelineRunDetail
    }
  }
}

// ── List Builds ─────────────────────────────────────────────────────────────

export interface ListBuildsParams extends AzureDevOpsBaseParams {
  definitionIds?: string
  top?: number
  statusFilter?: string
  resultFilter?: string
  branchName?: string
}

export interface AzureDevOpsBuild {
  id: number
  buildNumber: string
  status: string
  result?: string
  queueTime: string
  startTime?: string
  finishTime?: string
  sourceBranch: string
  sourceVersion: string
  definition: {
    id: number
    name: string
  }
  webUrl: string
}

export interface ListBuildsResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      count: number
      builds: AzureDevOpsBuild[]
    }
  }
}

// ── List Build Logs ─────────────────────────────────────────────────────────

export interface ListBuildLogsParams extends AzureDevOpsBaseParams {
  buildId: number
}

export interface AzureDevOpsBuildLog {
  id: number
  type: string
  url: string
  lineCount: number
  createdOn?: string
  lastChangedOn?: string
}

export interface ListBuildLogsResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      count: number
      logs: AzureDevOpsBuildLog[]
    }
  }
}

// ── Get Build Log ────────────────────────────────────────────────────────────

export interface GetBuildLogParams extends AzureDevOpsBaseParams {
  buildId: number
  logId: number
  startLine?: number
  endLine?: number
}

export interface GetBuildLogResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      lineCount: number
    }
  }
}

// ── Get Build Timeline ────────────────────────────────────────────────────────

export interface GetBuildTimelineParams extends AzureDevOpsBaseParams {
  buildId: number
}

export interface AzureDevOpsBuildTimelineRecord {
  id: string
  name: string
  type: string
  result: string | null
  logId: number | null
  errorCount: number
  warningCount: number
  startTime: string
  finishTime: string
}

export interface GetBuildTimelineResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      totalCount: number
      failedCount: number
      records: AzureDevOpsBuildTimelineRecord[]
      failedRecords: AzureDevOpsBuildTimelineRecord[]
    }
  }
}

// ── Get Work Items Between Builds ────────────────────────────────────────────

export interface GetWorkItemsBetweenBuildsParams extends AzureDevOpsBaseParams {
  fromBuildId: number
  toBuildId: number
}

export interface AzureDevOpsWorkItemRef {
  id: string
  url: string
}

export interface GetWorkItemsBetweenBuildsResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      count: number
      workItems: AzureDevOpsWorkItemRef[]
    }
  }
}

// ── Query Work Items ─────────────────────────────────────────────────────────

export interface QueryWorkItemsParams extends AzureDevOpsBaseParams {
  wiqlQuery: string
}

export interface AzureDevOpsWorkItem {
  id: number
  title: string
  state: string
  workItemType: string
  assignedTo: string | null
  areaPath: string
  url: string
}

export interface QueryWorkItemsResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      count: number
      totalMatched?: number
      workItems: AzureDevOpsWorkItem[]
    }
  }
}

// ── Get Work Item ─────────────────────────────────────────────────────────────

export interface GetWorkItemParams extends AzureDevOpsBaseParams {
  workItemId: number
}

export interface GetWorkItemResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      workItem: AzureDevOpsWorkItem
    }
  }
}

// ── Get Work Items Batch ───────────────────────────────────────────────────────

export interface GetWorkItemsBatchParams extends AzureDevOpsBaseParams {
  ids: string
}

export interface GetWorkItemsBatchResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      count: number
      totalRequested?: number
      workItems: AzureDevOpsWorkItem[]
    }
  }
}

// ── Create Work Item ───────────────────────────────────────────────────────────

export type AzureDevOpsBasicWorkItemType = 'Issue' | 'Task' | 'Epic'

export interface CreateWorkItemParams extends AzureDevOpsBaseParams {
  workItemType: AzureDevOpsBasicWorkItemType
  title: string
  description?: string
  assignedTo?: string
  priority?: number
  /** Microsoft.VSTS.Scheduling.Effort — Issue only in the Basic process. */
  effort?: number
  /** Microsoft.VSTS.Scheduling.StartDate — Epic only in the Basic process. ISO 8601. */
  startDate?: string
  /** Microsoft.VSTS.Scheduling.TargetDate — Epic only in the Basic process. ISO 8601. */
  targetDate?: string
  /** Microsoft.VSTS.Common.Activity — Task only in the Basic process. */
  activity?: string
  /** Microsoft.VSTS.Scheduling.RemainingWork — Task only in the Basic process. */
  remainingWork?: number
  /** Microsoft.VSTS.Scheduling.CompletedWork — Task only in the Basic process. */
  completedWork?: number
  areaPath?: string
  iterationPath?: string
  tags?: string
}

export interface CreateWorkItemResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      workItem: AzureDevOpsWorkItem
    }
  }
}

// ── Update Work Item ───────────────────────────────────────────────────────────

export interface UpdateWorkItemParams extends AzureDevOpsBaseParams {
  workItemId: number
  title?: string
  description?: string
  assignedTo?: string
  priority?: number
  /** Microsoft.VSTS.Scheduling.Effort — Issue only in the Basic process. */
  effort?: number
  /** Microsoft.VSTS.Scheduling.StartDate — Epic only in the Basic process. ISO 8601. */
  startDate?: string
  /** Microsoft.VSTS.Scheduling.TargetDate — Epic only in the Basic process. ISO 8601. */
  targetDate?: string
  /** Microsoft.VSTS.Common.Activity — Task only in the Basic process. */
  activity?: string
  /** Microsoft.VSTS.Scheduling.RemainingWork — Task only in the Basic process. */
  remainingWork?: number
  /** Microsoft.VSTS.Scheduling.CompletedWork — Task only in the Basic process. */
  completedWork?: number
  areaPath?: string
  state?: string
  tags?: string
}

export interface UpdateWorkItemResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      workItem: AzureDevOpsWorkItem
    }
  }
}

// ── Add Comment ────────────────────────────────────────────────────────────────

export interface AddCommentParams extends AzureDevOpsBaseParams {
  workItemId: number
  text: string
}

export interface AzureDevOpsComment {
  workItemId: number
  commentId: number
  version: number
  text: string
  renderedText?: string
  createdBy: string | null
  createdDate: string
  modifiedBy: string | null
  modifiedDate: string
  isDeleted: boolean
  url: string
}

export interface AddCommentResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      comment: AzureDevOpsComment
    }
  }
}

// ── Response Union ────────────────────────────────────────────────────────────

export type AzureDevOpsResponse =
  | ListPipelinesResponse
  | GetPipelineResponse
  | ListPipelineRunsResponse
  | GetPipelineRunResponse
  | ListBuildsResponse
  | ListBuildLogsResponse
  | GetBuildLogResponse
  | GetBuildTimelineResponse
  | GetWorkItemsBetweenBuildsResponse
  | QueryWorkItemsResponse
  | GetWorkItemResponse
  | GetWorkItemsBatchResponse
  | CreateWorkItemResponse
  | UpdateWorkItemResponse
  | AddCommentResponse
  | GetCommentsResponse

// ── Get Comments ──────────────────────────────────────────────────────────────

export interface GetCommentsParams extends AzureDevOpsBaseParams {
  workItemId: number
  top?: number
  continuationToken?: string
  includeDeleted?: boolean
  expand?: string
  order?: string
}

export interface GetCommentsResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      count: number
      totalCount: number
      comments: AzureDevOpsComment[]
      continuationToken?: string
      nextPage?: string
      url?: string
    }
  }
}
