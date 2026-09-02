'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function SearchError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load Sim Search'
      description='Something went wrong while loading your Sim Search connectors. Please try again.'
      loggerName='SearchError'
    />
  )
}
