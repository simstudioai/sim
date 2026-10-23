import type { OutputProperty, ToolFileData, ToolResponse } from '@/tools/types'

/** Base parameters shared by all Databricks tools */
interface DatabricksBaseParams {
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
  sqlParameters?: string | unknown[]
  byteLimit?: number
  onWaitTimeout?: 'CONTINUE' | 'CANCEL'
}

export interface DatabricksExecuteSqlResponse extends ToolResponse {
  output: DatabricksStatementResult
}

/** Get Statement (poll an async SQL statement by its ID) */
export interface DatabricksGetStatementParams extends DatabricksBaseParams {
  statementId: string
  warehouseId?: string
}

/** List Jobs */
export interface DatabricksListJobsParams extends DatabricksBaseParams {
  limit?: number
  offset?: number
  name?: string
  expandTasks?: boolean
  pageToken?: string
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
      tasks: Array<Record<string, unknown>>
      jobClusters: Array<Record<string, unknown>>
      hasMore: boolean
    }>
    hasMore: boolean
    nextPageToken: string | null
    prevPageToken: string | null
  }
}

/** Run Job */
export interface DatabricksRunJobParams extends DatabricksBaseParams {
  jobId: number
  jobParameters?: string | Record<string, unknown>
  notebookParams?: string | Record<string, unknown>
  idempotencyToken?: string
  only?: string | unknown[]
  queue?: string | Record<string, unknown>
  performanceTarget?: 'STANDARD' | 'PERFORMANCE_OPTIMIZED'
  pipelineParams?: string | Record<string, unknown>
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
  pageToken?: string
  includeTriggerState?: boolean
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
    description: string | null
    jobClusters: Array<Record<string, unknown>>
    parameters: Array<Record<string, unknown>>
    queue: Record<string, unknown> | null
    triggerState: Record<string, unknown> | null
    nextPageToken: string | null
  }
}

/** Get Run */
export interface DatabricksGetRunParams extends DatabricksBaseParams {
  runId: number
  includeHistory?: boolean
  includeResolvedValues?: boolean
  pageToken?: string
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
    tasks: Array<Record<string, unknown>>
    repairHistory: Array<Record<string, unknown>>
    jobParameters: Array<Record<string, unknown>>
    jobClusters: Array<Record<string, unknown>>
    runStatus: Record<string, unknown> | null
    runDuration: number | null
    nextPageToken: string | null
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
  pageToken?: string
  expandTasks?: boolean
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
      tasks: Array<Record<string, unknown>>
      jobClusters: Array<Record<string, unknown>>
      runPageUrl: string | null
      runStatus: Record<string, unknown> | null
      hasMore: boolean
    }>
    hasMore: boolean
    nextPageToken: string | null
    prevPageToken: string | null
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
    sqlOutput: Record<string, unknown> | null
    dbtOutput: Record<string, unknown> | null
    runJobOutput: { run_id?: number } | null
    info: string | null
  }
}

/** Shared cluster shape returned by list_clusters and get_cluster */
interface DatabricksCluster {
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
  policyId: string | null
  dataSecurityMode: string | null
  terminatedTime: number | null
  customTags: Record<string, string> | null
  terminationReason: Record<string, unknown> | null
}

export interface DatabricksListClustersParams extends DatabricksBaseParams {
  pageSize?: number
  pageToken?: string
}

