export interface Workflow {
  id: string
  name: string
  created_at: string
  blocks: { type: string }[]
}

export interface WorkflowLog {
  id: string
  workflow_id: string
  status: string
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
  blockUsage: { type: string; count: number }[]
  apiUsage: { name: string; count: number }[]
  totalBlocks: number
  avgBlocksPerWorkflow: number
}

export interface BlockStats {
  type: string
  count: number
}

export interface DashboardData {
  overview: {
    totalWorkflows: number
    activeWorkflows: number
    totalExecutions: number
    avgBlocksPerWorkflow: number
  }
  topUsers: UserStats[]
  topBlocks: { type: string; count: number }[]
  recentActivity: {
    workflow_id: string
    created_at: string
    status: string
  }[]
} 