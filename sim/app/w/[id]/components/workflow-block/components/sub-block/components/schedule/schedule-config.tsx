import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Calendar, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const params = useParams()
  const workflowId = params.id as string

  // Get workflow state from store
  const blocks = useWorkflowStore((state) => state.blocks)
  const edges = useWorkflowStore((state) => state.edges)
  const loops = useWorkflowStore((state) => state.loops)

  // Get the schedule type from the block state
  const [scheduleType] = useSubBlockValue(blockId, 'scheduleType')

  // Check if schedule exists in the database
  useEffect(() => {
    const checkSchedule = async () => {
      setIsLoading(true)
      try {
        // Check if there's a schedule for this workflow
        const response = await fetch(`/api/scheduled?workflowId=${workflowId}`)
        if (response.ok) {
          const data = await response.json()
          if (data.schedule) {
            setScheduleId(data.schedule.id)
            setNextRunAt(data.schedule.nextRunAt)
            setLastRanAt(data.schedule.lastRanAt)
            setCronExpression(data.schedule.cronExpression)
          } else {
            setScheduleId(null)
            setNextRunAt(null)
            setLastRanAt(null)
            setCronExpression(null)
          }
        }
      } catch (error) {
        logger.error('Error checking schedule:', { error })
        setError('Failed to check schedule status')
      } finally {
        setIsLoading(false)
      }
    }

    checkSchedule()
  }, [workflowId, scheduleType, isModalOpen]) // Re-check when modal closes

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
      <div className="text-xs text-muted-foreground">
        <div className="flex items-center">
          <span className="font-medium">{scheduleTiming}</span>
        </div>
        <div>Next run: {formatDateTime(new Date(nextRunAt))}</div>
        {lastRanAt && <div>Last run: {formatDateTime(new Date(lastRanAt))}</div>}
      </div>
    )
  }

  const handleOpenModal = () => {
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  const handleSaveSchedule = async (): Promise<boolean> => {
    setIsSaving(true)
    try {
      // Send the complete workflow state to be saved/updated
      const response = await fetch(`/api/scheduled/schedule`, {
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

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to save schedule')
        return false
      }

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
      const response = await fetch(`/api/scheduled/${scheduleId}`, {
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
    <div className="mt-2 space-y-2">
      {error && <div className="text-sm text-red-500 dark:text-red-400 mb-2">{error}</div>}

      {isLoading ? (
        <Button variant="outline" size="sm" className="w-full" disabled={true}>
          Checking schedule...
        </Button>
      ) : isScheduleActive ? (
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md p-2 relative">
          <div className="flex items-center mb-1">
            <Calendar className="h-4 w-4 mr-2 text-green-600 dark:text-green-400" />
            <span className="text-sm font-medium text-green-700 dark:text-green-400">
              Schedule Active
            </span>
            <Badge
              variant="outline"
              className="ml-auto bg-green-100 text-green-700 border-green-200 dark:bg-green-900 dark:text-green-300 dark:border-green-800"
            >
              Active
            </Badge>
          </div>
          {getScheduleInfo()}
        </div>
      ) : (
        <Button variant="outline" size="sm" className="w-full" disabled={isConnecting}>
          <Calendar className="h-4 w-4 mr-2" />
          No schedule configured
        </Button>
      )}

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={handleOpenModal}
        disabled={isConnecting || isSaving || isDeleting}
      >
        <ExternalLink className="h-4 w-4 mr-2" />
        {isSaving ? 'Saving...' : isDeleting ? 'Deleting...' : 'Configure Schedule'}
      </Button>

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