/** List Clusters */
export interface DatabricksListClustersResponse extends ToolResponse {
  output: {
    clusters: DatabricksCluster[]
    nextPageToken: string | null
    prevPageToken: string | null
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

export interface DatabricksListWarehousesParams extends DatabricksBaseParams {
  pageSize?: number
  pageToken?: string
}

/** List Warehouses */
export interface DatabricksListWarehousesResponse extends ToolResponse {
  output: {
    warehouses: Array<{
      jdbcUrl: string | null
      odbcParams: Record<string, unknown> | null
      health: Record<string, unknown> | null
      tags: Record<string, unknown> | null
      enablePhoton: boolean | null
      spotInstancePolicy: string | null
      channel: Record<string, unknown> | null
      statementTimeout: number | null
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
    nextPageToken: string | null
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
  totalChunks: number | null
  chunkIndex: number | null
  rowOffset: number | null
  rowCount: number | null
  nextChunkIndex: number | null
  nextChunkInternalLink: string | null
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
  etag: string | null
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
  output: DatabricksGenieMessage &
    Omit<DatabricksStatementResult, 'statementId' | 'status' | 'rowCount' | 'truncated'> & {
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

export const GENIE_SPACE_OUTPUT_PROPERTIES = {
  etag: { type: 'string', nullable: true, description: 'Space version for conditional updates' },
  spaceId: { type: 'string', description: 'Genie space ID' },
  title: { type: 'string', description: 'Space title' },
  description: { type: 'string', description: 'Space description', nullable: true },
  warehouseId: {
    type: 'string',
    description: 'SQL warehouse the space runs queries on',
    nullable: true,
  },
  parentPath: {
    type: 'string',
    description: 'Workspace folder containing the space',
    nullable: true,
  },
  createTime: {
    type: 'string',
    description: 'When the space was created (ISO 8601)',
    nullable: true,
  },
  updateTime: {
    type: 'string',
    description: 'When the space was last modified (ISO 8601)',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const GENIE_MESSAGE_OUTPUT_PROPERTIES = {
  conversationId: { type: 'string', description: 'Genie conversation ID' },
  messageId: { type: 'string', description: 'Genie message ID' },
  status: {
    type: 'string',
    description:
      'Message status (SUBMITTED, FETCHING_METADATA, FILTERING_CONTEXT, ASKING_AI, PENDING_WAREHOUSE, EXECUTING_QUERY, COMPLETED, FAILED, CANCELLED, QUERY_RESULT_EXPIRED)',
  },
  content: { type: 'string', description: 'The question that was asked' },
  answer: {
    type: 'string',
    description: "Genie's text answer or summary",
    nullable: true,
  },
  followUpQuestion: {
    type: 'string',
    description: 'Clarifying question Genie asked instead of, or alongside, an answer',
    nullable: true,
  },
  queryTitle: {
    type: 'string',
    description: 'Title of the generated query',
    nullable: true,
  },
  sql: { type: 'string', description: 'SQL query Genie generated', nullable: true },
  queryDescription: {
    type: 'string',
    description: 'Plain-language description of the generated SQL',
    nullable: true,
  },
  queryAttachmentId: {
    type: 'string',
    description: 'Attachment ID of the generated query, used to fetch or re-run its result',
    nullable: true,
  },
  statementId: {
    type: 'string',
    description: 'SQL statement ID of the generated query',
    nullable: true,
  },
  rowCount: {
    type: 'number',
    description: 'Number of rows the generated query returned',
    nullable: true,
  },
  thoughts: {
    type: 'array',
    description: 'How Genie interpreted the question and built the SQL (Public Preview)',
    items: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            'Thought category (THOUGHT_TYPE_DESCRIPTION, THOUGHT_TYPE_UNDERSTANDING, THOUGHT_TYPE_DATA_SOURCING, THOUGHT_TYPE_INSTRUCTIONS, THOUGHT_TYPE_STEPS)',
          nullable: true,
        },
        content: { type: 'string', description: 'Markdown-formatted thought' },
      },
    },
  },
  suggestedQuestions: {
    type: 'array',
    description: 'Follow-up questions suggested by Genie',
    items: { type: 'string', description: 'Suggested question' },
  },
  visualizations: {
    type: 'array',
    description: 'Charts Genie generated (only when visualization was requested)',
    items: {
      type: 'object',
      properties: {
        attachmentId: {
          type: 'string',
          description: 'Visualization attachment ID, used to download the chart',
        },
        title: { type: 'string', description: 'Chart title', nullable: true },
        queryAttachmentId: {
          type: 'string',
          description: 'Query attachment the chart was built from',
          nullable: true,
        },
      },
    },
  },
  error: {
    type: 'string',
    description: 'Why Genie failed to answer',
    nullable: true,
  },
  errorType: { type: 'string', description: 'Genie error type', nullable: true },
  createdTimestamp: {
    type: 'number',
    description: 'When the message was created',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const STATEMENT_RESULT_OUTPUT_PROPERTIES = {
  totalChunks: { type: 'number', nullable: true, description: 'Number of result chunks' },
  chunkIndex: { type: 'number', nullable: true, description: 'Index of this result chunk' },
  rowOffset: { type: 'number', nullable: true, description: 'Starting row offset of this chunk' },
  rowCount: { type: 'number', nullable: true, description: 'Number of rows in this chunk' },
  nextChunkIndex: {
    type: 'number',
    nullable: true,
    description: 'Next chunk to retrieve with Get Statement Chunk; null on the final chunk',
  },
  nextChunkInternalLink: {
    type: 'string',
    nullable: true,
    description: 'Workspace-relative path to the next result chunk',
  },

  columns: {
    type: 'array',
    description: 'Column schema of the query result',
    nullable: true,
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Column name' },
        position: { type: 'number', description: 'Column position (0-based)' },
        typeName: {
          type: 'string',
          description:
            'Column type (STRING, INT, LONG, DOUBLE, BOOLEAN, TIMESTAMP, DATE, DECIMAL, etc.)',
        },
      },
    },
  },
  data: {
    type: 'array',
    description:
      'Result rows as a 2D array; each non-null value is a string and null values stay null',
    nullable: true,
    items: { type: 'array', description: 'A single row of column values' },
  },
  totalRows: {
    type: 'number',
    description: 'Total number of rows in the result',
    nullable: true,
  },
  truncated: {
    type: 'boolean',
    description: 'Whether the result set was truncated',
  },
} as const satisfies Record<string, OutputProperty>

export const GENIE_QUERY_RESULT_OUTPUTS = {
  statementId: { type: 'string', description: 'SQL statement ID of the query' },
  status: {
    type: 'string',
    description: 'Statement status (PENDING, RUNNING, SUCCEEDED, FAILED, CANCELED, CLOSED)',
  },
  ...STATEMENT_RESULT_OUTPUT_PROPERTIES,
} as const satisfies Record<string, OutputProperty>

export const GENIE_AGENT_ITEM_OUTPUT_PROPERTIES = {
  type: {
    type: 'string',
    description: 'Item type (message, reasoning, function_call, function_call_output)',
  },
  id: { type: 'string', description: 'Item ID' },
  status: { type: 'string', description: 'Item status', nullable: true },
  role: {
    type: 'string',
    description: 'Message role (user, assistant, or system) for message items',
    nullable: true,
  },
  text: {
    type: 'string',
    description: 'Text of a message or reasoning item',
    nullable: true,
  },
  callId: {
    type: 'string',
    description: 'Pairs a function_call with its function_call_output',
    nullable: true,
  },
  name: {
    type: 'string',
    description: 'Function name (execute_sql)',
    nullable: true,
  },
  arguments: {
    type: 'string',
    description: 'Function call arguments as a JSON string (title and sql)',
    nullable: true,
  },
  output: {
    type: 'string',
    description: 'Query result: the query title followed by a Markdown table',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface DatabricksSuccessResponse extends ToolResponse {
  output: { success: boolean }
}

export interface DatabricksCreateJobParams extends DatabricksBaseParams {
  accessControlList?: string | unknown[]
  name?: string
  description?: string
  emailNotifications?: string | Record<string, unknown>
  webhookNotifications?: string | Record<string, unknown>
  notificationSettings?: string | Record<string, unknown>
  timeoutSeconds?: number
  health?: string | Record<string, unknown>
  schedule?: string | Record<string, unknown>
  jobTrigger?: string | Record<string, unknown>
  continuous?: string | Record<string, unknown>
  maxConcurrentRuns?: number
  tasks?: string | unknown[]
  jobClusters?: string | unknown[]
  gitSource?: string | Record<string, unknown>
  tags?: string | Record<string, unknown>
  queue?: string | Record<string, unknown>
  parameters?: string | unknown[]
  runAs?: string | Record<string, unknown>
  editMode?: 'UI_LOCKED' | 'EDITABLE'
  deployment?: string | Record<string, unknown>
  environments?: string | unknown[]
  budgetPolicyId?: string
  performanceTarget?: 'PERFORMANCE_OPTIMIZED' | 'STANDARD'
  triggers?: string | unknown[]
  environmentVariables?: string | unknown[]
  maxRetries?: number
  minRetryIntervalMillis?: number
  retryOnTimeout?: boolean
  disableAutoOptimization?: boolean
}

export interface DatabricksCreateJobResponse extends ToolResponse {
  output: { jobId: number | null }
}

export interface DatabricksUpdateJobParams extends DatabricksBaseParams {
  jobId: number
  newSettings?: string | Record<string, unknown>
  fieldsToRemove?: string | unknown[]
}

export interface DatabricksResetJobParams extends DatabricksBaseParams {
  jobId: number
  newSettings: string | Record<string, unknown>
}

export interface DatabricksDeleteJobParams extends DatabricksBaseParams {
  jobId: number
}

export interface DatabricksSubmitRunParams extends DatabricksBaseParams {
  accessControlList?: string | unknown[]
  queue?: string | Record<string, unknown>
  runAs?: string | Record<string, unknown>
  runName?: string
  timeoutSeconds?: number
  health?: string | Record<string, unknown>
  idempotencyToken?: string
  tasks?: string | unknown[]
  gitSource?: string | Record<string, unknown>
  webhookNotifications?: string | Record<string, unknown>
  emailNotifications?: string | Record<string, unknown>
  notificationSettings?: string | Record<string, unknown>
  environments?: string | unknown[]
  budgetPolicyId?: string
  environmentVariables?: string | unknown[]
  performanceTarget?: 'PERFORMANCE_OPTIMIZED' | 'STANDARD'
}

export interface DatabricksSubmitRunResponse extends ToolResponse {
  output: { runId: number | null }
}

export interface DatabricksRepairRunParams extends DatabricksBaseParams {
  runId: number
  latestRepairId?: number
  rerunTasks?: string | unknown[]
  jobParameters?: string | Record<string, unknown>
  rerunAllFailedTasks?: boolean
  rerunDependentTasks?: boolean
  performanceTarget?: 'PERFORMANCE_OPTIMIZED' | 'STANDARD'
  pipelineParams?: string | Record<string, unknown>
}

export interface DatabricksRepairRunResponse extends ToolResponse {
  output: { repairId: number | null }
}

export interface DatabricksDeleteRunParams extends DatabricksBaseParams {
  runId: number
}

export interface DatabricksCancelAllRunsParams extends DatabricksBaseParams {
  jobId?: number
  allQueuedRuns?: boolean
}

export interface DatabricksCreateClusterParams extends DatabricksBaseParams {
  applyPolicyDefaultValues?: boolean
  cloneFrom?: string | Record<string, unknown>
  numWorkers?: number
  autoscale?: string | Record<string, unknown>
  clusterName?: string
  sparkVersion?: string
  sparkConf?: string | Record<string, unknown>
  awsAttributes?: string | Record<string, unknown>
  azureAttributes?: string | Record<string, unknown>
  gcpAttributes?: string | Record<string, unknown>
  nodeTypeId?: string
  driverNodeTypeId?: string
  workerNodeTypeFlexibility?: string | Record<string, unknown>
  driverNodeTypeFlexibility?: string | Record<string, unknown>
  sshPublicKeys?: string | unknown[]
  customTags?: string | Record<string, unknown>
  clusterLogConf?: string | Record<string, unknown>
  sparkEnvVars?: string | Record<string, unknown>
  autoterminationMinutes?: number
  enableElasticDisk?: boolean
  initScripts?: string | unknown[]
  dockerImage?: string | Record<string, unknown>
  instancePoolId?: string
  singleUserName?: string
  policyId?: string
  enableLocalDiskEncryption?: boolean
  driverInstancePoolId?: string
  workloadType?: string | Record<string, unknown>
  dataSecurityMode?:
    | 'NONE'
    | 'SINGLE_USER'
    | 'USER_ISOLATION'
    | 'LEGACY_TABLE_ACL'
    | 'LEGACY_PASSTHROUGH'
    | 'LEGACY_SINGLE_USER'
    | 'LEGACY_SINGLE_USER_STANDARD'
    | 'DATA_SECURITY_MODE_STANDARD'
    | 'DATA_SECURITY_MODE_DEDICATED'
    | 'DATA_SECURITY_MODE_AUTO'
  runtimeEngine?: 'NULL' | 'STANDARD' | 'PHOTON'
  kind?: 'CLASSIC_PREVIEW'
  useMlRuntime?: boolean
  isSingleNode?: boolean
  remoteDiskThroughput?: number
  totalInitialRemoteDiskSize?: number
  dependencyMode?:
    | 'DEPENDENCY_MODE_ENVIRONMENTS'
    | 'DEPENDENCY_MODE_CLUSTER_LIBRARIES'
    | 'DEPENDENCY_MODE_AUTO'
}

export interface DatabricksCreateClusterResponse extends ToolResponse {
  output: { clusterId: string | null }
}

export interface DatabricksEditClusterParams extends DatabricksBaseParams {
  clusterId: string
  applyPolicyDefaultValues?: boolean
  numWorkers?: number
  autoscale?: string | Record<string, unknown>
  clusterName?: string
  sparkVersion?: string
  sparkConf?: string | Record<string, unknown>
  awsAttributes?: string | Record<string, unknown>
  azureAttributes?: string | Record<string, unknown>
  gcpAttributes?: string | Record<string, unknown>
  nodeTypeId?: string
  driverNodeTypeId?: string
  workerNodeTypeFlexibility?: string | Record<string, unknown>
  driverNodeTypeFlexibility?: string | Record<string, unknown>
  sshPublicKeys?: string | unknown[]
  customTags?: string | Record<string, unknown>
  clusterLogConf?: string | Record<string, unknown>
  sparkEnvVars?: string | Record<string, unknown>
  autoterminationMinutes?: number
  enableElasticDisk?: boolean
  initScripts?: string | unknown[]
  dockerImage?: string | Record<string, unknown>
  instancePoolId?: string
  singleUserName?: string
  policyId?: string
  enableLocalDiskEncryption?: boolean
  driverInstancePoolId?: string
  workloadType?: string | Record<string, unknown>
  dataSecurityMode?:
    | 'NONE'
    | 'SINGLE_USER'
    | 'USER_ISOLATION'
    | 'LEGACY_TABLE_ACL'
    | 'LEGACY_PASSTHROUGH'
    | 'LEGACY_SINGLE_USER'
    | 'LEGACY_SINGLE_USER_STANDARD'
    | 'DATA_SECURITY_MODE_STANDARD'
    | 'DATA_SECURITY_MODE_DEDICATED'
    | 'DATA_SECURITY_MODE_AUTO'
  runtimeEngine?: 'NULL' | 'STANDARD' | 'PHOTON'
  kind?: 'CLASSIC_PREVIEW'
  useMlRuntime?: boolean
  isSingleNode?: boolean
  remoteDiskThroughput?: number
  totalInitialRemoteDiskSize?: number
  dependencyMode?:
    | 'DEPENDENCY_MODE_ENVIRONMENTS'
    | 'DEPENDENCY_MODE_CLUSTER_LIBRARIES'
    | 'DEPENDENCY_MODE_AUTO'
}

export interface DatabricksStartClusterParams extends DatabricksBaseParams {
  clusterId: string
}

export interface DatabricksRestartClusterParams extends DatabricksBaseParams {
  clusterId: string
  restartUser?: string
}

export interface DatabricksTerminateClusterParams extends DatabricksBaseParams {
  clusterId: string
}

export interface DatabricksResizeClusterParams extends DatabricksBaseParams {
  clusterId: string
  numWorkers?: number
  autoscale?: string | Record<string, unknown>
}

export interface DatabricksDeleteClusterParams extends DatabricksBaseParams {
  clusterId: string
}

export interface DatabricksCreateWarehouseParams extends DatabricksBaseParams {
  name?: string
  clusterSize?: string
  minNumClusters?: number
  maxNumClusters?: number
  autoStopMins?: number
  creatorName?: string
  warehouseTags?: string | Record<string, unknown>
  spotInstancePolicy?: 'POLICY_UNSPECIFIED' | 'COST_OPTIMIZED' | 'RELIABILITY_OPTIMIZED'
  enablePhoton?: boolean
  channel?: string | Record<string, unknown>
  enableServerlessCompute?: boolean
  warehouseType?: 'TYPE_UNSPECIFIED' | 'CLASSIC' | 'PRO'
  statementTimeout?: number
}

export interface DatabricksCreateWarehouseResponse extends ToolResponse {
  output: { warehouseId: string | null }
}

export interface DatabricksEditWarehouseParams extends DatabricksBaseParams {
  warehouseId: string
  name?: string
  clusterSize?: string
  minNumClusters?: number
  maxNumClusters?: number
  autoStopMins?: number
  creatorName?: string
  warehouseTags?: string | Record<string, unknown>
  spotInstancePolicy?: 'POLICY_UNSPECIFIED' | 'COST_OPTIMIZED' | 'RELIABILITY_OPTIMIZED'
  enablePhoton?: boolean
  channel?: string | Record<string, unknown>
  enableServerlessCompute?: boolean
  warehouseType?: 'TYPE_UNSPECIFIED' | 'CLASSIC' | 'PRO'
  statementTimeout?: number
}

export interface DatabricksStartWarehouseParams extends DatabricksBaseParams {
  warehouseId: string
}

export interface DatabricksStopWarehouseParams extends DatabricksBaseParams {
  warehouseId: string
}

export interface DatabricksDeleteWarehouseParams extends DatabricksBaseParams {
  warehouseId: string
}

export interface DatabricksGenieCreateSpaceParams extends DatabricksBaseParams {
  warehouseId: string
  parentPath?: string
  serializedSpace: string
  title?: string
  description?: string
}

export interface DatabricksGenieUpdateSpaceParams extends DatabricksBaseParams {
  spaceId: string
  serializedSpace?: string
  title?: string
  description?: string
  warehouseId?: string
  etag?: string
  parentPath?: string
}

export interface DatabricksGenieDeleteSpaceParams extends DatabricksBaseParams {
  spaceId: string
}

export interface DatabricksGetStatementChunkParams extends DatabricksGetStatementParams {
  chunkIndex: number
}

export interface DatabricksGetStatementChunkResponse extends ToolResponse {
  output: Pick<
    DatabricksStatementResult,
    'data' | 'chunkIndex' | 'rowOffset' | 'rowCount' | 'nextChunkIndex' | 'nextChunkInternalLink'
  >
}

export interface DatabricksGetWarehouseParams extends DatabricksBaseParams {
  warehouseId: string
}

export interface DatabricksGetWarehouseResponse extends ToolResponse {
  output: { warehouse: DatabricksListWarehousesResponse['output']['warehouses'][number] }
}

export interface DatabricksGenieAgentCancelParams extends DatabricksBaseParams {
  spaceId: string
  conversationId: string
  responseId: string
}

export const WAREHOUSE_OUTPUT_PROPERTIES = {
  jdbcUrl: { type: 'string', nullable: true, description: 'JDBC connection string' },
  odbcParams: {
    type: 'object',
    nullable: true,
    description: 'ODBC connection settings',
    properties: {
      hostname: { type: 'string' },
      path: { type: 'string' },
      protocol: { type: 'string' },
      port: { type: 'number' },
    },
  },
  health: {
    type: 'object',
    nullable: true,
    description: 'Warehouse health and failure reason',
    properties: {
      status: { type: 'string' },
      failure_reason: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          type: { type: 'string' },
          parameters: { type: 'object' },
        },
      },
    },
  },
  tags: {
    type: 'object',
    nullable: true,
    description: 'Warehouse tags',
    properties: {
      custom_tags: {
        type: 'array',
        items: {
          type: 'object',
          properties: { key: { type: 'string' }, value: { type: 'string' } },
        },
      },
    },
  },
  enablePhoton: { type: 'boolean', nullable: true, description: 'Whether Photon is enabled' },
  spotInstancePolicy: { type: 'string', nullable: true, description: 'Spot instance policy' },
  channel: {
    type: 'object',
    nullable: true,
    description: 'Warehouse release channel',
    properties: { name: { type: 'string' } },
  },
  statementTimeout: { type: 'number', nullable: true, description: 'Statement timeout in seconds' },

  warehouseId: { type: 'string', description: 'Unique warehouse identifier' },
  name: { type: 'string', description: 'Warehouse display name' },
  clusterSize: {
    type: 'string',
    description: 'Warehouse size (e.g., 2X-Small, Small, Medium, Large)',
  },
  state: {
    type: 'string',
    description: 'Current state (STARTING, RUNNING, STOPPING, STOPPED, DELETING, DELETED)',
  },
  warehouseType: { type: 'string', description: 'Warehouse type (CLASSIC, PRO)' },
  creatorName: { type: 'string', description: 'Email of the warehouse creator' },
  autoStopMinutes: {
    type: 'number',
    description: 'Minutes of inactivity before auto-stop (0 = disabled)',
  },
  numClusters: { type: 'number', description: 'Current number of running clusters' },
  minNumClusters: { type: 'number', description: 'Minimum cluster count for scaling' },
  maxNumClusters: { type: 'number', description: 'Maximum cluster count for scaling' },
  numActiveSessions: { type: 'number', description: 'Number of active sessions' },
  enableServerlessCompute: {
    type: 'boolean',
    description: 'Whether serverless compute is enabled',
  },
} as const satisfies Record<string, OutputProperty>

export const JOB_TASK_OUTPUT = {
  type: 'array',
  description: 'Task definitions and task run IDs; nested keys use Databricks API names',
  items: {
    type: 'object',
    properties: {
      task_key: { type: 'string', description: 'Task key' },
      run_id: { type: 'number', optional: true, description: 'Task run ID for Get Run Output' },
      description: { type: 'string', optional: true, description: 'Task description' },
      depends_on: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            task_key: { type: 'string', description: 'Upstream task key' },
            outcome: {
              type: 'string',
              optional: true,
              description: 'Required outcome of a condition task',
            },
          },
        },
      },
      existing_cluster_id: {
        type: 'string',
        optional: true,
        description: 'Existing compute cluster',
      },
      job_cluster_key: { type: 'string', optional: true, description: 'Shared job cluster key' },
      notebook_task: {
        type: 'object',
        optional: true,
        properties: {
          notebook_path: { type: 'string', description: 'Notebook path' },
          source: { type: 'string', description: 'WORKSPACE or GIT' },
          base_parameters: { type: 'object', description: 'Notebook parameter map' },
        },
      },
      spark_python_task: {
        type: 'object',
        optional: true,
        properties: {
          python_file: { type: 'string', description: 'Python file path or cloud URI' },
          source: { type: 'string', optional: true, description: 'WORKSPACE or GIT' },
          parameters: { type: 'array', optional: true, items: { type: 'string' } },
        },
      },
      spark_jar_task: {
        type: 'object',
        optional: true,
        properties: {
          main_class_name: { type: 'string', optional: true, description: 'JAR entry point class' },
          parameters: { type: 'array', optional: true, items: { type: 'string' } },
          jar_uri: { type: 'string', optional: true, description: 'Legacy JAR URI' },
        },
      },
      spark_submit_task: {
        type: 'object',
        optional: true,
        description: 'Legacy spark-submit task',
        properties: {
          parameters: { type: 'array', optional: true, items: { type: 'string' } },
        },
      },
      python_wheel_task: {
        type: 'object',
        optional: true,
        properties: {
          package_name: { type: 'string', description: 'Python package name' },
          entry_point: { type: 'string', description: 'Package entry point' },
          parameters: { type: 'array', optional: true, items: { type: 'string' } },
          named_parameters: {
            type: 'object',
            optional: true,
            description: 'Named wheel parameters',
          },
        },
      },
      sql_task: {
        type: 'object',
        optional: true,
        properties: {
          warehouse_id: { type: 'string', description: 'SQL warehouse identifier' },
          parameters: { type: 'object', optional: true, description: 'SQL parameters' },
          query: {
            type: 'object',
            optional: true,
            properties: { query_id: { type: 'string', description: 'Saved query identifier' } },
          },
          file: {
            type: 'object',
            optional: true,
            properties: {
              path: { type: 'string', description: 'SQL file path' },
              source: { type: 'string', optional: true, description: 'WORKSPACE or GIT' },
            },
          },
          alert: {
            type: 'object',
            optional: true,
            properties: {
              alert_id: { type: 'string', description: 'SQL alert identifier' },
              subscriptions: { type: 'array', optional: true, items: { type: 'object' } },
              pause_subscriptions: { type: 'boolean', optional: true },
            },
          },
          dashboard: {
            type: 'object',
            optional: true,
            properties: {
              dashboard_id: { type: 'string', description: 'Legacy SQL dashboard identifier' },
              subscriptions: { type: 'array', optional: true, items: { type: 'object' } },
              custom_subject: { type: 'string', optional: true },
              pause_subscriptions: { type: 'boolean', optional: true },
            },
          },
        },
      },
      run_job_task: {
        type: 'object',
        optional: true,
        properties: {
          job_id: { type: 'number', description: 'Nested job identifier' },
          job_parameters: { type: 'object', optional: true, description: 'Nested job parameters' },
          pipeline_params: {
            type: 'object',
            optional: true,
            description: 'Pipeline refresh settings',
          },
        },
      },
      pipeline_task: {
        type: 'object',
        optional: true,
        properties: {
          pipeline_id: { type: 'string', description: 'Pipeline identifier' },
          parameters: { type: 'object', optional: true },
          full_refresh: { type: 'boolean', optional: true },
          refresh_selection: { type: 'array', optional: true, items: { type: 'string' } },
          full_refresh_selection: { type: 'array', optional: true, items: { type: 'string' } },
          reset_checkpoint_selection: { type: 'array', optional: true, items: { type: 'string' } },
          refresh_flow_selection: { type: 'array', optional: true, items: { type: 'string' } },
        },
      },
      dbt_task: {
        type: 'object',
        optional: true,
        properties: {
          commands: { type: 'array', items: { type: 'string' }, description: 'dbt commands' },
          project_directory: { type: 'string', optional: true },
          profiles_directory: { type: 'string', optional: true },
          warehouse_id: { type: 'string', optional: true },
          catalog: { type: 'string', optional: true },
          schema: { type: 'string', optional: true },
          source: { type: 'string', optional: true, description: 'WORKSPACE or GIT' },
        },
      },
      condition_task: {
        type: 'object',
        optional: true,
        properties: {
          op: { type: 'string', description: 'Comparison operator' },
          left: { type: 'string', description: 'Left operand' },
          right: { type: 'string', description: 'Right operand' },
          outcome: {
            type: 'string',
            optional: true,
            description: 'Evaluation result: true or false',
          },
        },
      },
      for_each_task: {
        type: 'object',
        optional: true,
        properties: {
          inputs: {
            type: 'string',
            description: 'JSON array or parameter reference to iterate over',
          },
          concurrency: { type: 'number', optional: true },
          task: { type: 'object', description: 'Nested task definition' },
        },
      },
      clean_rooms_notebook_task: {
        type: 'object',
        optional: true,
        properties: {
          clean_room_name: { type: 'string' },
          notebook_name: { type: 'string' },
          etag: { type: 'string', optional: true },
          notebook_base_parameters: { type: 'object', optional: true },
        },
      },
      dashboard_task: {
        type: 'object',
        optional: true,
        properties: {
          dashboard_id: { type: 'string', optional: true },
          warehouse_id: { type: 'string', optional: true },
          subscription: { type: 'object', optional: true },
          filters: { type: 'object', optional: true },
        },
      },
      alert_task: {
        type: 'object',
        optional: true,
        properties: {
          alert_id: { type: 'string', optional: true },
          warehouse_id: { type: 'string', optional: true },
          workspace_path: { type: 'string', optional: true },
          subscribers: { type: 'array', optional: true, items: { type: 'object' } },
        },
      },
      power_bi_task: {
        type: 'object',
        optional: true,
        properties: {
          warehouse_id: { type: 'string', optional: true },
          connection_resource_name: { type: 'string', optional: true },
          refresh_after_update: { type: 'boolean', optional: true },
          power_bi_model: { type: 'object', optional: true },
          tables: { type: 'array', optional: true, items: { type: 'object' } },
        },
      },
      state: {
        type: 'object',
        optional: true,
        properties: {
          life_cycle_state: { type: 'string' },
          result_state: { type: 'string', optional: true },
          state_message: { type: 'string' },
        },
      },
      resolved_values: {
        type: 'object',
        optional: true,
        description:
          'Resolved task parameters keyed by task type (notebook_task, spark_python_task, sql_task, and other task variants)',
      },
      start_time: {
        type: 'number',
        optional: true,
        description: 'Task start in epoch milliseconds',
      },
      end_time: { type: 'number', optional: true, description: 'Task end in epoch milliseconds' },
      run_page_url: { type: 'string', optional: true, description: 'Task run URL' },
    },
  },
} as const satisfies OutputProperty

export const JOB_CLUSTERS_OUTPUT = {
  type: 'array',
  description: 'Shared job compute definitions',
  items: {
    type: 'object',
    properties: {
      job_cluster_key: { type: 'string', description: 'Cluster reference key' },
      new_cluster: {
        type: 'object',
        description: 'Cloud-dependent compute configuration',
        properties: {
          spark_version: { type: 'string' },
          node_type_id: { type: 'string' },
          num_workers: { type: 'number', optional: true },
          autoscale: {
            type: 'object',
            optional: true,
            properties: { min_workers: { type: 'number' }, max_workers: { type: 'number' } },
          },
        },
      },
    },
  },
} as const satisfies OutputProperty

export const RUN_STATUS_OUTPUT_PROPERTIES = {
  state: { type: 'string', description: 'Current lifecycle state' },
  termination_details: {
    type: 'object',
    optional: true,
    properties: {
      code: { type: 'string' },
      type: { type: 'string' },
      message: { type: 'string' },
    },
  },
  queue_details: {
    type: 'object',
    optional: true,
    properties: { code: { type: 'string' }, message: { type: 'string' } },
  },
} as const satisfies Record<string, OutputProperty>

export const RUN_STATUS_OUTPUT = {
  type: 'object',
  nullable: true,
  description: 'Run lifecycle and termination or queue details',
  properties: RUN_STATUS_OUTPUT_PROPERTIES,
} as const satisfies OutputProperty
