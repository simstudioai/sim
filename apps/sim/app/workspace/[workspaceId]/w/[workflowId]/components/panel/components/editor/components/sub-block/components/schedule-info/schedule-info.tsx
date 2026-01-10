import { useParams } from 'next/navigation'
import { Badge } from '@/components/emcn'
import { parseCronToHumanReadable } from '@/lib/workflows/schedules/utils'
import { useRedeployWorkflowSchedule, useScheduleQuery } from '@/hooks/queries/schedules'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { MAX_CONSECUTIVE_FAILURES } from '@/triggers/constants'

interface ScheduleInfoProps {
  blockId: string
  isPreview?: boolean
}

/**
 * Schedule status display component.
 * Shows the current schedule status, next run time, and last run time.
 * Schedule creation/deletion is handled during workflow deploy/undeploy.
 */
export function ScheduleInfo({ blockId, isPreview = false }: ScheduleInfoProps) {
  const params = useParams()
  const workflowId = params.workflowId as string

  const scheduleTimezone = useSubBlockStore((state) => state.getValue(blockId, 'timezone')) as
    | string
    | undefined

  const { data: schedule, isLoading } = useScheduleQuery(workflowId, blockId, {
    enabled: !isPreview,
  })

  const redeployMutation = useRedeployWorkflowSchedule()

  const handleRedeploy = () => {
    if (isPreview || redeployMutation.isPending) return
    redeployMutation.mutate({ workflowId, blockId })
  }

  if (!schedule || isLoading) {
    return null
  }

  const timezone = scheduleTimezone || schedule?.timezone || 'UTC'
  const failedCount = schedule?.failedCount || 0
  const isDisabled = schedule?.status === 'disabled'
  const nextRunAt = schedule?.nextRunAt ? new Date(schedule.nextRunAt) : null

  return (
    <div className='space-y-1.5'>
      {/* Status badges */}
      {(failedCount > 0 || isDisabled) && (
        <div className='space-y-1'>
          <div className='flex flex-wrap items-center gap-2'>
            {failedCount >= MAX_CONSECUTIVE_FAILURES && isDisabled ? (
              <Badge
                variant='outline'
                className='cursor-pointer'
                style={{
                  borderColor: 'var(--warning)',
                  color: 'var(--warning)',
                }}
                onClick={handleRedeploy}
              >
                {redeployMutation.isPending ? 'redeploying...' : 'disabled'}
              </Badge>
            ) : failedCount > 0 ? (
              <Badge
                variant='outline'
                style={{
                  borderColor: 'var(--warning)',
                  color: 'var(--warning)',
                }}
              >
                {failedCount} failed
              </Badge>
            ) : null}
          </div>
          {failedCount >= MAX_CONSECUTIVE_FAILURES && isDisabled && (
            <p className='text-[12px] text-[var(--text-tertiary)]'>
              Disabled after {MAX_CONSECUTIVE_FAILURES} consecutive failures
            </p>
          )}
          {redeployMutation.isError && (
            <p className='text-[12px] text-[var(--text-error)]'>
              Failed to redeploy. Please try again.
            </p>
          )}
        </div>
      )}

      {/* Schedule info - only show when active */}
      {!isDisabled && (
        <div className='text-[12px] text-[var(--text-tertiary)]'>
          {schedule?.cronExpression && (
            <span>{parseCronToHumanReadable(schedule.cronExpression, timezone)}</span>
          )}
          {nextRunAt && (
            <>
              {schedule?.cronExpression && <span className='mx-1'>·</span>}
              <span>
                Next:{' '}
                {nextRunAt.toLocaleString('en-US', {
                  timeZone: timezone,
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                })}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
