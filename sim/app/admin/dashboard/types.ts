import { WorkflowState } from '@/stores/workflows/workflow/types'

export interface LogMetadata {
  blockType?: string
  [key: string]: any
}

export interface WorkflowLog {
  id: string
  workflowId: string
  executionId: string | null
  level: string
  message: string
  duration: string | null
  trigger: string | null
  createdAt: Date
  metadata: LogMetadata | null
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
    workflows: Array<{
      id: string
      name: string
      created_at: string
      blocks: { type: string }[]
    }>
    blockUsage: Array<{ type: string; count: number }>
    totalBlocks: number
    avgBlocksPerWorkflow: number
    totalCost: number
    executionStats: {
      manual: number
      webhook: number
      scheduled: number
      api: number
    }
  }>
  topBlocks: Array<{
    type: string
    count: number
  }>
  recentActivity: Array<{
    workflow_id: string
    created_at: string
    status: string
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

export interface UserWorkflowStats {
  workflowCount: number
  blockCount: number
  user: {
    id: string
    name: string
    email: string
  }
}

export interface UserEngagement {
  hasModifiedWorkflow: boolean
  hasRun: boolean
  hasMultipleWorkflows: boolean
}

export interface UserStats {
  userId: string
  totalManualExecutions: number
  totalWebhookTriggers: number
  totalScheduledExecutions: number
  totalApiCalls: number
  totalCost: number
  last_active: Date
}

export interface WorkflowWithUser {
  id: string
  name: string
  isDeployed: boolean
  state: WorkflowState
  userId: string
  runCount: number
  user: {
    id: string
    name: string
    email: string
  }
}

export interface Session {
  id: string
  userId: string
  createdAt: Date
  user: {
    name: string
    email: string
  }
} 