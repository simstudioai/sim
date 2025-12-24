import { type db, workflowSchedule } from '@sim/db'
import type * as schema from '@sim/db/schema'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type BlockState,
  calculateNextRunTime,
  generateCronExpression,
  getScheduleTimeValues,
  getSubBlockValue,
  validateCronExpression,
} from './utils'

const logger = createLogger('ScheduleDeployUtils')

/**
 * Type for database or transaction context
 * This allows the functions to work with either the db instance or a transaction
 */
type DbOrTx =
  | typeof db
  | PgTransaction<
      PostgresJsQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >

/**
 * Result of schedule validation
 */
export interface ScheduleValidationResult {
  isValid: boolean
  error?: string
  scheduleType?: string
  cronExpression?: string
  nextRunAt?: Date
  timezone?: string
}

/**
 * Result of schedule creation during deploy
 */
export interface ScheduleDeployResult {
  success: boolean
  error?: string
  scheduleId?: string
  cronExpression?: string
  nextRunAt?: Date
  timezone?: string
}

/**
 * Check if a time value is valid (not empty/null/undefined)
 */
function isValidTimeValue(value: string | null | undefined): boolean {
  return !!value && value.trim() !== '' && value.includes(':')
}

/**
 * Check if a schedule type has valid configuration
 * Uses raw block values to avoid false positives from default parsing
 */
function hasValidScheduleConfig(scheduleType: string | undefined, block: BlockState): boolean {
  switch (scheduleType) {
    case 'minutes': {
      const rawValue = getSubBlockValue(block, 'minutesInterval')
      const numValue = Number(rawValue)
      return !!rawValue && !Number.isNaN(numValue) && numValue >= 1 && numValue <= 1440
    }
    case 'hourly': {
      const rawValue = getSubBlockValue(block, 'hourlyMinute')
      const numValue = Number(rawValue)
      return rawValue !== '' && !Number.isNaN(numValue) && numValue >= 0 && numValue <= 59
    }
    case 'daily': {
      const rawTime = getSubBlockValue(block, 'dailyTime')
      return isValidTimeValue(rawTime)
    }
    case 'weekly': {
      const rawDay = getSubBlockValue(block, 'weeklyDay')
      const rawTime = getSubBlockValue(block, 'weeklyDayTime')
      return !!rawDay && isValidTimeValue(rawTime)
    }
    case 'monthly': {
      const rawDay = getSubBlockValue(block, 'monthlyDay')
      const rawTime = getSubBlockValue(block, 'monthlyTime')
      const dayNum = Number(rawDay)
      return (
        !!rawDay &&
        !Number.isNaN(dayNum) &&
        dayNum >= 1 &&
        dayNum <= 31 &&
        isValidTimeValue(rawTime)
      )
    }
    case 'custom':
      return !!getSubBlockValue(block, 'cronExpression')
    default:
      return false
  }
}

/**
 * Get human-readable error message for missing schedule configuration
 */
function getMissingConfigError(scheduleType: string): string {
  switch (scheduleType) {
    case 'minutes':
      return 'Minutes interval is required for minute-based schedules'
    case 'hourly':
      return 'Minute value is required for hourly schedules'
    case 'daily':
      return 'Time is required for daily schedules'
    case 'weekly':
      return 'Day and time are required for weekly schedules'
    case 'monthly':
      return 'Day and time are required for monthly schedules'
    case 'custom':
      return 'Cron expression is required for custom schedules'
    default:
      return 'Schedule type is required'
  }
}

/**
 * Find schedule blocks in a workflow's blocks
 */
export function findScheduleBlocks(blocks: Record<string, BlockState>): BlockState[] {
  return Object.values(blocks).filter((block) => block.type === 'schedule')
}

/**
 * Validate a schedule block's configuration
 * Returns validation result with error details if invalid
 */
