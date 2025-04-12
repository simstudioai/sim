import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Calendar, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { createLogger } from '@/lib/logs/console-logger'
import { formatDateTime } from '@/lib/utils'
import { getWorkflowWithValues } from '@/stores/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'
import { ScheduleModal } from './components/schedule-modal'
import { parseCronToHumanReadable } from '@/lib/schedules/utils'

const logger = createLogger('ScheduleConfig')

interface ScheduleConfigProps {
  blockId: string
  subBlockId?: string
  isConnecting: boolean
}

export function ScheduleConfig({ blockId, subBlockId, isConnecting }: ScheduleConfigProps) {
  const [error, setError] = useState<string | null>(null)
  const [scheduleId, setScheduleId] = useState<string | null>(null)
  const [nextRunAt, setNextRunAt] = useState<string | null>(null)
  const [lastRanAt, setLastRanAt] = useState<string | null>(null)
  const [cronExpression, setCronExpression] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  // Track when we need to force a refresh of schedule data
  const [refreshCounter, setRefreshCounter] = useState(0)

  const params = useParams()
  const workflowId = params.id as string

  // Get workflow state from store
  const blocks = useWorkflowStore((state) => state.blocks)
  const edges = useWorkflowStore((state) => state.edges)
  const loops = useWorkflowStore((state) => state.loops)
  const triggerUpdate = useWorkflowStore((state) => state.triggerUpdate)
  const setScheduleStatus = useWorkflowStore((state) => state.setScheduleStatus)

  // Get the schedule type from the block state
  const [scheduleType] = useSubBlockValue(blockId, 'scheduleType')

  // Get the startWorkflow value to determine if scheduling is enabled
  // and expose the setter so we can update it
  const [startWorkflow, setStartWorkflow] = useSubBlockValue(blockId, 'startWorkflow')
  const isScheduleEnabled = startWorkflow === 'schedule'

  // Function to check if schedule exists in the database
  const checkSchedule = async () => {
    setIsLoading(true)
    try {
      // Check if there's a schedule for this workflow, passing the mode parameter
      const response = await fetch(`/api/schedules?workflowId=${workflowId}&mode=schedule`, {
        // Add cache: 'no-store' to prevent caching of this request
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      })

      if (response.ok) {
        const data = await response.json()
        logger.debug(`Schedule check response:`, data)

        if (data.schedule) {
          setScheduleId(data.schedule.id)
          setNextRunAt(data.schedule.nextRunAt)
          setLastRanAt(data.schedule.lastRanAt)
          setCronExpression(data.schedule.cronExpression)

          // Set active schedule flag to true since we found an active schedule
          setScheduleStatus(true)
        } else {
          setScheduleId(null)
          setNextRunAt(null)
          setLastRanAt(null)
          setCronExpression(null)

          // Set active schedule flag to false since no schedule was found
          setScheduleStatus(false)
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
    // Always check for schedules regardless of the UI setting
    // This ensures we detect schedules even when the UI is set to manual
    checkSchedule()
  }, [workflowId, scheduleType, isModalOpen, refreshCounter])

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
        <div className="font-normal text-sm truncate">{scheduleTiming}</div>
        <div className="text-xs text-muted-foreground">
          <div>Next run: {formatDateTime(new Date(nextRunAt))}</div>
          {lastRanAt && <div>Last run: {formatDateTime(new Date(lastRanAt))}</div>}
        </div>
      </>
    )
  }

  const handleOpenModal = () => {
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
    setIsSaving(true)
    setError(null)

    try {
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
      const response = await fetch(`/api/schedules/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId,
          state: currentWorkflowWithValues.state,
        }),
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
      setScheduleStatus(true)

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
    if (!scheduleId) return false

    setIsDeleting(true)
    try {
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
      setScheduleStatus(false)
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
    <div className="w-full" onClick={(e) => e.stopPropagation()}>
      {error && <div className="text-sm text-red-500 dark:text-red-400 mb-2">{error}</div>}

      {isLoading ? (
        <div className="flex items-center justify-center py-2">
          <div className="h-5 w-5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
        </div>
      ) : isScheduleActive ? (
        <div className="flex flex-col space-y-2">
          <div className="flex items-center justify-between px-3 py-2 rounded border border-border bg-background">
            <div className="flex items-center gap-2 flex-1">
              <div className="flex-1 truncate">{getScheduleInfo()}</div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleOpenModal}
              disabled={isDeleting || isConnecting}
            >
              {isDeleting ? (
                <div className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full h-10 text-sm font-normal bg-background flex items-center"
          onClick={handleOpenModal}
          disabled={isConnecting || isSaving || isDeleting}
        >
          <Calendar className="h-4 w-4 mr-2" />
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
