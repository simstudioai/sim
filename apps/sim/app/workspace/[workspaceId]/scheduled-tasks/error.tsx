'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function ScheduledTasksError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load scheduled tasks'
      description='Something went wrong while loading your scheduled tasks. Please try again.'
      loggerName='ScheduledTasksError'
    />
  )
}
