'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function LogsError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load logs'
      description='Something went wrong while loading the logs. Please try again.'
      loggerName='LogsError'
    />
  )
}
