import type { ToolFileData, ToolResponse } from '@/tools/types'

/** Base parameters shared by all Databricks tools */
export interface DatabricksBaseParams {
  apiKey: string
  host: string
}

/** Execute SQL Statement */
export interface DatabricksExecuteSqlParams extends DatabricksBaseParams {
  warehouseId: string
  statement: string
  catalog?: string
  schema?: string
  rowLimit?: number
  waitTimeout?: string
}

export interface DatabricksExecuteSqlResponse extends ToolResponse {
  output: {
    statementId: string
    status: string
    columns: Array<{ name: string; position: number; typeName: string }> | null
    data: string[][] | null
    totalRows: number | null
    truncated: boolean
  }
}

/** Get Statement (poll an async SQL statement by its ID) */
export interface DatabricksGetStatementParams extends DatabricksBaseParams {
  statementId: string
}

/** List Jobs */
export interface DatabricksListJobsParams extends DatabricksBaseParams {
  limit?: number
  offset?: number
  name?: string
  expandTasks?: boolean
}

export interface DatabricksListJobsResponse extends ToolResponse {
  output: {
    jobs: Array<{
      jobId: number
      name: string
      createdTime: number
      creatorUserName: string
      maxConcurrentRuns: number
      format: string
    }>
    hasMore: boolean
    nextPageToken: string | null
  }
}

/** Run Job */
export interface DatabricksRunJobParams extends DatabricksBaseParams {
  jobId: number
  jobParameters?: string
  notebookParams?: string
  idempotencyToken?: string
}

export interface DatabricksRunJobResponse extends ToolResponse {
  output: {
    runId: number
    numberInJob: number
  }
}

/** Get Job */
export interface DatabricksGetJobParams extends DatabricksBaseParams {
  jobId: number
}

export interface DatabricksGetJobResponse extends ToolResponse {
  output: {
    jobId: number
    name: string
    creatorUserName: string
    runAsUserName: string
    createdTime: number
    format: string
    maxConcurrentRuns: number
    timeoutSeconds: number | null
    schedule: Record<string, unknown> | null
    tags: Record<string, unknown> | null
    tasks: Array<Record<string, unknown>>
  }
}

/** Get Run */
export interface DatabricksGetRunParams extends DatabricksBaseParams {
  runId: number
  includeHistory?: boolean
  includeResolvedValues?: boolean
}

export interface DatabricksGetRunResponse extends ToolResponse {
  output: {
    runId: number
    jobId: number
    runName: string
    runType: string
    attemptNumber: number
    state: {
      lifeCycleState: string
      resultState: string | null
      stateMessage: string
      userCancelledOrTimedout: boolean
    }
    startTime: number | null
    endTime: number | null
    setupDuration: number | null
    executionDuration: number | null
    cleanupDuration: number | null
    queueDuration: number | null
    runPageUrl: string
    creatorUserName: string
  }
}

/** List Runs */
export interface DatabricksListRunsParams extends DatabricksBaseParams {
  jobId?: number
  activeOnly?: boolean
  completedOnly?: boolean
  limit?: number
  offset?: number
  runType?: string
  startTimeFrom?: number
  startTimeTo?: number
}

export interface DatabricksListRunsResponse extends ToolResponse {
  output: {
    runs: Array<{
      runId: number
      jobId: number
      runName: string
      runType: string
      state: {
        lifeCycleState: string
        resultState: string | null
        stateMessage: string
        userCancelledOrTimedout: boolean
      }
      startTime: number | null
      endTime: number | null
    }>
    hasMore: boolean
    nextPageToken: string | null
  }
}

/** Cancel Run */
export interface DatabricksCancelRunParams extends DatabricksBaseParams {
  runId: number
}

export interface DatabricksCancelRunResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/** Get Run Output */
export interface DatabricksGetRunOutputParams extends DatabricksBaseParams {
  runId: number
}

export interface DatabricksGetRunOutputResponse extends ToolResponse {
  output: {
    notebookOutput: {
      result: string | null
      truncated: boolean
    } | null
    error: string | null
    errorTrace: string | null
    logs: string | null
    logsTruncated: boolean
  }
}

