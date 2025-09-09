import { and, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm'
import { workflow, workflowExecutionLogs } from '@/db/schema'

export interface LogFilters {
  workspaceId: string
  workflowIds?: string[]
  folderIds?: string[]
  triggers?: string[]
  level?: 'info' | 'error'
  startDate?: Date
  endDate?: Date
  executionId?: string
  minDurationMs?: number
  maxDurationMs?: number
  minCost?: number
  maxCost?: number
  model?: string
  cursor?: {
    startedAt: string
    id: string
  }
  order?: 'desc' | 'asc'
}

export function buildLogFilters(filters: LogFilters): SQL<unknown> {
  const conditions: SQL<unknown>[] = []

  // Required: workspace and permissions check
  conditions.push(eq(workflow.workspaceId, filters.workspaceId))

  // Cursor-based pagination
  if (filters.cursor) {
    const cursorDate = new Date(filters.cursor.startedAt)
    if (filters.order === 'desc') {
      conditions.push(
        sql`(${workflowExecutionLogs.startedAt}, ${workflowExecutionLogs.id}) < (${cursorDate}, ${filters.cursor.id})`
      )
    } else {
      conditions.push(
        sql`(${workflowExecutionLogs.startedAt}, ${workflowExecutionLogs.id}) > (${cursorDate}, ${filters.cursor.id})`
      )
    }
  }

  // Workflow IDs filter
  if (filters.workflowIds && filters.workflowIds.length > 0) {
    conditions.push(inArray(workflow.id, filters.workflowIds))
  }

  // Folder IDs filter
  if (filters.folderIds && filters.folderIds.length > 0) {
    conditions.push(inArray(workflow.folderId, filters.folderIds))
  }

  // Triggers filter
  if (filters.triggers && filters.triggers.length > 0 && !filters.triggers.includes('all')) {
    conditions.push(inArray(workflowExecutionLogs.trigger, filters.triggers))
  }

  // Level filter
  if (filters.level) {
    conditions.push(eq(workflowExecutionLogs.level, filters.level))
  }

  // Date range filters
  if (filters.startDate) {
    conditions.push(gte(workflowExecutionLogs.startedAt, filters.startDate))
  }

  if (filters.endDate) {
    conditions.push(lte(workflowExecutionLogs.startedAt, filters.endDate))
  }

  // Search filter (execution ID)
  if (filters.executionId) {
    conditions.push(eq(workflowExecutionLogs.executionId, filters.executionId))
  }

  // Duration filters
  if (filters.minDurationMs !== undefined) {
    conditions.push(gte(workflowExecutionLogs.totalDurationMs, filters.minDurationMs))
  }

  if (filters.maxDurationMs !== undefined) {
    conditions.push(lte(workflowExecutionLogs.totalDurationMs, filters.maxDurationMs))
  }

  // Cost filters
  if (filters.minCost !== undefined) {
    conditions.push(sql`(${workflowExecutionLogs.cost}->>'total')::numeric >= ${filters.minCost}`)
  }

  if (filters.maxCost !== undefined) {
    conditions.push(sql`(${workflowExecutionLogs.cost}->>'total')::numeric <= ${filters.maxCost}`)
  }

  // Model filter
  if (filters.model) {
    conditions.push(sql`${workflowExecutionLogs.cost}->>'models' ? ${filters.model}`)
  }

  // Combine all conditions with AND
  return conditions.length > 0 ? and(...conditions)! : sql`true`
}

export function getOrderBy(order: 'desc' | 'asc' = 'desc') {
  return order === 'desc'
    ? desc(workflowExecutionLogs.startedAt)
    : sql`${workflowExecutionLogs.startedAt} ASC`
}
