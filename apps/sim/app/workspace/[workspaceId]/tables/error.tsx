'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components/error'

export default function TablesError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load tables'
      description='Something went wrong while loading the tables. Please try again.'
      loggerName='TablesError'
    />
  )
}
