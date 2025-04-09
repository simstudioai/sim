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
import { workflowSync } from '@/stores/workflows/sync'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'
import { ScheduleModal } from './components/schedule-modal'

const logger = createLogger('ScheduleConfig')

// Helper function to convert cron expressions to human-readable text
const parseCronToHumanReadable = (cronExpression: string): string => {
  // Parse the cron parts
  const parts = cronExpression.split(' ')

  // Handle standard patterns
  if (cronExpression === '* * * * *') {
    return 'Every minute'
  }

  // Every X minutes
  if (cronExpression.match(/^\*\/\d+ \* \* \* \*$/)) {
    const minutes = cronExpression.split(' ')[0].split('/')[1]
    return `Every ${minutes} minutes`
  }

  // Daily at specific time
  if (cronExpression.match(/^\d+ \d+ \* \* \*$/)) {
    const minute = parseInt(parts[0], 10)
    const hour = parseInt(parts[1], 10)
    const period = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    return `Daily at ${hour12}:${minute.toString().padStart(2, '0')} ${period}`
  }

  // Every hour at specific minute
  if (cronExpression.match(/^\d+ \* \* \* \*$/)) {
    const minute = parts[0]
    return `Hourly at ${minute} minutes past the hour`
  }

  // Specific day of week at specific time
  if (cronExpression.match(/^\d+ \d+ \* \* \d+$/)) {
    const minute = parseInt(parts[0], 10)
    const hour = parseInt(parts[1], 10)
    const dayOfWeek = parseInt(parts[4], 10)
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const day = days[dayOfWeek % 7]
    const period = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    return `Every ${day} at ${hour12}:${minute.toString().padStart(2, '0')} ${period}`
  }

  // Specific day of month at specific time
  if (cronExpression.match(/^\d+ \d+ \d+ \* \*$/)) {
    const minute = parseInt(parts[0], 10)
    const hour = parseInt(parts[1], 10)
    const dayOfMonth = parts[2]
    const period = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    const day =
      dayOfMonth === '1'
        ? '1st'
        : dayOfMonth === '2'
          ? '2nd'
          : dayOfMonth === '3'
            ? '3rd'
            : `${dayOfMonth}th`
    return `Monthly on the ${day} at ${hour12}:${minute.toString().padStart(2, '0')} ${period}`
  }

  // Weekly at specific time
  if (cronExpression.match(/^\d+ \d+ \* \* [0-6]$/)) {
    const minute = parseInt(parts[0], 10)
    const hour = parseInt(parts[1], 10)
    const dayOfWeek = parseInt(parts[4], 10)
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const day = days[dayOfWeek % 7]
    const period = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    return `Weekly on ${day} at ${hour12}:${minute.toString().padStart(2, '0')} ${period}`
  }

  // Return a more detailed breakdown if none of the patterns match
  try {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
    let description = 'Runs '

    // Time component
    if (minute === '*' && hour === '*') {
      description += 'every minute '
    } else if (minute.includes('/') && hour === '*') {
      const interval = minute.split('/')[1]
      description += `every ${interval} minutes `
    } else if (minute !== '*' && hour !== '*') {
      const hourVal = parseInt(hour, 10)
      const period = hourVal >= 12 ? 'PM' : 'AM'
      const hour12 = hourVal % 12 || 12
      description += `at ${hour12}:${minute.padStart(2, '0')} ${period} `
    }

    // Day component
    if (dayOfMonth !== '*' && month !== '*') {
      const months = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ]
      if (month.includes(',')) {
        const monthNames = month.split(',').map((m) => months[parseInt(m, 10) - 1])
        description += `on day ${dayOfMonth} of ${monthNames.join(', ')}`
      } else {
        description += `on day ${dayOfMonth} of ${months[parseInt(month, 10) - 1]}`
      }
    } else if (dayOfWeek !== '*') {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      if (dayOfWeek.includes(',')) {
        const dayNames = dayOfWeek.split(',').map((d) => days[parseInt(d, 10) % 7])
        description += `on ${dayNames.join(', ')}`
      } else if (dayOfWeek.includes('-')) {
        const [start, end] = dayOfWeek.split('-').map((d) => parseInt(d, 10) % 7)
        description += `from ${days[start]} to ${days[end]}`
      } else {
        description += `on ${days[parseInt(dayOfWeek, 10) % 7]}`
      }
    }

    return description.trim()
  } catch (e) {
    return `Schedule: ${cronExpression}`
  }
}

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
    setRefreshCounter((prev) => prev + 1)
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
      setRefreshCounter((prev) => prev + 1)

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
