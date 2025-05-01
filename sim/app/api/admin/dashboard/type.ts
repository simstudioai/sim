// Workflow status enum for better type safety
export enum WorkflowStatus {
    SUCCESS = 'success',
    ERROR = 'error',
    RUNNING = 'running',
    PENDING = 'pending',
    CANCELLED = 'cancelled'
  }
  
  export interface Workflow {
    id: string
    name: string
    created_at: string
    blocks: { type: string }[]
  }
  
  export interface WorkflowLog {
    id: string
    workflow_id: string
    status: WorkflowStatus
    created_at: string
  }
  
  export interface User {
    id: string
    email: string
  }
  
  export interface UserStats {
    email: string
    firstName: string
    workflowCount: number
    blockCount: number
    workflows: Workflow[]
    blockUsage: BlockStats[]
    apiUsage: { name: string; count: number }[]
    totalBlocks: number
    avgBlocksPerWorkflow: number
    totalCost: number
    executionStats: {
      manual: number
      webhook: number
      scheduled: number
      api: number
    }
  }
  
  export interface BlockStats {
    type: string
    count: number
  }
  
  // Define a more specific type for workflow state
  export interface WorkflowState {
    blocks?: Array<{
      id: string
      type: string
      position?: { x: number; y: number }
      data?: Record<string, unknown>
    }>
    connections?: Array<{
      id: string
      source: string
      target: string
    }>
    variables?: Record<string, unknown>
    metadata?: Record<string, unknown>
  }
  
  export interface DashboardData {
    overview: {
      totalWorkflows: number
      activeWorkflows: number
      totalExecutions: number
      avgBlocksPerWorkflow: number
    }
    userDemographics: {
      totalUsers: number
      inactiveUsers: number
      inactivePercentage: number
      usersWithNoWorkflows: number
      usersWithNoRuns: number
      averageWorkflowsPerUser: number
      modifiedAndRan: number
      modifiedAndRanPercentage: number
      modifiedNoRun: number
      modifiedNoRunPercentage: number
      createdMultiple: number
      createdMultiplePercentage: number
      baseStateOnly: number
      baseStateOnlyPercentage: number
      totalSessions: number
      averageSessionsPerUser: number
      returningUsers: number
      returningUsersPercentage: number
      topReturningUsers: Array<{
        name: string
        email: string
        sessionCount: number
        lastSeen: string
      }>
    }
    topUsers: Array<{
      email: string
      name: string
      workflowCount: number
      blockCount: number
      executionStats: {
        manual: number
        webhook: number
        scheduled: number
        api: number
      }
      workflows: Array<{
        id: string
        name: string
        created_at: string
        blockTypes: string[]
      }>
      blockUsage: BlockStats[]
      totalBlocks: number
      avgBlocksPerWorkflow: number
      totalCost: number
    }>
    topBlocks: BlockStats[]
    recentActivity: Array<{
      workflow_id: string
      created_at: string
      status: WorkflowStatus
    }>
    workflows: Array<{
      id: string
      name: string
      ownerName: string
      blockCount: number
      runCount: number
      isDeployed: boolean
    }>
    blockLatencies: Array<{
      type: string
      avgLatency: number
      p50Latency: number
      p75Latency: number
      p99Latency: number
      p100Latency: number
      samples: number
    }>
  } 