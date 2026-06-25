'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function HomeError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load home'
      description='Something went wrong while loading your workspace home. Please try again.'
      loggerName='HomeError'
    />
  )
}
