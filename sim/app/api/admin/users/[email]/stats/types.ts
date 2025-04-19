import { user, workflow, workflowLogs, userStats } from '@/db/schema'

export interface User {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Block {
  id: string
  type: string
  position: { x: number; y: number }
  data: any
}

export interface WorkflowState {
  blocks: Block[]
  [key: string]: any
}

export interface Workflow {
  id: string
  userId: string
  name: string
  description: string | null
  state: WorkflowState
  color: string
  lastSynced: Date
  createdAt: Date
  updatedAt: Date
  isDeployed: boolean
  deployedState: any
  deployedAt: Date | null
  collaborators: string[]
  runCount: number
  lastRunAt: Date | null
  variables: Record<string, any>
}

export interface UserStats {
  user: {
    id: string
    name: string
    email: string
    createdAt: Date
  }
  workflows: Array<{
    id: string
    name: string
    blockCount: number
    createdAt: Date
  }>
  stats: {
    workflowCount: number
    blockCount: number
    executionCount: number
    successfulExecutions: number
    successRate: number
    totalCost: number
  }
}

export type DbSchema = {
  user: typeof user
  workflow: typeof workflow
  workflowLogs: typeof workflowLogs
  userStats: typeof userStats
}
  