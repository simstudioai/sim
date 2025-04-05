import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Calendar, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { createLogger } from '@/lib/logs/console-logger'
import { formatDateTime } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'
import { ScheduleModal } from './components/schedule-modal'

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
      // Simple cron expression descriptions
      if (cronExpression === '* * * * *') {
        scheduleTiming = 'Every minute'
      } else if (cronExpression.match(/^\*\/\d+ \* \* \* \*$/)) {
        const minutes = cronExpression.split(' ')[0].split('/')[1]
        scheduleTiming = `Every ${minutes} minutes`
      } else {
        scheduleTiming = `Cron: ${cronExpression}`
      }
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
      // Make sure that startWorkflow is set to 'schedule'
      if (startWorkflow !== 'schedule') {
        // Set startWorkflow to 'schedule' to enable scheduling
        setStartWorkflow('schedule')

        // Give a moment for the state to update
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      // Send the complete workflow state to be saved/updated
      const response = await fetch(`/api/schedules/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId,
          state: {
            blocks,
            edges,
            loops,
          },
        }),
      })

      // Clone the response to read it as text and parse as JSON
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

      // Update our local state with the response data
      // This allows showing schedule info immediately without waiting for another API call
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

      // Set schedule status to true when we've successfully saved
      setScheduleStatus(true)

      // Force a refresh after successful save
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
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to delete schedule')
        return false
      }

      // Clear schedule state
      setScheduleId(null)
      setNextRunAt(null)
      setLastRanAt(null)
      setCronExpression(null)

      // Update startWorkflow value to manual to trigger re-render
      setStartWorkflow('manual')

      // Set active schedule flag to false since we deleted the schedule
      setScheduleStatus(false)

      // Trigger workflow update to refresh the UI
      triggerUpdate()

      // Force a refresh after successful delete
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
        <div className="flex flex-col space-y-2 mb-2">
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
