'use client'

import { ErrorState } from '@/app/workspace/[workspaceId]/components'

interface TablesErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function TablesError({ error, reset }: TablesErrorProps) {
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
