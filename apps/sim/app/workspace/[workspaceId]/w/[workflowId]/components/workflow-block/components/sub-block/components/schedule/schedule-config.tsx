import { useCallback, useEffect, useState } from 'react'
import { Calendar, ExternalLink } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { createLogger } from '@/lib/logs/console/logger'
import { parseCronToHumanReadable } from '@/lib/schedules/utils'
import { formatDateTime } from '@/lib/utils'
import { ScheduleModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/schedule/components/schedule-modal'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { getBlockWithValues, getWorkflowWithValues } from '@/stores/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('ScheduleConfig')

interface ScheduleConfigProps {
  blockId: string
  subBlockId: string
  isConnecting: boolean
  isPreview?: boolean
  previewValue?: any | null
  disabled?: boolean
}

export function ScheduleConfig({
  blockId,
  subBlockId: _subBlockId,
  isConnecting,
  isPreview = false,
  previewValue: _previewValue,
  disabled = false,
}: ScheduleConfigProps) {
  const [error, setError] = useState<string | null>(null)
  const [scheduleData, setScheduleData] = useState<{
    id: string | null
    nextRunAt: string | null
    lastRanAt: string | null
    cronExpression: string | null
    timezone: string
  }>({
    id: null,
    nextRunAt: null,
    lastRanAt: null,
    cronExpression: null,
    timezone: 'UTC',
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const params = useParams()
  const workflowId = params.workflowId as string

  // Get workflow state from store

  // Get the schedule type from the block state
  const [scheduleType] = useSubBlockValue(blockId, 'scheduleType')

  // Get the startWorkflow value to determine if scheduling is enabled
  // and expose the setter so we can update it
  const [_startWorkflow, setStartWorkflow] = useSubBlockValue(blockId, 'startWorkflow')

  // Determine if this is a schedule trigger block vs starter block
  const blockWithValues = getBlockWithValues(blockId)
  const isScheduleTriggerBlock = blockWithValues?.type === 'schedule'

  // Fetch schedule data from API
  const fetchSchedule = useCallback(async () => {
    if (!workflowId) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        workflowId,
        mode: 'schedule',
      })
      if (isScheduleTriggerBlock) {
        params.set('blockId', blockId)
      }

      const response = await fetch(`/api/schedules?${params}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      })

      if (response.ok) {
        const data = await response.json()
        if (data.schedule) {
          setScheduleData({
            id: data.schedule.id,
            nextRunAt: data.schedule.nextRunAt,
            lastRanAt: data.schedule.lastRanAt,
            cronExpression: data.schedule.cronExpression,
            timezone: data.schedule.timezone || 'UTC',
          })
        } else {
          setScheduleData({
            id: null,
            nextRunAt: null,
            lastRanAt: null,
            cronExpression: null,
            timezone: 'UTC',
          })
        }
      }
    } catch (error) {
      logger.error('Error fetching schedule:', error)
    } finally {
      setIsLoading(false)
    }
  }, [workflowId, blockId, isScheduleTriggerBlock])

  // Fetch schedule data on mount
  useEffect(() => {
    fetchSchedule()

    // Listen for schedule updates from other components
    const handleScheduleUpdate = (event: CustomEvent) => {
      if (event.detail?.workflowId === workflowId && event.detail?.blockId === blockId) {
        logger.debug('Schedule update event received in schedule-config, refetching')
        fetchSchedule()
      }
    }

    window.addEventListener('schedule-updated', handleScheduleUpdate as EventListener)

    return () => {
      window.removeEventListener('schedule-updated', handleScheduleUpdate as EventListener)
    }
  }, [fetchSchedule, workflowId, blockId])

  // Refetch when modal opens to get latest data
  useEffect(() => {
    if (isModalOpen) {
      fetchSchedule()
    }
  }, [isModalOpen, fetchSchedule])

  // Format the schedule information for display
  const getScheduleInfo = () => {
    if (!scheduleData.id || !scheduleData.nextRunAt) return null

    let scheduleTiming = 'Unknown schedule'

    if (scheduleData.cronExpression) {
      scheduleTiming = parseCronToHumanReadable(scheduleData.cronExpression, scheduleData.timezone)
    } else if (scheduleType) {
      scheduleTiming = `${scheduleType.charAt(0).toUpperCase() + scheduleType.slice(1)}`
    }

    return (
      <>
        <div className='truncate font-normal text-sm'>{scheduleTiming}</div>
        <div className='text-muted-foreground text-xs'>
          <div>
            Next run: {formatDateTime(new Date(scheduleData.nextRunAt), scheduleData.timezone)}
          </div>
          {scheduleData.lastRanAt && (
            <div>
              Last run: {formatDateTime(new Date(scheduleData.lastRanAt), scheduleData.timezone)}
            </div>
          )}
        </div>
      </>
    )
  }

  const handleOpenModal = () => {
    if (isPreview || disabled) return
    setIsModalOpen(true)
  }

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false)
  }, [])

  const handleSaveSchedule = useCallback(async (): Promise<boolean> => {
    if (isPreview || disabled) return false

    setIsSaving(true)
    setError(null)

    try {
      // For starter blocks, update the startWorkflow value to 'schedule'
      // For schedule trigger blocks, skip this step as startWorkflow is not needed
      if (!isScheduleTriggerBlock) {
        // 1. First, update the startWorkflow value in SubBlock store to 'schedule'
        setStartWorkflow('schedule')

        // 2. Directly access and modify the SubBlock store to guarantee the value is set
        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (!activeWorkflowId) {
          setError('No active workflow found')
          return false
        }

        // Update the SubBlock store directly to ensure the value is set correctly
        const subBlockStore = useSubBlockStore.getState()
        subBlockStore.setValue(blockId, 'startWorkflow', 'schedule')

        // Give React time to process the state update
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      if (!activeWorkflowId) {
        setError('No active workflow found')
        return false
      }

      // 3. Get the fully merged current state with updated values
      // This ensures we send the complete, correct workflow state to the backend
      const currentWorkflowWithValues = getWorkflowWithValues(activeWorkflowId)
      if (!currentWorkflowWithValues) {
        setError('Failed to get current workflow state')
        return false
      }

      // 4. Make a direct API call instead of relying on sync
      // This gives us more control and better error handling
      logger.debug('Making direct API call to save schedule with complete state')

      // Prepare the request body
      const requestBody: any = {
        workflowId,
        state: currentWorkflowWithValues.state,
      }

      // For schedule trigger blocks, include the blockId
      if (isScheduleTriggerBlock) {
        requestBody.blockId = blockId
      }

      const response = await fetch('/api/schedules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      // Parse the response
      const responseText = await response.text()
      let responseData
      try {
        responseData = JSON.parse(responseText)
      } catch (e) {
        logger.error('Failed to parse response JSON', e, responseText)
        responseData = {}
      }

      if (!response.ok) {
        setError(responseData.error || 'Failed to save schedule')
        return false
      }

      logger.debug('Schedule save response:', responseData)

      // 5. Update our local state with the response data
      if (responseData.cronExpression || responseData.nextRunAt) {
        setScheduleData((prev) => ({
          ...prev,
          cronExpression: responseData.cronExpression || prev.cronExpression,
          nextRunAt:
            typeof responseData.nextRunAt === 'string'
              ? responseData.nextRunAt
              : responseData.nextRunAt?.toISOString?.() || prev.nextRunAt,
        }))
      }

      // 6. Dispatch custom event to notify parent workflow-block component to refetch schedule info
      // This ensures the badge updates immediately after saving
      const event = new CustomEvent('schedule-updated', {
        detail: { workflowId, blockId },
      })
      window.dispatchEvent(event)
      logger.debug('Dispatched schedule-updated event', { workflowId, blockId })

      // 6. Update the schedule status and trigger a workflow update
      // Note: Global schedule status is managed at a higher level

      // 7. Tell the workflow store that the state has been saved
      const workflowStore = useWorkflowStore.getState()
      workflowStore.updateLastSaved()
      workflowStore.triggerUpdate()

      // 8. Refetch the schedule to update local state
      await fetchSchedule()

      return true
    } catch (error) {
      logger.error('Error saving schedule:', { error })
      setError('Failed to save schedule')
      return false
    } finally {
      setIsSaving(false)
    }
  }, [workflowId, blockId, isScheduleTriggerBlock, setStartWorkflow, fetchSchedule])

  const handleDeleteSchedule = useCallback(async (): Promise<boolean> => {
    if (isPreview || !scheduleData.id || disabled) return false

    setIsDeleting(true)
    try {
      // For starter blocks, update the startWorkflow value to 'manual'
      // For schedule trigger blocks, skip this step as startWorkflow is not relevant
      if (!isScheduleTriggerBlock) {
        // 1. First update the workflow state to disable scheduling
        setStartWorkflow('manual')

        // 2. Directly update the SubBlock store to ensure the value is set
        const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
        if (!activeWorkflowId) {
          setError('No active workflow found')
          return false
        }

        // Update the store directly
        const subBlockStore = useSubBlockStore.getState()
        subBlockStore.setValue(blockId, 'startWorkflow', 'manual')

        // 3. Update the workflow store
        const workflowStore = useWorkflowStore.getState()
        workflowStore.triggerUpdate()
        workflowStore.updateLastSaved()
      }

      // 4. Make the DELETE API call to remove the schedule
      const response = await fetch(`/api/schedules/${scheduleData.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to delete schedule')
        return false
      }

      // 5. Clear schedule state
      setScheduleData({
        id: null,
        nextRunAt: null,
        lastRanAt: null,
        cronExpression: null,
        timezone: 'UTC',
      })

      // 6. Update schedule status and refresh UI
      // Note: Global schedule status is managed at a higher level

      // 7. Dispatch custom event to notify parent workflow-block component
      const event = new CustomEvent('schedule-updated', {
        detail: { workflowId, blockId },
      })
      window.dispatchEvent(event)
      logger.debug('Dispatched schedule-updated event after delete', { workflowId, blockId })

      return true
    } catch (error) {
      logger.error('Error deleting schedule:', { error })
      setError('Failed to delete schedule')
      return false
    } finally {
      setIsDeleting(false)
    }
  }, [
    scheduleData.id,
    isPreview,
    disabled,
    isScheduleTriggerBlock,
    setStartWorkflow,
    workflowId,
    blockId,
  ])

  // Check if the schedule is active
  const isScheduleActive = !!scheduleData.id && !!scheduleData.nextRunAt

  return (
    <div className='w-full' onClick={(e) => e.stopPropagation()}>
      {error && <div className='mb-2 text-red-500 text-sm dark:text-red-400'>{error}</div>}

      {isScheduleActive ? (
        <div className='flex flex-col space-y-2'>
          <div className='flex items-center justify-between rounded border border-border bg-background px-3 py-2'>
            <div className='flex flex-1 items-center gap-2'>
              <div className='flex-1 truncate'>{getScheduleInfo()}</div>
            </div>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='h-8 w-8 shrink-0'
              onClick={handleOpenModal}
              disabled={isPreview || isDeleting || isConnecting || disabled}
            >
              {isDeleting ? (
                <div className='h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
              ) : (
                <ExternalLink className='h-4 w-4' />
              )}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant='outline'
          size='sm'
          className='flex h-10 w-full items-center bg-background font-normal text-sm'
          onClick={handleOpenModal}
          disabled={isPreview || isConnecting || isSaving || isDeleting || disabled}
        >
          {isLoading ? (
            <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
          ) : (
            <Calendar className='mr-2 h-4 w-4' />
          )}
          Configure Schedule
        </Button>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <ScheduleModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          workflowId={workflowId}
          blockId={blockId}
          onSave={handleSaveSchedule}
          onDelete={handleDeleteSchedule}
          scheduleId={scheduleData.id}
        />
      </Dialog>
    </div>
  )
}
