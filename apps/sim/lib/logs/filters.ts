import { workflow, workflowExecutionLogs } from '@sim/db/schema'
import { and, eq, gt, gte, inArray, lt, lte, ne, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { TimeRange } from '@/stores/logs/filters/types'

interface FilterValues {
  timeRange: string
  level: string
  workflowIds: string[]
  folderIds: string[]
  triggers: string[]
  searchQuery: string
}

/**
 * Determines if any filters are currently active.
 * @param filters - Current filter values
 * @returns True if any filter is active
 */
export function hasActiveFilters(filters: FilterValues): boolean {
  return (
    filters.timeRange !== 'All time' ||
    filters.level !== 'all' ||
    filters.workflowIds.length > 0 ||
    filters.folderIds.length > 0 ||
    filters.triggers.length > 0 ||
    filters.searchQuery.trim() !== ''
  )
}

/**
 * Shared schema for log filter parameters.
 * Used by both the logs list API and export API.
 */
export const LogFilterParamsSchema = z.object({
  workspaceId: z.string(),
  level: z.string().optional(),
  workflowIds: z.string().optional(),
  folderIds: z.string().optional(),
  triggers: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
  workflowName: z.string().optional(),
  folderName: z.string().optional(),
  executionId: z.string().optional(),
  costOperator: z.enum(['=', '>', '<', '>=', '<=', '!=']).optional(),
  costValue: z.coerce.number().optional(),
  durationOperator: z.enum(['=', '>', '<', '>=', '<=', '!=']).optional(),
  durationValue: z.coerce.number().optional(),
})

export type LogFilterParams = z.infer<typeof LogFilterParamsSchema>

/**
 * Calculates start date from a time range string.
 * Returns null for 'All time' or 'Custom range' to indicate the dates
 * should be handled separately.
 * @param timeRange - The time range option selected by the user
 * @param startDate - Optional start date (YYYY-MM-DD) for custom range
 * @returns Date object for the start of the range, or null for 'All time'
 */
export function getStartDateFromTimeRange(timeRange: TimeRange, startDate?: string): Date | null {
  if (timeRange === 'All time') return null

  if (timeRange === 'Custom range') {
    if (startDate) {
      const date = new Date(startDate)
      date.setHours(0, 0, 0, 0)
      return date
    }
    return null
  }

  const now = new Date()

  switch (timeRange) {
    case 'Past 30 minutes':
      return new Date(now.getTime() - 30 * 60 * 1000)
    case 'Past hour':
      return new Date(now.getTime() - 60 * 60 * 1000)
    case 'Past 6 hours':
      return new Date(now.getTime() - 6 * 60 * 60 * 1000)
    case 'Past 12 hours':
      return new Date(now.getTime() - 12 * 60 * 60 * 1000)
    case 'Past 24 hours':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000)
    case 'Past 3 days':
      return new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
    case 'Past 7 days':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    case 'Past 14 days':
      return new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    case 'Past 30 days':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    default:
      return new Date(0)
  }
}

/**
 * Gets the end date for a time range.
 * Returns null for preset ranges (uses current time as implicit end).
 * Returns end of day for custom ranges.
 * @param timeRange - The time range option selected by the user
 * @param endDate - Optional end date (YYYY-MM-DD) for custom range
 * @returns Date object for the end of the range, or null for preset ranges
 */
export function getEndDateFromTimeRange(timeRange: TimeRange, endDate?: string): Date | null {
  if (timeRange !== 'Custom range') return null

  if (endDate) {
    const date = new Date(endDate)
    date.setHours(23, 59, 59, 999)
    return date
  }

  return null
}

type ComparisonOperator = '=' | '>' | '<' | '>=' | '<=' | '!='

function buildWorkflowIdsCondition(workflowIds: string): SQL | undefined {
  const ids = workflowIds.split(',').filter(Boolean)
  if (ids.length > 0) {
    return inArray(workflow.id, ids)
  }
  return undefined
}

function buildFolderIdsCondition(folderIds: string): SQL | undefined {
  const ids = folderIds.split(',').filter(Boolean)
  if (ids.length > 0) {
    return inArray(workflow.folderId, ids)
  }
  return undefined
}

function buildTriggersCondition(triggers: string): SQL | undefined {
  const triggerList = triggers.split(',').filter(Boolean)
  if (triggerList.length > 0 && !triggerList.includes('all')) {
    return inArray(workflowExecutionLogs.trigger, triggerList)
  }
  return undefined
}

