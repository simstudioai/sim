import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Calendar } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { formatDateTime } from '@/lib/utils'

const logger = createLogger('ScheduleStatus')

interface ScheduleStatusProps {
  blockId: string
}

export function ScheduleStatus({ blockId }: ScheduleStatusProps) {
  const [scheduleId, setScheduleId] = useState<string | null>(null)
  const [nextRunAt, setNextRunAt] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const params = useParams()
  const workflowId = params.id as string

  // Check if schedule exists in the database
  useEffect(() => {
    const checkSchedule = async () => {
      setIsLoading(true)
      try {
        // Check if there's a schedule for this workflow
        const response = await fetch(`/api/schedules?workflowId=${workflowId}`)
        if (response.ok) {
          const data = await response.json()
          if (data.schedule) {
            setScheduleId(data.schedule.id)
            setNextRunAt(data.schedule.nextRunAt)
          } else {
            setScheduleId(null)
            setNextRunAt(null)
          }
        }
      } catch (error) {
        logger.error('Error checking schedule:', { error })
      } finally {
        setIsLoading(false)
      }
    }

    checkSchedule()
  }, [workflowId])

  if (isLoading || !scheduleId || !nextRunAt) {
    return null
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="ml-auto bg-green-100 text-green-700 border-green-200 
                    dark:bg-green-900 dark:text-green-300 dark:border-green-800 
                    px-2 py-0.5 flex items-center"
        >
          <Calendar className="h-3.5 w-3.5 mr-1" />
          <span className="text-xs">Active</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="right">
        <div className="text-xs">
          <div>
            <strong>Schedule Active</strong>
          </div>
          <div>Next run: {formatDateTime(new Date(nextRunAt))}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
