'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function KnowledgeError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load knowledge'
      description='Something went wrong while loading your knowledge bases. Please try again.'
      loggerName='KnowledgeError'
    />
  )
}
