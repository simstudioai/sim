import { useEffect, useState } from 'react'
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
  const [scheduleId, setScheduleId] = useState<string | null>(null)
  const [nextRunAt, setNextRunAt] = useState<string | null>(null)
  const [lastRanAt, setLastRanAt] = useState<string | null>(null)
  const [cronExpression, setCronExpression] = useState<string | null>(null)
  const [timezone, setTimezone] = useState<string>('UTC')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  // Track when we need to force a refresh of schedule data
  const [refreshCounter, setRefreshCounter] = useState(0)

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

  // Function to check if schedule exists in the database
  const checkSchedule = async () => {
    setIsLoading(true)
    try {
      // Check if there's a schedule for this workflow, passing the mode parameter
      // For schedule trigger blocks, include blockId to get the specific schedule
      const url = new URL('/api/schedules', window.location.origin)
      url.searchParams.set('workflowId', workflowId)
      url.searchParams.set('mode', 'schedule')

      if (isScheduleTriggerBlock) {
        url.searchParams.set('blockId', blockId)
      }

      const response = await fetch(url.toString(), {
        // Add cache: 'no-store' to prevent caching of this request
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      })

      if (response.ok) {
        const data = await response.json()
        logger.debug('Schedule check response:', data)

        if (data.schedule) {
          setScheduleId(data.schedule.id)
          setNextRunAt(data.schedule.nextRunAt)
          setLastRanAt(data.schedule.lastRanAt)
          setCronExpression(data.schedule.cronExpression)
          setTimezone(data.schedule.timezone || 'UTC')

          // Note: We no longer set global schedule status from individual components
          // The global schedule status should be managed by a higher-level component
        } else {
          setScheduleId(null)
          setNextRunAt(null)
          setLastRanAt(null)
          setCronExpression(null)

          // Note: We no longer set global schedule status from individual components
        }
      }
    } catch (error) {
      logger.error('Error checking schedule:', { error })
      setError('Failed to check schedule status')
    } finally {
      setIsLoading(false)
    }
  }

  // Check for schedule on mount and when relevant dependencies change
  useEffect(() => {
    // Check for schedules when workflowId changes, modal opens, or on initial mount
    if (workflowId) {
      checkSchedule()
    }

    // Cleanup function to reset loading state
    return () => {
      setIsLoading(false)
    }
  }, [workflowId, isModalOpen, refreshCounter])

  // Format the schedule information for display
  const getScheduleInfo = () => {
    if (!scheduleId || !nextRunAt) return null

    let scheduleTiming = 'Unknown schedule'

    if (cronExpression) {
      scheduleTiming = parseCronToHumanReadable(cronExpression)
    } else if (scheduleType) {
      scheduleTiming = `${scheduleType.charAt(0).toUpperCase() + scheduleType.slice(1)}`
    }

    return (
      <>
        <div className='truncate font-normal text-sm'>{scheduleTiming}</div>
        <div className='text-muted-foreground text-xs'>
          <div>Next run: {formatDateTime(new Date(nextRunAt), timezone)}</div>
          {lastRanAt && <div>Last run: {formatDateTime(new Date(lastRanAt), timezone)}</div>}
        </div>
      </>
    )
  }

  const handleOpenModal = () => {
    if (isPreview || disabled) return
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    // Force a refresh when closing the modal
    // Use a small timeout to ensure backend updates are complete
    setTimeout(() => {
      setRefreshCounter((prev) => prev + 1)
    }, 500)
  }

  const handleSaveSchedule = async (): Promise<boolean> => {
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
      if (responseData.cronExpression) {
        setCronExpression(responseData.cronExpression)
      }

      if (responseData.nextRunAt) {
        setNextRunAt(
          typeof responseData.nextRunAt === 'string'
            ? responseData.nextRunAt
            : responseData.nextRunAt.toISOString?.() || responseData.nextRunAt
        )
      }

      // 6. Update the schedule status and trigger a workflow update
      // Note: Global schedule status is managed at a higher level

      // 7. Tell the workflow store that the state has been saved
      const workflowStore = useWorkflowStore.getState()
      workflowStore.updateLastSaved()
      workflowStore.triggerUpdate()

      // 8. Force a refresh to update the UI
      // Use a timeout to ensure the API changes are completed
      setTimeout(() => {
        logger.debug('Refreshing schedule information after save')
        setRefreshCounter((prev) => prev + 1)

        // Make a separate API call to ensure we get the latest schedule info
        checkSchedule()
      }, 500)

      return true
    } catch (error) {
      logger.error('Error saving schedule:', { error })
      setError('Failed to save schedule')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteSchedule = async (): Promise<boolean> => {
    if (isPreview || !scheduleId || disabled) return false

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
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to delete schedule')
        return false
      }

      // 5. Clear schedule state
      setScheduleId(null)
      setNextRunAt(null)
      setLastRanAt(null)
      setCronExpression(null)

      // 6. Update schedule status and refresh UI
      // Note: Global schedule status is managed at a higher level
      setRefreshCounter((prev) => prev + 1)

      return true
    } catch (error) {
      logger.error('Error deleting schedule:', { error })
      setError('Failed to delete schedule')
      return false
    } finally {
      setIsDeleting(false)
    }
  }

  // Check if the schedule is active
  const isScheduleActive = !!scheduleId && !!nextRunAt

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
          scheduleId={scheduleId}
        />
      </Dialog>
    </div>
  )
}