/** Shared cluster shape returned by list_clusters and get_cluster */
export interface DatabricksCluster {
  clusterId: string
  clusterName: string
  state: string
  stateMessage: string
  creatorUserName: string
  sparkVersion: string
  nodeTypeId: string
  driverNodeTypeId: string
  numWorkers: number | null
  autoscale: { minWorkers: number; maxWorkers: number } | null
  clusterSource: string
  autoterminationMinutes: number
  startTime: number | null
}

/** List Clusters */
export interface DatabricksListClustersResponse extends ToolResponse {
  output: {
    clusters: DatabricksCluster[]
  }
}

/** Get Cluster */
export interface DatabricksGetClusterParams extends DatabricksBaseParams {
  clusterId: string
}

export interface DatabricksGetClusterResponse extends ToolResponse {
  output: {
    cluster: DatabricksCluster
  }
}

/** List Warehouses */
export interface DatabricksListWarehousesResponse extends ToolResponse {
  output: {
    warehouses: Array<{
      warehouseId: string
      name: string
      clusterSize: string
      state: string
      warehouseType: string
      creatorName: string
      autoStopMinutes: number
      numClusters: number
      minNumClusters: number
      maxNumClusters: number
      numActiveSessions: number
      enableServerlessCompute: boolean
    }>
  }
}

/** Genie: a message flattened into its answer, generated SQL, and follow-ups */
export interface DatabricksGenieMessage {
  conversationId: string
  messageId: string
  status: string
  content: string
  answer: string | null
  followUpQuestion: string | null
  queryTitle: string | null
  sql: string | null
  queryDescription: string | null
  queryAttachmentId: string | null
  statementId: string | null
  rowCount: number | null
  thoughts: Array<{ type: string | null; content: string }>
  suggestedQuestions: string[]
  visualizations: Array<{
    attachmentId: string
    title: string | null
    queryAttachmentId: string | null
  }>
  error: string | null
  errorType: string | null
  createdTimestamp: number | null
}

/** Genie: the SQL result of a query attachment */
export interface DatabricksStatementResult {
  statementId: string
  status: string
  columns: Array<{ name: string; position: number; typeName: string }> | null
  data: Array<Array<string | null>> | null
  totalRows: number | null
  truncated: boolean
}

/** Genie: a space (Genie agent) */
export interface DatabricksGenieSpace {
  spaceId: string
  title: string
  description: string | null
  warehouseId: string | null
  parentPath: string | null
  createTime: string | null
  updateTime: string | null
}

interface DatabricksGenieSpaceParams extends DatabricksBaseParams {
  spaceId: string
}

/** Genie: parameters addressing one message in a conversation */
export interface DatabricksGenieMessageParams extends DatabricksGenieSpaceParams {
  conversationId: string
  messageId: string
}

/** Genie: parameters addressing one attachment on a message */
export interface DatabricksGenieAttachmentParams extends DatabricksGenieMessageParams {
  attachmentId: string
}

/** Genie Ask (start or continue a chat-mode conversation and wait for the answer) */
export interface DatabricksGenieAskParams extends DatabricksGenieSpaceParams {
  content: string
  conversationId?: string
  enableVisualization?: boolean
}

export interface DatabricksGenieAskResponse extends ToolResponse {
  output: DatabricksGenieMessage & {
    columns: DatabricksStatementResult['columns']
    data: DatabricksStatementResult['data']
    totalRows: number | null
    truncated: boolean | null
  }
}

export interface DatabricksGenieGetMessageResponse extends ToolResponse {
  output: DatabricksGenieMessage
}

/** Genie List Messages */
export interface DatabricksGenieListMessagesParams extends DatabricksGenieSpaceParams {
  conversationId: string
  pageSize?: number
  pageToken?: string
}

export interface DatabricksGenieListMessagesResponse extends ToolResponse {
  output: {
    messages: DatabricksGenieMessage[]
    nextPageToken: string | null
  }
}

/** Genie Get Query Result / Execute Query */
export interface DatabricksGenieQueryResultResponse extends ToolResponse {
  output: DatabricksStatementResult
}