function buildDateConditions(
  startDate?: string,
  endDate?: string
): { startCondition?: SQL; endCondition?: SQL } {
  const result: { startCondition?: SQL; endCondition?: SQL } = {}

  if (startDate) {
    result.startCondition = gte(workflowExecutionLogs.startedAt, new Date(startDate))
  }
  if (endDate) {
    result.endCondition = lte(workflowExecutionLogs.startedAt, new Date(endDate))
  }

  return result
}

function buildSearchConditions(params: {
  search?: string
  workflowName?: string
  folderName?: string
  executionId?: string
}): SQL[] {
  const conditions: SQL[] = []

  if (params.search) {
    const searchTerm = `%${params.search}%`
    conditions.push(sql`${workflowExecutionLogs.executionId} ILIKE ${searchTerm}`)
  }

  if (params.workflowName) {
    const nameTerm = `%${params.workflowName}%`
    conditions.push(sql`${workflow.name} ILIKE ${nameTerm}`)
  }

  if (params.folderName) {
    const folderTerm = `%${params.folderName}%`
    conditions.push(sql`${workflow.name} ILIKE ${folderTerm}`)
  }

  if (params.executionId) {
    conditions.push(eq(workflowExecutionLogs.executionId, params.executionId))
  }

  return conditions
}

function buildCostCondition(operator: ComparisonOperator, value: number): SQL {
  const costField = sql`(${workflowExecutionLogs.cost}->>'total')::numeric`

  switch (operator) {
    case '=':
      return sql`${costField} = ${value}`
    case '>':
      return sql`${costField} > ${value}`
    case '<':
      return sql`${costField} < ${value}`
    case '>=':
      return sql`${costField} >= ${value}`
    case '<=':
      return sql`${costField} <= ${value}`
    case '!=':
      return sql`${costField} != ${value}`
  }
}

function buildDurationCondition(operator: ComparisonOperator, value: number): SQL | undefined {
  const durationField = workflowExecutionLogs.totalDurationMs

  switch (operator) {
    case '=':
      return eq(durationField, value)
    case '>':
      return gt(durationField, value)
    case '<':
      return lt(durationField, value)
    case '>=':
      return gte(durationField, value)
    case '<=':
      return lte(durationField, value)
    case '!=':
      return ne(durationField, value)
  }
}

/**
 * Builds SQL conditions for simple level filtering (used by export API).
 * Does not handle complex running/pending states.
 */
export function buildSimpleLevelCondition(level: string): SQL | undefined {
  if (!level || level === 'all') return undefined

  const levels = level.split(',').filter(Boolean)
  if (levels.length === 1) {
    return eq(workflowExecutionLogs.level, levels[0])
  }
  if (levels.length > 1) {
    return inArray(workflowExecutionLogs.level, levels)
  }
  return undefined
}

export interface BuildFilterConditionsOptions {
  /**
   * Whether to use simple level filtering (just matches level string).
   * Set to false to skip level filtering (caller will handle it separately).
   */
  useSimpleLevelFilter?: boolean
}

/**
 * Builds combined SQL conditions from log filter parameters.
 * Returns a single SQL condition that can be used in a WHERE clause.
 * @param params - The filter parameters from the request
 * @param options - Configuration options for filter building
 * @returns Combined SQL condition or undefined if no filters
 */
export function buildFilterConditions(
  params: LogFilterParams,
  options: BuildFilterConditionsOptions = {}
): SQL | undefined {
  const { useSimpleLevelFilter = true } = options
  const conditions: SQL[] = []

  if (useSimpleLevelFilter && params.level) {
    const levelCondition = buildSimpleLevelCondition(params.level)
    if (levelCondition) conditions.push(levelCondition)
  }

  if (params.workflowIds) {
    const condition = buildWorkflowIdsCondition(params.workflowIds)
    if (condition) conditions.push(condition)
  }

  if (params.folderIds) {
    const condition = buildFolderIdsCondition(params.folderIds)
    if (condition) conditions.push(condition)
  }

  if (params.triggers) {
    const condition = buildTriggersCondition(params.triggers)
    if (condition) conditions.push(condition)
  }

  const { startCondition, endCondition } = buildDateConditions(params.startDate, params.endDate)
  if (startCondition) conditions.push(startCondition)
  if (endCondition) conditions.push(endCondition)

  const searchConditions = buildSearchConditions({
    search: params.search,
    workflowName: params.workflowName,
    folderName: params.folderName,
    executionId: params.executionId,
  })
  conditions.push(...searchConditions)

  if (params.costOperator && params.costValue !== undefined) {
    conditions.push(buildCostCondition(params.costOperator, params.costValue))
  }

  if (params.durationOperator && params.durationValue !== undefined) {
    const condition = buildDurationCondition(params.durationOperator, params.durationValue)
    if (condition) conditions.push(condition)
  }

  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return and(...conditions)
}
