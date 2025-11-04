import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('useScheduleManagement')

interface UseScheduleManagementProps {
  blockId: string
  isPreview?: boolean
}

interface SaveConfigResult {
  success: boolean
  nextRunAt?: string
  cronExpression?: string
}

interface ScheduleManagementState {
  scheduleId: string | null
  isLoading: boolean
  isSaving: boolean
  saveConfig: () => Promise<SaveConfigResult>
  deleteConfig: () => Promise<boolean>
}

/**
 * Hook to manage schedule lifecycle for schedule blocks
 * Handles:
 * - Loading existing schedules from the API
 * - Saving schedule configurations
 * - Deleting schedule configurations
 */
export function useScheduleManagement({
  blockId,
  isPreview = false,
}: UseScheduleManagementProps): ScheduleManagementState {
  const params = useParams()
  const workflowId = params.workflowId as string

  const scheduleId = useSubBlockStore(
    useCallback((state) => state.getValue(blockId, 'scheduleId') as string | null, [blockId])
  )

  const isLoading = useSubBlockStore((state) => state.loadingSchedules.has(blockId))
  const isChecked = useSubBlockStore((state) => state.checkedSchedules.has(blockId))

  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (isPreview) {
      return
    }

    const store = useSubBlockStore.getState()
    const currentlyLoading = store.loadingSchedules.has(blockId)
    const alreadyChecked = store.checkedSchedules.has(blockId)
    const currentScheduleId = store.getValue(blockId, 'scheduleId')

    if (currentlyLoading || (alreadyChecked && currentScheduleId)) {
      return
    }

    const loadSchedule = async () => {
      useSubBlockStore.setState((state) => ({
        loadingSchedules: new Set([...state.loadingSchedules, blockId]),
      }))

      try {
        const response = await fetch(
          `/api/schedules?workflowId=${workflowId}&blockId=${blockId}&mode=schedule`
        )

        if (response.ok) {
          const data = await response.json()

          if (data.schedule?.id) {
            useSubBlockStore.getState().setValue(blockId, 'scheduleId', data.schedule.id)
            logger.info('Schedule loaded from API', {
              blockId,
              scheduleId: data.schedule.id,
            })
          } else {
            useSubBlockStore.getState().setValue(blockId, 'scheduleId', null)
          }

          useSubBlockStore.setState((state) => ({
            checkedSchedules: new Set([...state.checkedSchedules, blockId]),
          }))
        } else {
          logger.warn('API response not OK', {
            blockId,
            workflowId,
            status: response.status,
            statusText: response.statusText,
          })
        }
      } catch (error) {
        logger.error('Error loading schedule:', { error, blockId, workflowId })
      } finally {
        useSubBlockStore.setState((state) => {
          const newSet = new Set(state.loadingSchedules)
          newSet.delete(blockId)
          return { loadingSchedules: newSet }
        })
      }
    }

    loadSchedule()
  }, [isPreview, workflowId, blockId])

  const saveConfig = async (): Promise<SaveConfigResult> => {
    if (isPreview || isSaving) {
      return { success: false }
    }

    try {
      setIsSaving(true)

      const workflowStore = useWorkflowStore.getState()
      const subBlockStore = useSubBlockStore.getState()

      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      const subBlockValues = activeWorkflowId
        ? subBlockStore.workflowValues[activeWorkflowId] || {}
        : {}

      const { mergeSubblockStateAsync } = await import('@/stores/workflows/server-utils')
      const mergedBlocks = await mergeSubblockStateAsync(workflowStore.blocks, subBlockValues)

      const workflowState = {
        blocks: mergedBlocks,
        edges: workflowStore.edges,
        loops: workflowStore.loops,
      }

      const response = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId,
          blockId,
          state: workflowState,
        }),
      })

      if (!response.ok) {
        let errorMessage = 'Failed to save schedule'
        try {
          const errorData = await response.json()
          errorMessage = errorData.details || errorData.error || errorMessage
        } catch {
          // If response is not JSON, use default message
        }
        logger.error('Failed to save schedule', { errorMessage })
        throw new Error(errorMessage)
      }

      const data = await response.json()

      if (data.schedule?.id) {
        useSubBlockStore.getState().setValue(blockId, 'scheduleId', data.schedule.id)
        useSubBlockStore.setState((state) => ({
          checkedSchedules: new Set([...state.checkedSchedules, blockId]),
        }))
      }

      logger.info('Schedule saved successfully', {
        scheduleId: data.schedule?.id,
        blockId,
        nextRunAt: data.nextRunAt,
        cronExpression: data.cronExpression,
      })

      return { success: true, nextRunAt: data.nextRunAt, cronExpression: data.cronExpression }
    } catch (error) {
      logger.error('Error saving schedule:', error)
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  const deleteConfig = async (): Promise<boolean> => {
    if (isPreview || !scheduleId) {
      return false
    }

    try {
      setIsSaving(true)

      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: params.workspaceId as string,
        }),
      })

      if (!response.ok) {
        logger.error('Failed to delete schedule')
        return false
      }

      useSubBlockStore.getState().setValue(blockId, 'scheduleId', null)
      useSubBlockStore.setState((state) => {
        const newSet = new Set(state.checkedSchedules)
        newSet.delete(blockId)
        return { checkedSchedules: newSet }
      })

      logger.info('Schedule deleted successfully')
      return true
    } catch (error) {
      logger.error('Error deleting schedule:', error)
      return false
    } finally {
      setIsSaving(false)
    }
  }

  return {
    scheduleId,
    isLoading,
    isSaving,
    saveConfig,
    deleteConfig,
  }
}