/** Genie Download Visualization */
export interface DatabricksGenieDownloadVisualizationResponse extends ToolResponse {
  output: {
    file: ToolFileData
  }
}

/** Genie Send Feedback */
export interface DatabricksGenieSendFeedbackParams extends DatabricksGenieMessageParams {
  rating: 'POSITIVE' | 'NEGATIVE' | 'NONE'
  comment?: string
}

/** Genie List Conversations */
export interface DatabricksGenieListConversationsParams extends DatabricksGenieSpaceParams {
  includeAll?: boolean
  pageSize?: number
  pageToken?: string
}

export interface DatabricksGenieListConversationsResponse extends ToolResponse {
  output: {
    conversations: Array<{
      conversationId: string
      title: string | null
      createdTimestamp: number | null
      agentType: string | null
    }>
    nextPageToken: string | null
  }
}

/** Genie Delete Conversation */
export interface DatabricksGenieDeleteConversationParams extends DatabricksGenieSpaceParams {
  conversationId: string
}

/** Genie mutations with an empty response body (feedback, deletes) */
export interface DatabricksGenieSuccessResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

/** Genie List Spaces */
export interface DatabricksGenieListSpacesParams extends DatabricksBaseParams {
  pageSize?: number
  pageToken?: string
}

export interface DatabricksGenieListSpacesResponse extends ToolResponse {
  output: {
    spaces: DatabricksGenieSpace[]
    nextPageToken: string | null
  }
}

/** Genie Get Space */
export interface DatabricksGenieGetSpaceParams extends DatabricksGenieSpaceParams {
  includeSerializedSpace?: boolean
}

export interface DatabricksGenieGetSpaceResponse extends ToolResponse {
  output: DatabricksGenieSpace & {
    serializedSpace: string | null
  }
}

/** Genie agent mode: one item in a response or conversation */
export interface DatabricksGenieAgentItem {
  type: string
  id: string
  status: string | null
  role: string | null
  text: string | null
  callId: string | null
  name: string | null
  arguments: string | null
  output: string | null
}

/** Genie agent mode: Ask Agent */
export interface DatabricksGenieAgentAskParams extends DatabricksGenieSpaceParams {
  content: string
  conversationId?: string
  enableVisualization?: boolean
}

export interface DatabricksGenieAgentAskResponse extends ToolResponse {
  output: {
    responseId: string
    conversationId: string
    status: string
    report: string | null
    queries: Array<{ callId: string; title: string | null; sql: string | null }>
    items: DatabricksGenieAgentItem[]
    createdAt: number | null
    error: string | null
  }
}

/** Genie agent mode: List Conversation Items */
export interface DatabricksGenieAgentListItemsParams extends DatabricksGenieSpaceParams {
  conversationId: string
  limit?: number
  after?: string
  order?: 'asc' | 'desc'
}

export interface DatabricksGenieAgentListItemsResponse extends ToolResponse {
  output: {
    items: DatabricksGenieAgentItem[]
    firstId: string | null
    lastId: string | null
    hasMore: boolean
    status: string | null
  }
}

/** Union type for all Databricks responses */
export type DatabricksResponse =
  | DatabricksExecuteSqlResponse
  | DatabricksListJobsResponse
  | DatabricksRunJobResponse
  | DatabricksGetJobResponse
  | DatabricksGetRunResponse
  | DatabricksListRunsResponse
  | DatabricksCancelRunResponse
  | DatabricksGetRunOutputResponse
  | DatabricksListClustersResponse
  | DatabricksGetClusterResponse
  | DatabricksListWarehousesResponse
  | DatabricksGenieAskResponse
  | DatabricksGenieGetMessageResponse
  | DatabricksGenieListMessagesResponse
  | DatabricksGenieQueryResultResponse
  | DatabricksGenieDownloadVisualizationResponse
  | DatabricksGenieListConversationsResponse
  | DatabricksGenieSuccessResponse
  | DatabricksGenieListSpacesResponse
  | DatabricksGenieGetSpaceResponse
  | DatabricksGenieAgentAskResponse
  | DatabricksGenieAgentListItemsResponse