export function validateScheduleBlock(block: BlockState): ScheduleValidationResult {
  const scheduleType = getSubBlockValue(block, 'scheduleType')

  if (!scheduleType) {
    return {
      isValid: false,
      error: 'Schedule type is required',
    }
  }

  const hasValidConfig = hasValidScheduleConfig(scheduleType, block)

  if (!hasValidConfig) {
    return {
      isValid: false,
      error: getMissingConfigError(scheduleType),
      scheduleType,
    }
  }

  const timezone = getSubBlockValue(block, 'timezone') || 'UTC'

  try {
    // Get parsed schedule values (safe to use after validation passes)
    const scheduleValues = getScheduleTimeValues(block)
    const sanitizedScheduleValues =
      scheduleType !== 'custom' ? { ...scheduleValues, cronExpression: null } : scheduleValues

    const cronExpression = generateCronExpression(scheduleType, sanitizedScheduleValues)

    const validation = validateCronExpression(cronExpression, timezone)
    if (!validation.isValid) {
      return {
        isValid: false,
        error: `Invalid cron expression: ${validation.error}`,
        scheduleType,
      }
    }

    const nextRunAt = calculateNextRunTime(scheduleType, sanitizedScheduleValues)

    return {
      isValid: true,
      scheduleType,
      cronExpression,
      nextRunAt,
      timezone,
    }
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Failed to generate schedule',
      scheduleType,
    }
  }
}

/**
 * Validate all schedule blocks in a workflow
 * Returns the first validation error found, or success if all are valid
 */
export function validateWorkflowSchedules(
  blocks: Record<string, BlockState>
): ScheduleValidationResult {
  const scheduleBlocks = findScheduleBlocks(blocks)

  for (const block of scheduleBlocks) {
    const result = validateScheduleBlock(block)
    if (!result.isValid) {
      return result
    }
  }

  return { isValid: true }
}

/**
 * Create or update schedule records for a workflow during deployment
 * This should be called within a database transaction
 */
export async function createSchedulesForDeploy(
  workflowId: string,
  blocks: Record<string, BlockState>,
  tx: DbOrTx
): Promise<ScheduleDeployResult> {
  const scheduleBlocks = findScheduleBlocks(blocks)

  if (scheduleBlocks.length === 0) {
    logger.info(`No schedule blocks found in workflow ${workflowId}`)
    return { success: true }
  }

  let lastScheduleInfo: {
    scheduleId: string
    cronExpression?: string
    nextRunAt?: Date
    timezone?: string
  } | null = null

  for (const block of scheduleBlocks) {
    const blockId = block.id as string

    const validation = validateScheduleBlock(block)
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error,
      }
    }

    const { cronExpression, nextRunAt, timezone } = validation

    const scheduleId = crypto.randomUUID()
    const now = new Date()

    const values = {
      id: scheduleId,
      workflowId,
      blockId,
      cronExpression: cronExpression!,
      triggerType: 'schedule',
      createdAt: now,
      updatedAt: now,
      nextRunAt: nextRunAt!,
      timezone: timezone!,
      status: 'active',
      failedCount: 0,
    }

    const setValues = {
      blockId,
      cronExpression: cronExpression!,
      updatedAt: now,
      nextRunAt: nextRunAt!,
      timezone: timezone!,
      status: 'active',
      failedCount: 0,
    }

    await tx
      .insert(workflowSchedule)
      .values(values)
      .onConflictDoUpdate({
        target: [workflowSchedule.workflowId, workflowSchedule.blockId],
        set: setValues,
      })

    logger.info(`Schedule created/updated for workflow ${workflowId}, block ${blockId}`, {
      scheduleId: values.id,
      cronExpression,
      nextRunAt: nextRunAt?.toISOString(),
    })

    lastScheduleInfo = { scheduleId: values.id, cronExpression, nextRunAt, timezone }
  }

  return {
    success: true,
    ...lastScheduleInfo,
  }
}

/**
 * Delete all schedules for a workflow
 * This should be called within a database transaction during undeploy
 */
export async function deleteSchedulesForWorkflow(workflowId: string, tx: DbOrTx): Promise<void> {
  await tx.delete(workflowSchedule).where(eq(workflowSchedule.workflowId, workflowId))

  logger.info(`Deleted all schedules for workflow ${workflowId}`)
}
